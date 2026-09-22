// @effect-diagnostics nodeBuiltinImport:off strictBooleanExpressions:off
import path from 'node:path';
import '@modern-js/server-runtime-extensions/server-config';
import type { ServerPluginAPI } from '@modern-js/server-core';
import { API_DIR, isProd } from '@modern-js/utils';
import { resolveEffectEntry } from '../effect-source-loader/paths';

export function resolveEffectAdapterEntryFile(api: ServerPluginAPI) {
  const { appDirectory, apiDirectory, distDirectory } = api.getServerContext();
  const appDir = path.resolve(appDirectory || process.cwd());
  return resolveEffectEntry({
    appDir,
    apiDir: path.resolve(appDir, apiDirectory || API_DIR),
    effectEntry: api.getServerConfig()?.bff?.effect?.entry,
    distDir:
      isProd() && distDirectory ? path.resolve(distDirectory) : undefined,
  }).path;
}
