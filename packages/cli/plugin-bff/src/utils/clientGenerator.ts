import path from 'path';
import { type GenClientOptions, generateClient } from '@modern-js/bff-core';
import type { HttpMethodDecider } from '@modern-js/types';
import { fs, logger } from '@modern-js/utils';
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

const toPosixPath = (p: string) => p.replace(/\\/g, '/');
const posixJoin = (...args: string[]) => toPosixPath(path.join(...args));

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
) {
  packageJson.files = [...new Set([...(packageJson.files || []), ...files])];

  packageJson.typesVersions ??= {};
  const typesVersions = packageJson.typesVersions;
  const starTypes = typesVersions['*'] || {};
  Object.keys(starTypes).forEach(
    k => k.startsWith(TYPE_PREFIX) && delete starTypes[k],
  );
  typesVersions['*'] = {
    ...starTypes,
    ...(typesVersion['*'] || {}),
  };

  packageJson.exports ??= {};
  const packageExports = packageJson.exports;
  Object.keys(packageExports).forEach(
    k => k.startsWith(EXPORT_PREFIX) && delete packageExports[k],
  );
  Object.assign(packageExports, exports);
}

async function writeTargetFile(absTargetDir: string, content: string) {
  await fs.mkdir(path.dirname(absTargetDir), { recursive: true });
  await fs.writeFile(absTargetDir, content);
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
  try {
    const packagePath = path.resolve(appDirectory, './package.json');
    const packageContent = await fs.readFile(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent) as PackageJsonLike;

    const addFiles = [
      posixJoin(relativeDistPath, CLIENT_DIR, '**', '*'),
      posixJoin(relativeDistPath, RUNTIME_DIR, '**', '*'),
      posixJoin(relativeDistPath, PLUGIN_DIR, '**', '*'),
    ];

    const typesVersions = {
      '*': files.reduce(
        (acc, file) => {
          const typeFilePath = toPosixPath(`./${file.targetDir}`).replace(
            'js',
            'd.ts',
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

    const exports = files.reduce(
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

    mergePackageJson(packageJson, addFiles, typesVersions, exports);

    await fs.promises.writeFile(
      packagePath,
      JSON.stringify(packageJson, null, 2),
    );
  } catch (error) {
    logger.error(`package.json update failed: ${error}`);
  }
}

export async function copyFiles(from: string, to: string) {
  if (await fs.pathExists(from)) {
    await fs.copy(toPosixPath(from), toPosixPath(to));
  }
}

async function clientGenerator(draftOptions: APILoaderOptions) {
  const lambdaSourceList = draftOptions.existLambda
    ? await readDirectoryFiles(
        draftOptions.appDir,
        draftOptions.lambdaDir,
        draftOptions.relativeDistPath,
      )
    : [];
  const generatedSourceList = [...lambdaSourceList];

  const getClitentCode = async (resourcePath: string, source: string) => {
    const warning = `The file ${resourcePath} is not allowd to be imported in src directory, only API definition files are allowed.`;

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
          const effectDeclarationImportPath = toPosixPath(
            path
              .relative(
                path.dirname(path.resolve(targetTypeFile)),
                path.resolve(effectFileDetails.relativeTargetDistDir),
              )
              .replace(/\.d\.ts$/, ''),
          );
          const normalizedImportPath = effectDeclarationImportPath.startsWith(
            '.',
          )
            ? effectDeclarationImportPath
            : `./${effectDeclarationImportPath}`;

          await writeTargetFile(
            effectFileDetails.absTargetDir,
            effectClientCode,
          );
          await writeTargetFile(
            path.resolve(targetTypeFile),
            renderEffectClientDeclaration(normalizedImportPath),
          );
          generatedSourceList.push(effectFileDetails);
        }
      }
    }

    logger.info(`Client bundle generate succeed`);
  } catch (error) {
    logger.error(`Client bundle generate failed: ${error}`);
  }

  await setPackage(
    generatedSourceList,
    draftOptions.appDir,
    draftOptions.relativeDistPath,
  );
}

export default clientGenerator;
