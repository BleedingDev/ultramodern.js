// @effect-diagnostics nodeBuiltinImport:off strictBooleanExpressions:off
import type { ServerPluginAPI } from '@modern-js/server-core';
import { API_DIR, findExists, fs } from '@modern-js/utils';
import path from 'path';

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

  return findExists(JS_OR_TS_EXTS.map(ext => `${entryWithoutOrWithExt}${ext}`));
}

export function resolveEffectAdapterEntryFile(api: ServerPluginAPI) {
  const { appDirectory, apiDirectory } = api.getServerContext();
  const bffConfig = api.getServerConfig()?.bff;
  const configuredEntry = bffConfig?.effect?.entry;
  if (configuredEntry) {
    const entryWithoutExt = path.isAbsolute(configuredEntry)
      ? configuredEntry
      : path.resolve(appDirectory || process.cwd(), configuredEntry);
    return resolveJsOrTsEntry(entryWithoutExt);
  }

  const apiRoot = path.resolve(
    appDirectory || process.cwd(),
    apiDirectory || API_DIR,
  );

  return resolveJsOrTsEntry(path.resolve(apiRoot, 'index'));
}
