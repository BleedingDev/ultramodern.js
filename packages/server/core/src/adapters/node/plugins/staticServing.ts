import { fileReader } from '@modern-js/runtime-utils/fileReader';
import type { ServerRoute } from '@modern-js/types';
import { fs } from '@modern-js/utils';
import { getMimeType } from 'hono/utils/mime';
import path from 'path';
import type { Middleware } from '../../../types';
import {
  applyModuleFederationAssetHeaders,
  getModuleFederationAssetList,
  getModuleFederationRequestPath,
  isBackendModuleFederationManifestRequest,
  isModuleFederationManifestRequest,
  type ModuleFederationServeAssets,
  patchModuleFederationManifestPublicPath,
  patchModuleFederationRemoteEntryPublicPath,
} from './staticModuleFederation';
import {
  applyPreCompressedAssetHeaders,
  resolvePreCompressedAsset,
} from './staticPrecompressed';

type MiddlewareContext = Parameters<Middleware>[0];

type StaticServingRequest = {
  requestPath: string;
  isModuleFederationAsset: boolean;
  isModuleFederationRemoteEntry: boolean;
};

type StaticServingOptions = {
  pwd: string;
  pathPrefix: string;
};

const getStaticMimeType = (filename: string) =>
  getMimeType(filename) ??
  (path.extname(filename).toLowerCase() === '.cjs'
    ? 'text/javascript; charset=UTF-8'
    : undefined);

export const servePreCompressedPublicRouteAsset = async (
  c: MiddlewareContext,
  pwd: string,
  route: ServerRoute,
) => {
  const { entryPath } = route;
  const originFilename = path.join(pwd, entryPath);
  const preCompressedAsset = await resolvePreCompressedAsset(c, originFilename);
  const filename = preCompressedAsset.selected?.filepath ?? originFilename;
  const data = await fileReader.readFile(filename, 'buffer');
  const mimeType = getStaticMimeType(originFilename);

  if (data === null) {
    return null;
  }

  // Hono's `Data` type does not accept Node.js `Buffer<ArrayBufferLike>` directly.
  // Convert Buffer to `Uint8Array<ArrayBuffer>` without copying.
  const body = new Uint8Array(
    data.buffer as ArrayBuffer,
    data.byteOffset,
    data.byteLength,
  );
  if (mimeType) {
    c.header('Content-Type', mimeType);
  }

  Object.entries(route.responseHeaders || {}).forEach(([k, v]) => {
    c.header(k, v as string);
  });

  applyPreCompressedAssetHeaders(c, preCompressedAsset);

  c.header('Content-Length', String(data.byteLength));

  return c.body(body, 200);
};

// Check whether `target` is located inside `root` (or is `root` itself), so
// resolved static asset paths cannot escape the serving directory via `../`.
const isPathInside = (target: string, root: string): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
};

const resolvePublicDirectoryAsset = async (pwd: string, pathname: string) => {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname).replace(/\\/gu, '/');
  } catch {
    return null;
  }

  if (
    decodedPathname.includes('\0') ||
    decodedPathname.split('/').includes('..')
  ) {
    return null;
  }

  const publicDirectory = path.join(pwd, 'public');
  const filepath = path.resolve(
    publicDirectory,
    decodedPathname.replace(/^\/+/u, ''),
  );
  if (!isPathInside(filepath, publicDirectory)) {
    return null;
  }

  try {
    const [realPublicDirectory, realFilepath, stat] = await Promise.all([
      fs.realpath(publicDirectory),
      fs.realpath(filepath),
      fs.stat(filepath),
    ]);
    if (!stat.isFile() || !isPathInside(realFilepath, realPublicDirectory)) {
      return null;
    }
    return realFilepath;
  } catch {
    return null;
  }
};

/**
 * Serves post-build convention assets generated under dist/public at their
 * root URL. This is intentionally independent of config/public and route.json:
 * the generator runs after the route manifest is built.
 */
export const servePublicDirectoryAsset = async (
  c: MiddlewareContext,
  pwd: string,
) => {
  const method = c.req.raw.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return null;
  }

  const originFilename = await resolvePublicDirectoryAsset(pwd, c.req.path);
  if (originFilename === null) {
    return null;
  }

  const preCompressedAsset = await resolvePreCompressedAsset(c, originFilename);
  const selectedFilename =
    preCompressedAsset.selected?.filepath ?? originFilename;
  const publicDirectory = await fs.realpath(path.join(pwd, 'public'));
  let realSelectedFilename: string;
  try {
    realSelectedFilename = await fs.realpath(selectedFilename);
  } catch {
    return null;
  }
  if (!isPathInside(realSelectedFilename, publicDirectory)) {
    return null;
  }

  const data = await fileReader.readFileFromSystem(
    realSelectedFilename,
    'buffer',
  );
  if (data === null) {
    return null;
  }

  const mimeType = getStaticMimeType(originFilename);
  if (mimeType) {
    c.header('Content-Type', mimeType);
  }
  applyPreCompressedAssetHeaders(c, preCompressedAsset);
  c.header('Content-Length', String(data.byteLength));

  if (method === 'HEAD') {
    return c.body(null, 200);
  }
  const body = new Uint8Array(
    data.buffer as ArrayBuffer,
    data.byteOffset,
    data.byteLength,
  );
  return c.body(body, 200);
};

export const createModuleFederationStaticServing = ({
  pwd,
  pathPrefix,
}: StaticServingOptions) => {
  let moduleFederationAssetsPromise: Promise<ModuleFederationServeAssets> | null =
    null;

  const getModuleFederationAssets = async () => {
    if (!moduleFederationAssetsPromise) {
      moduleFederationAssetsPromise = getModuleFederationAssetList(pwd);
    }

    return moduleFederationAssetsPromise;
  };

  const resolveRequest = async (
    pathname: string,
  ): Promise<StaticServingRequest | null> => {
    const requestPath = getModuleFederationRequestPath(pathname, pathPrefix);

    if (requestPath.includes('..')) {
      return null;
    }

    const moduleFederationAssetMeta = await getModuleFederationAssets();
    return {
      requestPath,
      isModuleFederationAsset:
        moduleFederationAssetMeta.assets.has(requestPath),
      isModuleFederationRemoteEntry:
        moduleFederationAssetMeta.remoteEntries.has(requestPath),
    };
  };

  const serveFile = async (
    c: MiddlewareContext,
    filepath: string,
    moduleFederationAsset = false,
    moduleFederationRemoteEntry = false,
    requestPath = '',
  ) => {
    if (moduleFederationAsset) {
      applyModuleFederationAssetHeaders(c);
    }

    const mimeType = getStaticMimeType(filepath);
    if (mimeType) {
      c.header('Content-Type', mimeType);
    }

    const shouldPatchManifest =
      moduleFederationAsset &&
      isModuleFederationManifestRequest(requestPath) &&
      !isBackendModuleFederationManifestRequest(requestPath);
    const shouldPatchRemoteEntry = moduleFederationRemoteEntry;
    const canUsePreCompressed = !shouldPatchManifest && !shouldPatchRemoteEntry;
    const preCompressedAsset = canUsePreCompressed
      ? await resolvePreCompressedAsset(c, filepath)
      : {
          selected: null,
          hasVariant: false,
        };
    const targetFilepath = preCompressedAsset.selected?.filepath ?? filepath;

    // serve static middleware always read file from real filesystem.
    const chunk = await fileReader.readFileFromSystem(targetFilepath, 'buffer');

    if (chunk === null) {
      return null;
    }

    const responseChunk = shouldPatchManifest
      ? patchModuleFederationManifestPublicPath(c, chunk, pathPrefix)
      : shouldPatchRemoteEntry
        ? patchModuleFederationRemoteEntryPublicPath(c, chunk, pathPrefix)
        : chunk;

    applyPreCompressedAssetHeaders(c, preCompressedAsset);

    // TODO: handle http range
    c.header('Content-Length', String(responseChunk.byteLength));
    // See comment above: convert Buffer<ArrayBufferLike> to Uint8Array<ArrayBuffer>.
    const body = new Uint8Array(
      responseChunk.buffer as ArrayBuffer,
      responseChunk.byteOffset,
      responseChunk.byteLength,
    );
    return c.body(body, 200);
  };

  const serveByPath = async (
    c: MiddlewareContext,
    filepath: string,
    request: StaticServingRequest,
    moduleFederationAsset = false,
    moduleFederationRemoteEntry = false,
  ) => {
    // Prevent path traversal: `pathname` is user-controlled and may contain
    // `../` sequences (Hono decodes `%2e%2e` in `c.req.path`), which
    // `path.join` resolves. Reject any resolved path that escapes `pwd`.
    if (!isPathInside(filepath, pwd)) {
      return null;
    }

    if (!(await fs.pathExists(filepath))) {
      return null;
    }

    return serveFile(
      c,
      filepath,
      moduleFederationAsset,
      moduleFederationRemoteEntry,
      request.requestPath,
    );
  };

  const serveStaticHit = (
    c: MiddlewareContext,
    request: StaticServingRequest,
  ) =>
    serveByPath(
      c,
      path.join(pwd, request.requestPath),
      request,
      request.isModuleFederationAsset,
      request.isModuleFederationRemoteEntry,
    );

  const serveModuleFederationAsset = (
    c: MiddlewareContext,
    request: StaticServingRequest,
  ) => {
    if (!request.isModuleFederationAsset) {
      return null;
    }

    return serveByPath(
      c,
      path.join(pwd, request.requestPath),
      request,
      true,
      request.isModuleFederationRemoteEntry,
    );
  };

  return {
    resolveRequest,
    serveStaticHit,
    serveModuleFederationAsset,
  };
};
