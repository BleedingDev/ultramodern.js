import { fileReader } from '@modern-js/runtime-utils/fileReader';
import { fs } from '@modern-js/utils';
import path from 'path';
import type { Middleware } from '../../../types';

export const MODULE_FEDERATION_MANIFEST_FILE = 'mf-manifest.json';
const BACKEND_MODULE_FEDERATION_MANIFEST_FILE = 'backend-mf-manifest.json';

const MODULE_FEDERATION_MANIFEST_FILES = [
  MODULE_FEDERATION_MANIFEST_FILE,
  BACKEND_MODULE_FEDERATION_MANIFEST_FILE,
];
const MODULE_FEDERATION_OPTIONAL_FILES = ['mf-stats.json'];

type ModuleFederationManifest = {
  metaData?: {
    remoteEntry?: {
      path?: string;
      name?: string;
    };
    publicPath?: string;
    types?: {
      path?: string;
      zip?: string;
      api?: string;
    };
  };
  shared?: Array<{
    assets?: ModuleFederationAssets;
  }>;
  remotes?: Array<{
    assets?: ModuleFederationAssets;
  }>;
  exposes?: Array<{
    assets?: ModuleFederationAssets;
  }>;
};

type ModuleFederationAssets = {
  js?: {
    sync?: string[];
    async?: string[];
  };
  css?: {
    sync?: string[];
    async?: string[];
  };
};

export type ModuleFederationServeAssets = {
  assets: Set<string>;
  remoteEntries: Set<string>;
};

const trimLeadingSlash = (value: string) => value.replace(/^\/+/, '');

export const getModuleFederationRequestPath = (
  pathname: string,
  pathPrefix: string,
) => {
  const normalizedPrefix = `/${trimLeadingSlash(pathPrefix)}`.replace(
    /\/+$/u,
    '',
  );
  const requestPath =
    normalizedPrefix &&
    (pathname === normalizedPrefix ||
      pathname.startsWith(`${normalizedPrefix}/`))
      ? pathname.slice(normalizedPrefix.length)
      : pathname;

  return trimLeadingSlash(requestPath);
};

export const isModuleFederationManifestRequest = (requestPath: string) =>
  MODULE_FEDERATION_MANIFEST_FILES.includes(requestPath);

export const isBackendModuleFederationManifestRequest = (requestPath: string) =>
  requestPath === BACKEND_MODULE_FEDERATION_MANIFEST_FILE;

export const applyModuleFederationAssetHeaders = (
  c: Parameters<Middleware>[0],
) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Headers', '*');
  c.header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
};

const joinModuleFederationAssetPath = (
  assetPath?: string,
  assetName?: string,
) => {
  if (!assetName) {
    return '';
  }

  return trimLeadingSlash(path.posix.join(assetPath || '', assetName));
};

const appendModuleFederationAsset = (set: Set<string>, assetPath?: string) => {
  if (assetPath) {
    set.add(trimLeadingSlash(assetPath));
  }
};

const appendModuleFederationAssets = (
  set: Set<string>,
  assets?: ModuleFederationAssets,
) => {
  assets?.js?.sync?.forEach(asset => appendModuleFederationAsset(set, asset));
  assets?.js?.async?.forEach(asset => appendModuleFederationAsset(set, asset));
  assets?.css?.sync?.forEach(asset => appendModuleFederationAsset(set, asset));
  assets?.css?.async?.forEach(asset => appendModuleFederationAsset(set, asset));
};

const hasAbsoluteProtocol = (value: string) =>
  /^https?:\/\//i.test(value) || value.startsWith('//');

const ensureLeadingSlash = (value: string) => {
  if (value === '') {
    return '/';
  }
  return value.startsWith('/') ? value : `/${value}`;
};

const ensureTrailingSlash = (value: string) =>
  value.endsWith('/') ? value : `${value}/`;

export const patchModuleFederationManifestPublicPath = (
  c: Parameters<Middleware>[0],
  manifestBuffer: Buffer,
  pathPrefix: string,
) => {
  try {
    const manifest = JSON.parse(
      manifestBuffer.toString('utf-8'),
    ) as ModuleFederationManifest;
    const publicPath = manifest.metaData?.publicPath;

    if (!publicPath || hasAbsoluteProtocol(publicPath)) {
      return manifestBuffer;
    }

    const requestURL = new URL(c.req.url);
    const prefixPath = ensureTrailingSlash(
      ensureLeadingSlash(pathPrefix || '/'),
    );
    manifest.metaData = {
      ...manifest.metaData,
      publicPath: `${requestURL.origin}${prefixPath}`,
    };

    return Buffer.from(JSON.stringify(manifest), 'utf-8');
  } catch {
    return manifestBuffer;
  }
};

export const patchModuleFederationRemoteEntryPublicPath = (
  c: Parameters<Middleware>[0],
  remoteEntryBuffer: Buffer,
  pathPrefix: string,
) => {
  const requestURL = new URL(c.req.url);
  const prefixPath = ensureTrailingSlash(ensureLeadingSlash(pathPrefix || '/'));
  const publicPath = `${requestURL.origin}${prefixPath}`;
  const source = remoteEntryBuffer.toString('utf-8');
  const patched = source
    .replace(
      /__webpack_require__\.p\s*=\s*(['"`])[^'"`]*\1;/,
      `__webpack_require__.p = ${JSON.stringify(publicPath)};`,
    )
    .replace(
      /__rspack_require__\.p\s*=\s*(['"`])[^'"`]*\1;/,
      `__rspack_require__.p = ${JSON.stringify(publicPath)};`,
    );

  if (patched === source) {
    return remoteEntryBuffer;
  }

  return Buffer.from(patched, 'utf-8');
};

export const getModuleFederationAssetList = async (
  pwd: string,
): Promise<ModuleFederationServeAssets> => {
  const assets = new Set<string>();
  const remoteEntries = new Set<string>();
  let manifestFound = false;

  for (const manifestFile of MODULE_FEDERATION_MANIFEST_FILES) {
    const manifestPath = path.join(pwd, manifestFile);
    if (!(await fs.pathExists(manifestPath))) {
      continue;
    }

    manifestFound = true;
    assets.add(manifestFile);
    const manifestBuffer = await fileReader.readFileFromSystem(
      manifestPath,
      'buffer',
    );
    if (manifestBuffer === null) {
      continue;
    }

    try {
      const manifest = JSON.parse(
        manifestBuffer.toString('utf-8'),
      ) as ModuleFederationManifest;
      const remoteEntry = joinModuleFederationAssetPath(
        manifest.metaData?.remoteEntry?.path,
        manifest.metaData?.remoteEntry?.name,
      );
      const dtsZip = joinModuleFederationAssetPath(
        manifest.metaData?.types?.path,
        manifest.metaData?.types?.zip,
      );
      const dtsApi = joinModuleFederationAssetPath(
        manifest.metaData?.types?.path,
        manifest.metaData?.types?.api,
      );

      if (remoteEntry) {
        assets.add(remoteEntry);
        remoteEntries.add(remoteEntry);
      }
      appendModuleFederationAsset(assets, dtsZip);
      appendModuleFederationAsset(assets, dtsApi);
      manifest.shared?.forEach(item =>
        appendModuleFederationAssets(assets, item.assets),
      );
      manifest.remotes?.forEach(item =>
        appendModuleFederationAssets(assets, item.assets),
      );
      manifest.exposes?.forEach(item =>
        appendModuleFederationAssets(assets, item.assets),
      );
    } catch {}
  }

  if (manifestFound) {
    for (const filename of MODULE_FEDERATION_OPTIONAL_FILES) {
      if (await fs.pathExists(path.join(pwd, filename))) {
        assets.add(filename);
      }
    }
  }

  return {
    assets,
    remoteEntries,
  };
};
