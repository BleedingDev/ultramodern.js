import { fileReader } from '@modern-js/runtime-utils/fileReader';
import type { Monitors } from '@modern-js/types';
import { fs } from '@modern-js/utils';
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

export const collectDirectRemoteModuleFederationCss = async (
  pwd: string,
  options: CollectDirectRemoteModuleFederationCssOptions = {},
) => {
  const hostManifest = await getHostManifest(pwd, options.monitors);

  if (!hostManifest) {
    return [];
  }

  const fetcher = options.fetcher || globalThis.fetch?.bind(globalThis);
  if (!fetcher) {
    warn(
      options.monitors,
      'Skip module federation remote CSS collection because fetch is unavailable.',
    );
    return [];
  }

  const timeout = options.timeout ?? DEFAULT_REMOTE_MANIFEST_TIMEOUT;
  const cssAssets: string[] = [];
  const seen = new Set<string>();

  for (const remote of hostManifest.remotes || []) {
    if (!remote.entry) {
      continue;
    }

    const remoteEntry = normalizeRemoteEntry(remote.entry);
    if (!remoteEntry) {
      continue;
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
      continue;
    }

    try {
      const remoteManifest = await fetchJsonWithTimeout(
        remoteManifestUrl,
        fetcher,
        timeout,
      );
      for (const asset of collectModuleFederationManifestCss(
        remoteManifest,
        remoteManifestUrl,
      )) {
        if (!seen.has(asset)) {
          seen.add(asset);
          cssAssets.push(asset);
        }
      }
    } catch (error) {
      warn(
        options.monitors,
        'Load module federation remote manifest %s failed, error = %s',
        remoteManifestUrl,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return cssAssets;
};
