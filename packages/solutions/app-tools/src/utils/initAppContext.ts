import type { ConfigPackageMetadataRead } from '@modern-js/plugin/cli';
import type { BffRuntimeFramework } from '@modern-js/plugin/server';
import { fs, ip } from '@modern-js/utils';
import path from 'path';

function isSymlinkedNodeModules(appDirectory: string): boolean {
  try {
    return fs
      .lstatSync(path.resolve(appDirectory, 'node_modules'))
      .isSymbolicLink();
  } catch {
    return false;
  }
}

function getDefaultInternalDirectory(
  appDirectory: string,
  metaName: string,
): string {
  if (isSymlinkedNodeModules(appDirectory)) {
    return path.resolve(appDirectory, `.${metaName}`);
  }
  return path.resolve(appDirectory, `./node_modules/.${metaName}`);
}

export const initAppContext = ({
  metaName,
  appDirectory,
  runtimeConfigFile,
  options,
  tempDir,
  packageMetadataRead,
}: {
  metaName: string;
  appDirectory: string;
  runtimeConfigFile: string;
  options?: {
    srcDir?: string;
    apiDir?: string;
    distDir?: string;
    sharedDir?: string;
    bffRuntimeFramework?: BffRuntimeFramework;
  };
  tempDir?: string;
  packageMetadataRead?: ConfigPackageMetadataRead;
}) => {
  const {
    apiDir = 'api',
    sharedDir = 'shared',
    bffRuntimeFramework = 'hono',
  } = options || {};
  const pkgPath = path.resolve(appDirectory, './package.json');

  const readModuleType = () =>
    fs.existsSync(pkgPath)
      ? fs.readJSONSync(pkgPath).type || 'commonjs'
      : 'commonjs';
  const moduleType = packageMetadataRead
    ? packageMetadataRead(pkgPath, 'type', readModuleType)
    : readModuleType();

  return {
    runtimeConfigFile,
    ip: ip(),
    port: 0,
    moduleType,
    apiDirectory: path.resolve(appDirectory, apiDir),
    lambdaDirectory: path.resolve(appDirectory, apiDir, 'lambda'),
    sharedDirectory: path.resolve(appDirectory, sharedDir),
    serverPlugins: [],
    internalDirectory: tempDir
      ? path.resolve(appDirectory, tempDir)
      : getDefaultInternalDirectory(appDirectory, metaName),
    htmlTemplates: {},
    serverRoutes: [],
    entrypoints: [],
    checkedEntries: [],
    apiOnly: false,
    internalDirAlias: `@_${metaName.replace(/-/g, '_')}_internal`,
    internalSrcAlias: `@_${metaName.replace(/-/g, '_')}_src`,
    bffRuntimeFramework,
  };
};
