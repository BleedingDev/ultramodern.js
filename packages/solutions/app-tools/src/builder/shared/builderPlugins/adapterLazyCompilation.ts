import { isUseRsc, logger } from '@modern-js/utils';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import {
  aggregateEagerRouteComponentFiles,
  planRouteEagerLazyCompilation,
} from '../lazyCompilation';
import type { BuilderOptions } from '../types';

export const builderPluginAdapterLazyCompilation = (
  options: BuilderOptions,
): RsbuildPlugin => ({
  name: 'builder-plugin-adapter-modern-lazy-compilation',

  setup(api) {
    api.modifyRsbuildConfig(config => {
      const lazyCompilation = getRouteEagerLazyCompilation(options, config);
      if (lazyCompilation === undefined) {
        return config;
      }
      return {
        ...config,
        dev: {
          ...config.dev,
          lazyCompilation,
        },
      };
    });
  },
});

function getRouteEagerLazyCompilation(
  options: BuilderOptions,
  config: { dev?: { lazyCompilation?: unknown } },
): Rspack.LazyCompilationOptions | undefined {
  const current = config.dev?.lazyCompilation;
  if (!current || isUseRsc(options.normalizedConfig)) {
    return undefined;
  }

  const plan = planRouteEagerLazyCompilation(
    current,
    aggregateEagerRouteComponentFiles(options.eagerRouteComponentFilesByEntry),
  );
  if (!plan.apply) {
    if (plan.unresolvedByEntry) {
      warnUnresolvedRouteComponents(
        options.appContext.appDirectory,
        plan.unresolvedByEntry,
      );
    }
    return undefined;
  }

  return plan.lazyCompilation as Rspack.LazyCompilationOptions;
}

const warnedLazyApps = new Set<string>();

function warnUnresolvedRouteComponents(
  appDirectory: string,
  unresolvedByEntry: Map<string, string[]>,
): void {
  if (warnedLazyApps.has(appDirectory)) {
    return;
  }
  warnedLazyApps.add(appDirectory);
  const detail = Array.from(unresolvedByEntry)
    .map(([entry, components]) => `${entry}: ${components.join(', ')}`)
    .join('; ');
  logger.warn(
    `[lazyCompilation] Skipped route-eager optimization because some route components could not be resolved to a file (${detail}). Lazy compilation may delay route rendering for these routes.`,
  );
}
