// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off
import { type GenClientOptions, generateClient } from '@modern-js/bff-core';
import type { HttpMethodDecider } from '@modern-js/types';
import { fs, logger } from '@modern-js/utils';
import path from 'path';
import {
  generateEffectClientCode,
  renderEffectClientDeclaration,
  resolveEffectEntryFile,
} from './effectClientGenerator';

export type APILoaderOptions = {
  prefix: string;
  appDir: string;
  apiDir: string;
  lambdaDir: string;
  existLambda: boolean;
  port?: number;
  requestCreator?: string;
  httpMethodDecider?: HttpMethodDecider;
  relativeDistPath: string;
  relativeApiPath: string;
  bffRuntimeFramework?: 'hono' | 'effect';
  effectEntry?: string;
  effectDataPlatformBatch?: {
    enabled?: boolean;
    endpoint?: string;
    flushIntervalMs?: number;
    maxBatchSize?: number;
    maxBatchBytes?: number;
    requestTimeoutMs?: number;
    allowedMethods?: string[];
  };
};

interface FileDetails {
  resourcePath: string;
  source: string;
  targetDir: string;
  name: string;
  absTargetDir: string;
  relativeTargetDistDir: string;
  exportKey: string;
}

type PackageJsonLike = {
  files?: string[];
  typesVersions?: Record<string, Record<string, string[]>>;
  exports?: Record<
    string,
    {
      import?: string;
      require?: string;
      types?: string;
    }
  >;
};
const API_DIR = 'api';
const PLUGIN_DIR = 'plugin';
const RUNTIME_DIR = 'runtime';
const CLIENT_DIR = 'client';

const EXPORT_PREFIX = `./${API_DIR}/`;
const TYPE_PREFIX = `${API_DIR}/`;
const GENERATED_RUNTIME_DIRS = [CLIENT_DIR, PLUGIN_DIR, RUNTIME_DIR];

const toPosixPath = (p: string) => p.replace(/\\/g, '/');
const posixJoin = (...args: string[]) => toPosixPath(path.join(...args));

function getPackageName(appDirectory: string): string | undefined {
  try {
    const packageJsonPath = path.resolve(appDirectory, './package.json');
    const packageJson = fs.readJSONSync(packageJsonPath) as {
      name?: string;
    };
    return packageJson.name;
  } catch {
    return undefined;
  }
}

function createFileDetails(options: {
  appDirectory: string;
  baseDirectory: string;
  resourcePath: string;
  source: string;
  relativeDistPath: string;
}): FileDetails {
  const {
    appDirectory,
    baseDirectory,
    resourcePath,
    source,
    relativeDistPath,
  } = options;
  const relativePath = path.relative(baseDirectory, resourcePath);
  const parsedPath = path.parse(relativePath);

  const targetDir = posixJoin(
    `./${relativeDistPath}/${CLIENT_DIR}`,
    parsedPath.dir,
    `${parsedPath.name}.js`,
  );
  const absTargetDir = path.resolve(targetDir);

  const relativePathFromAppDirectory = path.relative(
    appDirectory,
    path.dirname(resourcePath),
  );

  const typesFilePath = posixJoin(
    `./${relativeDistPath}`,
    relativePathFromAppDirectory,
    `${parsedPath.name}.d.ts`,
  );

  return {
    resourcePath,
    source,
    targetDir,
    name: parsedPath.name,
    absTargetDir,
    relativeTargetDistDir: `./${typesFilePath}`,
    exportKey: toPosixPath(path.join(parsedPath.dir, parsedPath.name)),
  };
}

export async function readDirectoryFiles(
  appDirectory: string,
  directory: string,
  relativeDistPath: string,
): Promise<FileDetails[]> {
  const filesList: FileDetails[] = [];

  async function readFiles(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === '_app.ts') continue;

      const resourcePath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await readFiles(resourcePath);
      } else {
        const source = await fs.readFile(resourcePath, 'utf8');
        filesList.push(
          createFileDetails({
            appDirectory,
            baseDirectory: directory,
            resourcePath,
            source,
            relativeDistPath,
          }),
        );
      }
    }
  }

  await readFiles(directory);
  return filesList;
}

function mergePackageJson(
  packageJson: PackageJsonLike,
  files: string[],
  typesVersion: Record<string, Record<string, string[]>>,
  exports: Record<
    string,
    {
      import?: string;
      require?: string;
      types?: string;
    }
  >,
  relativeDistPath: string,
) {
  const distPrefix = toPosixPath(`./${relativeDistPath}/`);
  const generatedPrefixes = GENERATED_RUNTIME_DIRS.map(dir =>
    toPosixPath(`${distPrefix}${dir}/`),
  );
  const isManagedExportEntry = (
    value:
      | {
          import?: string;
          require?: string;
          types?: string;
        }
      | undefined,
  ) => {
    if (!value) {
      return false;
    }
    const values = [value.import, value.require, value.types].filter(
      Boolean,
    ) as string[];
    return values.every(entry =>
      generatedPrefixes.some(prefix => entry.startsWith(prefix)),
    );
  };
  const isManagedTypeEntry = (value: string[] | undefined) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(entry =>
      generatedPrefixes.some(prefix => entry.startsWith(prefix)),
    );
  const normalizedFiles = [...new Set(files.map(file => toPosixPath(file)))];
  const currentFiles = packageJson.files || [];
  packageJson.files = [
    ...new Set([
      ...currentFiles.map(file => toPosixPath(file)),
      ...normalizedFiles,
    ]),
  ];

  packageJson.typesVersions ??= {};
  const typesVersions = packageJson.typesVersions;
  const starTypes = typesVersions['*'] || {};
  const generatedTypeEntries = typesVersion['*'] || {};
  const generatedTypeKeys = new Set(Object.keys(generatedTypeEntries));
  const typeConflicts = Object.entries(starTypes)
    .filter(([key, value]) => {
      if (!generatedTypeKeys.has(key) && !key.startsWith(TYPE_PREFIX)) {
        return false;
      }

      const generatedValue = generatedTypeEntries[key];
      if (generatedValue) {
        return (
          JSON.stringify(value) !== JSON.stringify(generatedValue) &&
          !isManagedTypeEntry(value)
        );
      }

      return !isManagedTypeEntry(value);
    })
    .map(([key]) => key);

  if (typeConflicts.length > 0) {
    throw new Error(
      `[plugin-bff] package.json typesVersions conflict on keys: ${typeConflicts.sort().join(', ')}. Rename these keys or move them outside "${TYPE_PREFIX}" namespace.`,
    );
  }

  Object.keys(starTypes).forEach(key => {
    if (generatedTypeKeys.has(key) || key.startsWith(TYPE_PREFIX)) {
      delete starTypes[key];
    }
  });
  typesVersions['*'] = {
    ...starTypes,
    ...generatedTypeEntries,
  };

  packageJson.exports ??= {};
  const packageExports = packageJson.exports;
  const generatedExportKeys = new Set(Object.keys(exports));
  const exportConflicts = Object.entries(packageExports)
    .filter(([key, value]) => {
      if (!generatedExportKeys.has(key) && !key.startsWith(EXPORT_PREFIX)) {
        return false;
      }

      const generatedValue = exports[key];
      if (generatedValue) {
        return (
          JSON.stringify(value) !== JSON.stringify(generatedValue) &&
          !isManagedExportEntry(value)
        );
      }

      return !isManagedExportEntry(value);
    })
    .map(([key]) => key);

  if (exportConflicts.length > 0) {
    throw new Error(
      `[plugin-bff] package.json exports conflict on keys: ${exportConflicts.sort().join(', ')}. Rename these exports or move them outside "${EXPORT_PREFIX}" namespace.`,
    );
  }

  Object.keys(packageExports).forEach(key => {
    if (generatedExportKeys.has(key) || key.startsWith(EXPORT_PREFIX)) {
      delete packageExports[key];
    }
  });
  Object.assign(packageExports, exports);
}

async function writeTargetFile(absTargetDir: string, content: string) {
  await fs.mkdir(path.dirname(absTargetDir), { recursive: true });
  await fs.writeFile(absTargetDir, content);
}

function getClientPackageName(appDirectory: string): string {
  const packageName =
    getPackageName(appDirectory) || path.basename(appDirectory);

  if (packageName.startsWith('@') && packageName.includes('/')) {
    const [scope, name] = packageName.split('/');
    return `${scope}/${name}-bff-client`;
  }

  return `${packageName}-bff-client`;
}

async function writeClientModuleBoundary(
  appDirectory: string,
  relativeDistPath: string,
) {
  await writeTargetFile(
    path.resolve(appDirectory, relativeDistPath, CLIENT_DIR, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        name: getClientPackageName(appDirectory),
        type: 'module',
      },
      null,
      2,
    )}\n`,
  );
}

async function setPackage(
  files: {
    exportKey: string;
    targetDir: string;
    relativeTargetDistDir: string;
  }[],
  appDirectory: string,
  relativeDistPath: string,
) {
  const packagePath = path.resolve(appDirectory, './package.json');
  const packageContent = await fs.readFile(packagePath, 'utf8');
  const packageJson = JSON.parse(packageContent) as PackageJsonLike;
  const sortedFiles = [...files].sort((a, b) =>
    a.exportKey.localeCompare(b.exportKey),
  );

  const addFiles = [
    posixJoin(relativeDistPath, CLIENT_DIR, '**', '*'),
    posixJoin(relativeDistPath, RUNTIME_DIR, '**', '*'),
    posixJoin(relativeDistPath, PLUGIN_DIR, '**', '*'),
  ];

  const typesVersions = {
    '*': sortedFiles.reduce(
      (acc, file) => {
        const typeFilePath = toPosixPath(`./${file.targetDir}`).replace(
          /\.js$/,
          '.d.ts',
        );
        return {
          ...acc,
          [toPosixPath(`${TYPE_PREFIX}${file.exportKey}`)]: [typeFilePath],
        };
      },
      {
        [`${API_DIR}/*`]: [
          toPosixPath(`./${relativeDistPath}/${CLIENT_DIR}/*.d.ts`),
        ],
        [RUNTIME_DIR]: [
          toPosixPath(`./${relativeDistPath}/${RUNTIME_DIR}/index.d.ts`),
        ],
        [PLUGIN_DIR]: [
          toPosixPath(`./${relativeDistPath}/${PLUGIN_DIR}/index.d.ts`),
        ],
      },
    ),
  };

  const exports = sortedFiles.reduce(
    (acc, file) => {
      const exportKey = `${EXPORT_PREFIX}${file.exportKey}`;
      const jsFilePath = toPosixPath(`./${file.targetDir}`);

      return {
        ...acc,
        [toPosixPath(exportKey)]: {
          import: jsFilePath,
          types: toPosixPath(jsFilePath.replace(/\.js$/, '.d.ts')),
        },
      };
    },
    {
      [toPosixPath(`./${API_DIR}/*`)]: {
        import: toPosixPath(`./${relativeDistPath}/${CLIENT_DIR}/*.js`),
        types: toPosixPath(`./${relativeDistPath}/${CLIENT_DIR}/*.d.ts`),
      },
      [toPosixPath(`./${PLUGIN_DIR}`)]: {
        import: toPosixPath(`./${relativeDistPath}/${PLUGIN_DIR}/index.js`),
        require: toPosixPath(`./${relativeDistPath}/${PLUGIN_DIR}/index.js`),
        types: toPosixPath(`./${relativeDistPath}/${PLUGIN_DIR}/index.d.ts`),
      },
      [toPosixPath(`./${RUNTIME_DIR}`)]: {
        import: toPosixPath(`./${relativeDistPath}/${RUNTIME_DIR}/index.js`),
        require: toPosixPath(`./${relativeDistPath}/${RUNTIME_DIR}/index.js`),
        types: toPosixPath(`./${relativeDistPath}/${RUNTIME_DIR}/index.d.ts`),
      },
    },
  );

  mergePackageJson(
    packageJson,
    addFiles,
    typesVersions,
    exports,
    relativeDistPath,
  );

  await fs.promises.writeFile(
    packagePath,
    JSON.stringify(packageJson, null, 2),
  );
}

export async function copyFiles(from: string, to: string) {
  if (await fs.pathExists(from)) {
    await fs.copy(toPosixPath(from), toPosixPath(to));
  }
}

async function clientGenerator(draftOptions: APILoaderOptions) {
  const generatedClientDir = path.resolve(
    draftOptions.appDir,
    draftOptions.relativeDistPath,
    CLIENT_DIR,
  );
  await fs.remove(generatedClientDir);
  const requestId =
    getPackageName(draftOptions.appDir) || process.env.npm_package_name;

  const lambdaSourceList = draftOptions.existLambda
    ? await readDirectoryFiles(
        draftOptions.appDir,
        draftOptions.lambdaDir,
        draftOptions.relativeDistPath,
      )
    : [];
  const generatedSourceList = [...lambdaSourceList];

  const getClitentCode = async (resourcePath: string, source: string) => {
    const warning = `The file ${resourcePath} is not allowed to be imported in src directory, only API definition files are allowed.`;

    if (!draftOptions.existLambda) {
      logger.warn(warning);
      return;
    }

    const options: GenClientOptions = {
      prefix: (Array.isArray(draftOptions.prefix)
        ? draftOptions.prefix[0]
        : draftOptions.prefix) as string,
      appDir: draftOptions.appDir,
      apiDir: draftOptions.apiDir,
      lambdaDir: draftOptions.lambdaDir,
      port: Number(draftOptions.port),
      source,
      resourcePath,
      target: 'bundle',
      httpMethodDecider: draftOptions.httpMethodDecider,
      requestCreator: draftOptions.requestCreator,
      requestId,
    };

    const { lambdaDir } = draftOptions;
    if (!resourcePath.startsWith(lambdaDir)) {
      logger.warn(warning);
      return;
    }

    const result = await generateClient(options);

    return result;
  };

  try {
    for (const source of lambdaSourceList) {
      const code = await getClitentCode(source.resourcePath, source.source);
      if (code?.value) {
        await writeTargetFile(source.absTargetDir, code.value);
        await copyFiles(
          source.relativeTargetDistDir,
          source.targetDir.replace(`js`, 'd.ts'),
        );
      }
    }

    if (draftOptions.bffRuntimeFramework === 'effect') {
      const effectEntryFile = resolveEffectEntryFile({
        appDir: draftOptions.appDir,
        apiDir: draftOptions.apiDir,
        effectEntry: draftOptions.effectEntry,
      });

      if (effectEntryFile) {
        const effectSource = await fs.readFile(effectEntryFile, 'utf8');
        const effectFileDetails = createFileDetails({
          appDirectory: draftOptions.appDir,
          baseDirectory: draftOptions.apiDir,
          resourcePath: effectEntryFile,
          source: effectSource,
          relativeDistPath: draftOptions.relativeDistPath,
        });

        const effectClientCode = await generateEffectClientCode({
          appDir: draftOptions.appDir,
          apiDir: draftOptions.apiDir,
          resourcePath: effectEntryFile,
          prefix: (Array.isArray(draftOptions.prefix)
            ? draftOptions.prefix[0]
            : draftOptions.prefix) as string,
          port: Number(draftOptions.port),
          target: 'bundle',
          requestCreator: draftOptions.requestCreator,
          httpMethodDecider: draftOptions.httpMethodDecider,
          dataPlatformBatch: draftOptions.effectDataPlatformBatch,
        });

        if (effectClientCode) {
          const targetTypeFile = effectFileDetails.targetDir.replace(
            /\.js$/,
            '.d.ts',
          );

          await writeTargetFile(
            effectFileDetails.absTargetDir,
            effectClientCode,
          );
          await writeTargetFile(
            path.resolve(targetTypeFile),
            renderEffectClientDeclaration(),
          );
          generatedSourceList.push(effectFileDetails);
        }
      }
    }

    logger.info(`Client bundle generate succeed`);
  } catch (error) {
    logger.error(`Client bundle generate failed: ${error}`);
  }

  if (generatedSourceList.length > 0) {
    await writeClientModuleBoundary(
      draftOptions.appDir,
      draftOptions.relativeDistPath,
    );
  }

  await setPackage(
    generatedSourceList,
    draftOptions.appDir,
    draftOptions.relativeDistPath,
  );
}

export default clientGenerator;
