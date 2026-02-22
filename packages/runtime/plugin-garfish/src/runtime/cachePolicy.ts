import type { ModuleInfo, ModulesInfo } from './useModuleApps';

const CACHE_VERSION_QUERY_KEY = 'mfv';
const RELATIVE_BASE_URL = 'https://modernjs.local';

function isAbsoluteHttpUrl(entry: string) {
  return /^https?:\/\//i.test(entry);
}

function isProtocolRelativeUrl(entry: string) {
  return /^\/\//.test(entry);
}

function toVersionToken(value: string) {
  return encodeURIComponent(value.slice(0, 256));
}

function resolveVersionToken(
  app: ModuleInfo,
  options: {
    manifestRuntimeDigest?: string;
    globalRuntimeDigest?: string;
  },
) {
  return (
    app.runtimeDigest ||
    app.runtimeMetadata?.runtimeDigest ||
    app.integrity ||
    app.runtimeMetadata?.integrity ||
    options.manifestRuntimeDigest ||
    options.globalRuntimeDigest
  );
}

function applyVersionQuery(entry: string, token: string) {
  let parsed: URL;
  try {
    parsed = new URL(entry, RELATIVE_BASE_URL);
  } catch (_error) {
    return entry;
  }

  if (parsed.searchParams.get(CACHE_VERSION_QUERY_KEY) === token) {
    return entry;
  }

  parsed.searchParams.set(CACHE_VERSION_QUERY_KEY, token);

  if (isAbsoluteHttpUrl(entry)) {
    return parsed.toString();
  }

  if (isProtocolRelativeUrl(entry)) {
    return `//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  const relativePath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (entry.startsWith('/')) {
    return relativePath;
  }
  return relativePath.replace(/^\//, '');
}

export function applyMfEntryCachePolicy(
  apps: ModulesInfo,
  options: {
    manifestRuntimeDigest?: string;
    globalRuntimeDigest?: string;
  } = {},
): ModulesInfo {
  return apps.map(app => {
    const version = resolveVersionToken(app, options);
    if (!version || !app.entry) {
      return app;
    }

    const pinnedEntry = applyVersionQuery(app.entry, toVersionToken(version));
    if (pinnedEntry === app.entry) {
      return app;
    }

    return {
      ...app,
      entry: pinnedEntry,
    };
  });
}
