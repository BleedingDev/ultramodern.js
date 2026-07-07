import type { Monitors } from '@modern-js/types';

import type { CollectDirectRemoteModuleFederationCssOptions } from './remote';

import { collectDirectRemoteModuleFederationCssWithMeta } from './remote';

export type ModuleFederationCssCollectorOptions =
  CollectDirectRemoteModuleFederationCssOptions & {
    /**
     * How long a successful remote CSS collection may be served from cache.
     * `0` disables caching (beyond in-flight request coalescing).
     */
    ttlMs?: number;
    /** Clock override for tests. */
    now?: () => number;
  };

/**
 * TTL cache around remote MF CSS collection. Remote manifests mutate
 * independently of the host (that is the point of module federation), so the
 * collection must expire: a boot-time-forever cache serves stale or broken
 * CSS links after any remote redeploy.
 *
 * Error handling: a collection where any remote fetch failed is never cached.
 * The last known-good asset list is served instead (stale-on-error) and the
 * next request retries the collection.
 */
export const createModuleFederationCssCollector = (
  pwd: string,
  options: ModuleFederationCssCollectorOptions = {},
) => {
  const { ttlMs = 0, now = Date.now, ...collectOptions } = options;
  const normalizedTtlMs = Math.max(0, ttlMs);

  let cached: { assets: string[]; expiresAt: number } | undefined;
  let lastGoodAssets: string[] | undefined;
  let inflight: Promise<string[]> | undefined;

  const refresh = (monitors?: Monitors) => {
    const promise = collectDirectRemoteModuleFederationCssWithMeta(pwd, {
      ...collectOptions,
      monitors: monitors ?? collectOptions.monitors,
    })
      .then(result => {
        if (!result.errored) {
          lastGoodAssets = result.assets;
          cached = {
            assets: result.assets,
            expiresAt: now() + normalizedTtlMs,
          };
          return result.assets;
        }

        // Error path: invalidate so the next request retries, and serve the
        // last known-good list when one exists.
        cached = undefined;
        return lastGoodAssets ?? result.assets;
      })
      .finally(() => {
        if (inflight === promise) {
          inflight = undefined;
        }
      });

    inflight = promise;
    return promise;
  };

  return {
    collect(monitors?: Monitors): Promise<string[]> {
      if (cached && now() < cached.expiresAt) {
        return Promise.resolve(cached.assets);
      }
      if (inflight) {
        return inflight;
      }
      return refresh(monitors);
    },
  };
};

export const DEFAULT_REMOTE_CSS_CACHE_TTL_MS = 30_000;
