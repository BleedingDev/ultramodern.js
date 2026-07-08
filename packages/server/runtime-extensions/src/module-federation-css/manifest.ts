import path from 'node:path';
import { fileReader } from '@modern-js/runtime-utils/fileReader';
import type { Monitors } from '@modern-js/types';
import { fs } from '@modern-js/utils';

const MODULE_FEDERATION_MANIFEST_FILE = 'mf-manifest.json';

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

export const warn = (
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

export const ensureTrailingSlash = (value: string) =>
  value.endsWith('/') ? value : `${value}/`;

const tryResolveUrl = (value: string, base: string) => {
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
};

export const normalizeRemoteEntry = (entry: string) => {
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

export const getHostManifest = async (
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
