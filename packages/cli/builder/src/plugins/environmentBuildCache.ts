import path from 'node:path';
import type { MergedEnvironmentConfig, RsbuildPlugin } from '@rsbuild/core';

const DEFAULT_RSPACK_CACHE_DIRECTORY = 'node_modules/.cache/rspack';

type BuildCacheConfig = Exclude<
  MergedEnvironmentConfig['performance']['buildCache'],
  boolean | undefined
>;

function sanitizeCachePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, '_');
}

function pathEndsWithSegment(filePath: string, segment: string): boolean {
  const normalized = filePath.replace(/[\\/]+$/u, '');
  return normalized.split(/[\\/]+/u).at(-1) === segment;
}

export function isolateEnvironmentBuildCacheDirectory(
  cacheDirectory: string | undefined,
  environmentName: string,
): string {
  const segment = sanitizeCachePathSegment(environmentName);
  const baseDirectory = cacheDirectory || DEFAULT_RSPACK_CACHE_DIRECTORY;

  return pathEndsWithSegment(baseDirectory, segment)
    ? baseDirectory
    : path.join(baseDirectory, segment);
}

export const pluginEnvironmentBuildCacheIsolation = (): RsbuildPlugin => ({
  name: 'modern-js:environment-build-cache-isolation',

  setup(api) {
    api.modifyEnvironmentConfig({
      order: 'post',
      handler: (config, { name }) => {
        const buildCache = config.performance.buildCache;

        if (buildCache === false || buildCache === undefined) {
          return;
        }

        const buildCacheConfig: BuildCacheConfig =
          buildCache === true ? {} : buildCache;

        return {
          ...config,
          performance: {
            ...config.performance,
            buildCache: {
              ...buildCacheConfig,
              cacheDirectory: isolateEnvironmentBuildCacheDirectory(
                buildCacheConfig.cacheDirectory,
                name,
              ),
            },
          },
        };
      },
    });
  },
});
