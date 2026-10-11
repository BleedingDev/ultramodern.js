import fs from 'node:fs';
import path from 'node:path';

export const NATIVE_FEDERATION_CONFIG_FILES = [
  'module-federation.config.ts',
  'module-federation.config.mts',
  'module-federation.config.js',
  'module-federation.config.mjs',
] as const;

/** The application's native module-federation.config file, if it has one. */
export function findNativeFederationConfig(
  appDirectory: string,
): string | undefined {
  const found = NATIVE_FEDERATION_CONFIG_FILES.map(name =>
    path.join(appDirectory, name),
  ).filter(file => fs.existsSync(file));
  if (found.length > 1)
    throw new Error(
      `Native Module Federation: choose one configuration file: ${found.map(file => path.basename(file)).join(', ')}`,
    );
  return found[0];
}
