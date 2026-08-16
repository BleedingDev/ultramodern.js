// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off
import { fs } from '@modern-js/utils';
import path from 'path';
import {
  API_DIR,
  CLIENT_DIR,
  EXPORT_PREFIX,
  PLUGIN_DIR,
  posixJoin,
  RUNTIME_DIR,
  TYPE_PREFIX,
  toPosixPath,
  writeTargetFile,
} from './files';
import {
  getClientPackageName,
  mergePackageJson,
  type PackageJsonLike,
} from './package-json';

export async function writeClientModuleBoundary(
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

export async function setPackage(
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
    // The client facade re-exports declarations that stay in their original
    // `dist/<lambda>` / `dist/shared` locations, so every emitted `.d.ts` must
    // ship or consumers resolve the facade to a missing file (TS2307). The
    // glob stays scoped to the configured distPath: no source, no runtime JS
    // beyond the three generated directories above.
    posixJoin(relativeDistPath, '**', '*.d.ts'),
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
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
}
