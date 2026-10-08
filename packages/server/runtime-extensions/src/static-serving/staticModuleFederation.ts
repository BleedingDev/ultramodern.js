import { fileReader } from '@modern-js/runtime-utils/fileReader';
import type { Middleware } from '@modern-js/server-core';
import { fs } from '@modern-js/utils';
import path from 'path';

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
    ssrRemoteEntry?: {
      path?: string;
      name?: string;
    };
    ssrPublicPath?: string;
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
  directory = '',
) => {
  for (const asset of [
    ...(assets?.js?.sync ?? []),
    ...(assets?.js?.async ?? []),
    ...(assets?.css?.sync ?? []),
    ...(assets?.css?.async ?? []),
  ]) {
    appendModuleFederationAsset(
      set,
      joinModuleFederationAssetPath(directory, asset),
    );
  }
};

const appendModuleFederationManifestAssets = (
  set: Set<string>,
  manifest: ModuleFederationManifest,
  directory?: string,
) => {
  for (const item of [
    ...(manifest.shared ?? []),
    ...(manifest.remotes ?? []),
    ...(manifest.exposes ?? []),
  ]) {
    appendModuleFederationAssets(set, item.assets, directory);
  }
};

/**
 * The output directory of the Node container a server-rendering host loads,
 * which the browser manifest publishes as its SSR snapshot: `ssrRemoteEntry`
 * resolved against `ssrPublicPath`. A container published elsewhere has no
 * files here.
 */
const getServerContainerDirectory = (
  metaData: ModuleFederationManifest['metaData'],
) => {
  const { publicPath, ssrPublicPath } = metaData ?? {};
  if (
    typeof publicPath !== 'string' ||
    typeof ssrPublicPath !== 'string' ||
    !ssrPublicPath.startsWith(publicPath)
  ) {
    return undefined;
  }
  const directory = ssrPublicPath
    .slice(publicPath.length)
    .replace(/^\/+|\/+$/gu, '');
  return directory &&
    directory
      .split('/')
      .every(segment => segment && segment !== '.' && segment !== '..')
    ? directory
    : undefined;
};

const readModuleFederationManifest = async (manifestPath: string) => {
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
  } catch {
    return undefined;
  }
};

/**
 * Serve the Node container's entry and the chunks its own manifest names, as
 * native development does. The application's server bundles share that
 * directory and stay private.
 */
const appendServerContainerAssets = async (
  pwd: string,
  set: Set<string>,
  metaData: ModuleFederationManifest['metaData'],
) => {
  const directory = getServerContainerDirectory(metaData);
  const remoteEntry = joinModuleFederationAssetPath(
    metaData?.ssrRemoteEntry?.path,
    metaData?.ssrRemoteEntry?.name,
  );
  if (!directory || !remoteEntry) {
    return;
  }
  set.add(joinModuleFederationAssetPath(directory, remoteEntry));
  const manifestPath = path.join(
    pwd,
    directory,
    MODULE_FEDERATION_MANIFEST_FILE,
  );
  if (!(await fs.pathExists(manifestPath))) {
    return;
  }
  const manifest = await readModuleFederationManifest(manifestPath);
  if (manifest) {
    appendModuleFederationManifestAssets(set, manifest, directory);
  }
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
    const manifest = await readModuleFederationManifest(manifestPath);
    if (!manifest) {
      continue;
    }

    try {
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
      appendModuleFederationManifestAssets(assets, manifest);
      if (manifestFile === MODULE_FEDERATION_MANIFEST_FILE) {
        await appendServerContainerAssets(pwd, assets, manifest.metaData);
      }
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
