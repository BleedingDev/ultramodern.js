const REMOTE_ENTRY_REGEXP = /(^|\/)remoteEntry(?:\.[a-zA-Z0-9_-]+)?\.js$/;

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
