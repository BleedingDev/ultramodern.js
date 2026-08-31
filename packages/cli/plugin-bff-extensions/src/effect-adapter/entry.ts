// @effect-diagnostics nodeBuiltinImport:off strictBooleanExpressions:off

import path from 'node:path';
import type { ServerPluginAPI } from '@modern-js/server-core';
import { API_DIR, findExists, fs, isProd } from '@modern-js/utils';

const JS_OR_TS_EXTS = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
] as const;

type JsOrTsExtension = (typeof JS_OR_TS_EXTS)[number];

function resolveJsOrTsEntry(entryWithoutOrWithExt: string) {
  const extension = path.extname(entryWithoutOrWithExt) as JsOrTsExtension;
  if (JS_OR_TS_EXTS.includes(extension)) {
    return fs.existsSync(entryWithoutOrWithExt)
      ? entryWithoutOrWithExt
      : undefined;
  }

  return (
    findExists(JS_OR_TS_EXTS.map(ext => `${entryWithoutOrWithExt}${ext}`)) ||
    undefined
  );
}

function builtEntryPath(entryPath: string) {
  return entryPath.replace(/\.(?:[cm]?ts|tsx|jsx)$/u, '.js');
}

function relativeAppPath(appDirectory: string, entryPath: string) {
  const relativePath = path.relative(appDirectory, entryPath);
  return relativePath === '..' || relativePath.startsWith(`..${path.sep}`)
    ? undefined
    : relativePath;
}

function isDependencyPath(relativePath: string | undefined) {
  return relativePath?.split(/[\\/]/u).includes('node_modules') ?? false;
}

export function resolveEffectAdapterEntryFile(api: ServerPluginAPI) {
  const { appDirectory, apiDirectory, distDirectory } = api.getServerContext();
  const appRoot = path.resolve(appDirectory || process.cwd());
  const productionRoot =
    isProd() && distDirectory ? path.resolve(distDirectory) : undefined;
  const configuredEntry = api.getServerConfig()?.bff?.effect?.entry;

  if (configuredEntry) {
    const sourceEntry = path.isAbsolute(configuredEntry)
      ? configuredEntry
      : path.resolve(appRoot, configuredEntry);
    if (productionRoot) {
      const relativeEntry = relativeAppPath(appRoot, sourceEntry);
      if (relativeEntry === undefined || isDependencyPath(relativeEntry)) {
        return resolveJsOrTsEntry(sourceEntry);
      }
      return relativeEntry
        ? resolveJsOrTsEntry(
            builtEntryPath(path.resolve(productionRoot, relativeEntry)),
          )
        : undefined;
    }
    return resolveJsOrTsEntry(sourceEntry);
  }

  const resolvedApiDirectory = path.resolve(appRoot, apiDirectory || API_DIR);
  const productionApiDirectory = productionRoot
    ? relativeAppPath(productionRoot, resolvedApiDirectory) !== undefined
      ? resolvedApiDirectory
      : (() => {
          const relativeApiDirectory = relativeAppPath(
            appRoot,
            resolvedApiDirectory,
          );
          if (isDependencyPath(relativeApiDirectory)) {
            return resolvedApiDirectory;
          }
          return relativeApiDirectory
            ? path.resolve(productionRoot, relativeApiDirectory)
            : undefined;
        })()
    : resolvedApiDirectory;

  return productionApiDirectory
    ? resolveJsOrTsEntry(path.resolve(productionApiDirectory, 'index'))
    : undefined;
}
