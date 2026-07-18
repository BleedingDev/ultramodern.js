import type {
  Middleware,
  ServerEnv,
  ServerPlugin,
} from '@modern-js/server-core';

const REMOTE_ENTRY_REGEXP =
  /(^|\/)(?:backendRemoteEntry\.cjs|remoteEntry(?:\.[a-zA-Z0-9_-]+)?\.js)$/;

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.find(item => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

export function getRequestPathname(url: string) {
  try {
    return new URL(url, 'http://modernjs.local').pathname;
  } catch (_error) {
    return url.split('?')[0] || '/';
  }
}

export function isMfManifestAsset(pathname: string) {
  return (
    pathname.endsWith('/backend-mf-manifest.json') ||
    pathname.endsWith('/mf-manifest.json') ||
    pathname.endsWith('/mf-stats.json')
  );
}

export function isMfRemoteEntryAsset(pathname: string) {
  return REMOTE_ENTRY_REGEXP.test(pathname);
}

function hasRemoteVersionPin(query: Record<string, unknown> = {}) {
  return Boolean(
    firstQueryValue(query.mfv) ||
      firstQueryValue(query.v) ||
      firstQueryValue(query.version),
  );
}

export function resolveMfAssetCacheHeaders(
  url: string,
  query: Record<string, unknown> = {},
) {
  const pathname = getRequestPathname(url);

  if (isMfManifestAsset(pathname)) {
    return {
      'cache-control': 'no-cache, no-store, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
    };
  }

  if (isMfRemoteEntryAsset(pathname)) {
    return hasRemoteVersionPin(query)
      ? {
          'cache-control': 'public, max-age=31536000, immutable',
        }
      : {
          'cache-control': 'public, max-age=0, must-revalidate',
        };
  }

  return undefined;
}

/**
 * Applies the documented MF asset cache-header policy (ADR-0002) to responses
 * for module federation manifest/remoteEntry endpoints:
 *
 * - `mf-manifest.json` / `mf-stats.json` are never cached (`no-store`), so
 *   hosts always observe remote redeploys;
 * - `remoteEntry*.js` revalidates unless explicitly version-pinned via a
 *   `mfv`/`v`/`version` query parameter, in which case it is immutable.
 *
 * Registered by @modern-js/prod-server next to the other fork plugins; the
 * middleware runs in the `pre` phase so it wraps the static-file middleware
 * that actually serves these assets.
 */
export const injectMfAssetCacheHeadersPlugin = (): ServerPlugin => ({
  name: '@modern-js/inject-mf-asset-cache-headers',

  setup(api) {
    api.onPrepare(() => {
      const { middlewares } = api.getServerContext();

      const handler: Middleware<ServerEnv> = async (c, next) => {
        await next();

        // Never attach cache policies to error responses: an `immutable`
        // 404 remoteEntry could otherwise be cached for a year.
        if (!c.res || c.res.status >= 400) {
          return;
        }

        const headers = resolveMfAssetCacheHeaders(c.req.path, c.req.query());
        if (!headers) {
          return;
        }

        for (const [name, value] of Object.entries(headers)) {
          c.res.headers.set(name, value);
        }
      };

      middlewares.push({
        name: 'mf-asset-cache-headers',
        handler,
        order: 'pre',
      });
    });
  },
});
