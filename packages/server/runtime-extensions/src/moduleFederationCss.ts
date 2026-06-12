import { fileReader } from '@modern-js/runtime-utils/fileReader';
import type {
  Middleware,
  ServerEnv,
  ServerPlugin,
} from '@modern-js/server-core';
import type { Monitors } from '@modern-js/types';
import { fs, isProd } from '@modern-js/utils';
import path from 'path';

const MODULE_FEDERATION_MANIFEST_FILE = 'mf-manifest.json';
const DEFAULT_REMOTE_MANIFEST_TIMEOUT = 1500;

type ModuleFederationAssets = {
  css?: {
    sync?: string[];
    async?: string[];
  };
};

export type ModuleFederationManifest = {
  metaData?: {
    publicPath?: string;
  };
  shared?: Array<{
    assets?: ModuleFederationAssets;
  }>;
  remotes?: Array<{
    entry?: string;
    assets?: ModuleFederationAssets;
  }>;
  exposes?: Array<{
    assets?: ModuleFederationAssets;
  }>;
};

type FetchLike = (
  input: string,
  init?: {
    signal?: AbortSignal;
  },
) => Promise<Response>;

export type CollectDirectRemoteModuleFederationCssOptions = {
  fetcher?: FetchLike;
  monitors?: Monitors;
  timeout?: number;
};

const warn = (
  monitors: Monitors | undefined,
  message: string,
  ...args: unknown[]
) => {
  if (monitors) {
    monitors.warn(message, ...args);
    return;
  }

  console.warn(message, ...args);
};

const ensureTrailingSlash = (value: string) =>
  value.endsWith('/') ? value : `${value}/`;

const tryResolveUrl = (value: string, base: string) => {
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
};

const normalizeRemoteEntry = (entry: string) => {
  const value = entry.trim();
  if (!value) {
    return undefined;
  }

  const atIndex = value.lastIndexOf('@');
  return atIndex >= 0 ? value.slice(atIndex + 1) : value;
};

const getCssAssets = (assets?: ModuleFederationAssets) => [
  ...(assets?.css?.sync || []),
  ...(assets?.css?.async || []),
];

const getManifestFallbackBase = (manifestUrl: string) => {
  try {
    return new URL('.', manifestUrl).toString();
  } catch {
    return ensureTrailingSlash(manifestUrl);
  }
};

const getManifestPublicPathBase = (
  publicPath: string | undefined,
  manifestUrl: string,
) => {
  if (!publicPath || publicPath === 'auto') {
    return getManifestFallbackBase(manifestUrl);
  }

  const base = tryResolveUrl(ensureTrailingSlash(publicPath), manifestUrl);
  return base || getManifestFallbackBase(manifestUrl);
};

const appendResolvedCssAssets = (
  result: string[],
  seen: Set<string>,
  assets: string[],
  base: string,
) => {
  for (const asset of assets) {
    if (!asset) {
      continue;
    }

    const resolved = tryResolveUrl(asset, base);

    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      result.push(resolved);
    }
  }
};

export const collectModuleFederationManifestCss = (
  manifest: ModuleFederationManifest,
  manifestUrl: string,
) => {
  const base = getManifestPublicPathBase(
    manifest.metaData?.publicPath,
    manifestUrl,
  );
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of manifest.shared || []) {
    appendResolvedCssAssets(result, seen, getCssAssets(item.assets), base);
  }

  for (const item of manifest.exposes || []) {
    appendResolvedCssAssets(result, seen, getCssAssets(item.assets), base);
  }

  return result;
};

const fetchJsonWithTimeout = async (
  url: string,
  fetcher: FetchLike,
  timeout: number,
) => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const response = await Promise.race([
      fetcher(url, { signal: controller.signal }),
      new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(`Request timed out after ${timeout}ms`));
        }, timeout);
      }),
    ]);

    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status}`);
    }

    return (await response.json()) as ModuleFederationManifest;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const getHostManifest = async (
  pwd: string,
  monitors?: Monitors,
): Promise<ModuleFederationManifest | undefined> => {
  const manifestPath = path.join(pwd, MODULE_FEDERATION_MANIFEST_FILE);

  if (!(await fs.pathExists(manifestPath))) {
    return undefined;
  }

  const manifestBuffer = await fileReader.readFileFromSystem(
    manifestPath,
    'buffer',
  );

  if (manifestBuffer === null) {
    return undefined;
  }

  try {
    return JSON.parse(
      manifestBuffer.toString('utf-8'),
    ) as ModuleFederationManifest;
  } catch (error) {
    warn(
      monitors,
      'Parse module federation manifest failed, error = %s',
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
};

export type RemoteModuleFederationCssCollection = {
  assets: string[];
  /**
   * True when at least one remote manifest fetch failed, i.e. `assets` may be
   * incomplete and should not be cached long-term.
   */
  errored: boolean;
};

export const collectDirectRemoteModuleFederationCssWithMeta = async (
  pwd: string,
  options: CollectDirectRemoteModuleFederationCssOptions = {},
): Promise<RemoteModuleFederationCssCollection> => {
  const hostManifest = await getHostManifest(pwd, options.monitors);

  if (!hostManifest) {
    return { assets: [], errored: false };
  }

  const fetcher = options.fetcher || globalThis.fetch?.bind(globalThis);
  if (!fetcher) {
    warn(
      options.monitors,
      'Skip module federation remote CSS collection because fetch is unavailable.',
    );
    return { assets: [], errored: false };
  }

  const timeout = options.timeout ?? DEFAULT_REMOTE_MANIFEST_TIMEOUT;

  // Fetch all remote manifests in parallel so SSR latency is bounded by the
  // slowest remote rather than the sum of all remotes.
  const remoteResults = await Promise.all(
    (hostManifest.remotes || []).map(
      async (remote): Promise<{ assets: string[]; errored: boolean }> => {
        if (!remote.entry) {
          return { assets: [], errored: false };
        }

        const remoteEntry = normalizeRemoteEntry(remote.entry);
        if (!remoteEntry) {
          return { assets: [], errored: false };
        }

        let remoteManifestUrl: string;
        try {
          remoteManifestUrl = new URL(remoteEntry).toString();
        } catch {
          warn(
            options.monitors,
            'Skip module federation remote CSS collection for non-absolute manifest URL %s',
            remoteEntry,
          );
          return { assets: [], errored: false };
        }

        try {
          const remoteManifest = await fetchJsonWithTimeout(
            remoteManifestUrl,
            fetcher,
            timeout,
          );
          return {
            assets: collectModuleFederationManifestCss(
              remoteManifest,
              remoteManifestUrl,
            ),
            errored: false,
          };
        } catch (error) {
          warn(
            options.monitors,
            'Load module federation remote manifest %s failed, error = %s',
            remoteManifestUrl,
            error instanceof Error ? error.message : error,
          );
          return { assets: [], errored: true };
        }
      },
    ),
  );

  const cssAssets: string[] = [];
  const seen = new Set<string>();
  let errored = false;
  for (const result of remoteResults) {
    errored = errored || result.errored;
    for (const asset of result.assets) {
      if (!seen.has(asset)) {
        seen.add(asset);
        cssAssets.push(asset);
      }
    }
  }

  return { assets: cssAssets, errored };
};

export const collectDirectRemoteModuleFederationCss = async (
  pwd: string,
  options: CollectDirectRemoteModuleFederationCssOptions = {},
) => {
  const { assets } = await collectDirectRemoteModuleFederationCssWithMeta(
    pwd,
    options,
  );
  return assets;
};

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

const DEFAULT_REMOTE_CSS_CACHE_TTL_MS = 30_000;

export type ModuleFederationCssPluginOptions = {
  /**
   * TTL for the cached remote CSS collection in production.
   *
   * @default 30000 in production, 0 (no caching) otherwise
   */
  remoteCssCacheTtlMs?: number;
};

/**
 * Enriches the request-scoped server manifest with CSS assets collected from
 * direct module federation remotes, so SSR/CSR-RSC rendering can inline
 * `<link>` tags for remote CSS.
 *
 * In production the collection is cached with a TTL (default 30s) instead of
 * being pinned at boot: remote manifests change on every remote redeploy, and
 * fetch failures must not pin an empty/partial list for the process lifetime.
 *
 * This plugin must be registered after `injectResourcePlugin()` (which sets
 * `serverManifest` on the request context). @modern-js/prod-server wires it
 * into its plugin assembly for both production and dev servers.
 */
export const injectModuleFederationCssPlugin = (
  options: ModuleFederationCssPluginOptions = {},
): ServerPlugin => ({
  name: '@modern-js/inject-module-federation-css',

  setup(api) {
    api.onPrepare(() => {
      const { middlewares, distDirectory: pwd } = api.getServerContext();

      if (!pwd) {
        return;
      }

      const ttlMs = Math.max(
        0,
        options.remoteCssCacheTtlMs ??
          (isProd() ? DEFAULT_REMOTE_CSS_CACHE_TTL_MS : 0),
      );
      const collector = createModuleFederationCssCollector(pwd, { ttlMs });

      if (isProd()) {
        // Warm up the remote manifest fetch at prepare time, mirroring the
        // server manifest warmup of injectResourcePlugin, so the first
        // request does not pay the collection latency. Failures are retried
        // on the next request instead of failing startup.
        collector.collect().catch(() => {});
      }

      const handler: Middleware<ServerEnv> = async (c, next) => {
        const serverManifest = c.get('serverManifest');

        if (serverManifest && !serverManifest.moduleFederationCssAssets) {
          const monitors = c.get('monitors');
          const moduleFederationCssAssets = await collector.collect(monitors);

          c.set('serverManifest', {
            ...serverManifest,
            moduleFederationCssAssets,
          });
        }

        await next();
      };

      middlewares.push({
        name: 'inject-module-federation-css',
        handler,
      });
    });
  },
});
