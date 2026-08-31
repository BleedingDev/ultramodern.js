import path from 'node:path';
import {
  type Alias,
  fs,
  getAliasConfig,
  mergeAlias,
  resolveServerTsconfig,
} from '@modern-js/utils';
import type { ConfigChain } from '@rsbuild/core';

type TsRuntimeRegisterMode = 'node-loader' | 'unsupported';

interface TsRuntimeSetupOptions {
  moduleType?: string;
  /**
   * User-configured `server.tsconfigPath`. Forwarded into the shared
   * resolveServerTsconfig helper. Resolved relative to appDir when not
   * absolute. Falls back to `<appDir>/tsconfig.json` when unset.
   */
  tsconfigPath?: string;
}

const normalizePathValue = ({
  key,
  value,
  absoluteBaseUrl,
}: {
  key: string;
  value: string;
  absoluteBaseUrl: string;
}) => {
  let normalizedValue = value;

  // Modern.js still has some internal aliases that point at packages instead
  // of source files, so resolve them before handing paths to the runtime.
  if (key.startsWith('@') && normalizedValue.startsWith('@')) {
    try {
      normalizedValue = require.resolve(normalizedValue, {
        paths: [process.cwd(), ...module.paths],
      });
    } catch {}
  }

  return path.isAbsolute(normalizedValue)
    ? path.relative(absoluteBaseUrl, normalizedValue)
    : normalizedValue;
};

const normalizePathValues = ({
  key,
  value,
  absoluteBaseUrl,
}: {
  key: string;
  value: string | string[];
  absoluteBaseUrl: string;
}) => {
  const values = Array.isArray(value) ? value : [value];

  return values.map(item =>
    normalizePathValue({
      key,
      value: item,
      absoluteBaseUrl,
    }),
  );
};

const addResolvedAlias = (
  paths: Record<string, string[]>,
  key: string,
  values: string[],
) => {
  if (!key || paths[key]) {
    return;
  }

  paths[key] = values;
};

const createRuntimePaths = ({
  alias,
  paths,
  absoluteBaseUrl,
}: {
  alias?: ConfigChain<Alias>;
  paths: Record<string, string | string[]>;
  absoluteBaseUrl: string;
}) => {
  const mergedAlias = mergeAlias(alias);
  const normalizedPaths = Object.keys(paths).reduce(
    (result, key) => {
      addResolvedAlias(
        result,
        key.endsWith('$') ? key.slice(0, -1) : key,
        normalizePathValues({
          key,
          value: paths[key],
          absoluteBaseUrl,
        }),
      );

      return result;
    },
    {} as Record<string, string[]>,
  );

  Object.keys(mergedAlias).forEach(key => {
    if (key.includes('*') || key.endsWith('$')) {
      return;
    }

    // Expand `@service` into `@service/*` so runtime loaders can resolve
    // nested imports like `@service/user` with the same rules as tsconfig paths.
    addResolvedAlias(
      normalizedPaths,
      `${key}/*`,
      normalizePathValues({
        key,
        value: mergedAlias[key],
        absoluteBaseUrl,
      }).map(value => `${value}/*`),
    );
  });

  return normalizedPaths;
};

// Describes final runtime selection policy. UltraModern keeps the repository on
// TS-Go/Node-native TypeScript only; classic runtime transpilers are intentionally not supported.
export const resolveTsRuntimeRegisterMode = (): TsRuntimeRegisterMode => {
  const hasNativeTypeScriptSupport = (process as any).features?.typescript;
  const nodeVersion = process.versions.node.split('.').map(Number);
  const supportsNativeTypeScript =
    (nodeVersion[0] > 26 || (nodeVersion[0] === 26 && nodeVersion[1] >= 7)) &&
    [true, 'strip'].includes(hasNativeTypeScriptSupport);

  if (supportsNativeTypeScript) {
    return 'node-loader';
  }

  return 'unsupported';
};

/**
 * Setup TypeScript runtime support.
 * Register Node-native TypeScript path alias resolution.
 */
export const setupTsRuntime = async (
  appDir: string,
  distDir: string,
  alias?: ConfigChain<Alias>,
  options: TsRuntimeSetupOptions = {},
) => {
  if (resolveTsRuntimeRegisterMode() === 'unsupported') {
    throw new Error(
      `UltraModern.js requires Node.js >=26.7.0 with native TypeScript support; detected v${process.versions.node}. Legacy TypeScript runtime transpilers are unsupported.`,
    );
  }
  const tsconfigPath = resolveServerTsconfig(appDir, options.tsconfigPath);
  const isTsProject = await fs.pathExists(tsconfigPath);

  if (!isTsProject) {
    return;
  }

  const registerMode = resolveTsRuntimeRegisterMode();

  const aliasConfig = getAliasConfig(alias, {
    appDirectory: appDir,
    tsconfigPath,
  });
  const { paths = {}, absoluteBaseUrl = './' } = aliasConfig;
  const runtimePaths = createRuntimePaths({
    alias,
    paths,
    absoluteBaseUrl,
  });

  if (registerMode === 'node-loader') {
    const { registerPathsLoader } = await import('../esm/register-esm.mjs');
    await registerPathsLoader({
      appDir,
      baseUrl: absoluteBaseUrl || './',
      paths: runtimePaths,
    });
  }
};
