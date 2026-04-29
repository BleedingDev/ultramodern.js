import { fileReader } from '@modern-js/runtime-utils/fileReader';
import type { ServerRoute } from '@modern-js/types';
import { fs } from '@modern-js/utils';
import { getMimeType } from 'hono/utils/mime';
import path from 'path';
import type {
  HonoRequest,
  HtmlNormalizedConfig,
  Middleware,
  OutputNormalizedConfig,
  ServerNormalizedConfig,
  ServerPlugin,
} from '../../../types';
import { sortRoutes } from '../../../utils';
import { getPublicDirPatterns } from '../../../utils/publicDir';

export const serverStaticPlugin = (): ServerPlugin => ({
  name: '@modern-js/plugin-server-static',

  setup(api) {
    api.onPrepare(() => {
      const {
        middlewares,
        distDirectory: pwd,
        routes,
      } = api.getServerContext();

      const config = api.getServerConfig();

      const serverStaticMiddleware = createStaticMiddleware({
        pwd: pwd!,
        routes,
        output: config.output || {},
        html: config.html || {},
        server: config.server || {},
      });

      middlewares.push({
        name: 'server-static',

        handler: serverStaticMiddleware,
      });
    });
  },
});

export type PublicMiddlwareOptions = {
  pwd: string;
  routes: ServerRoute[];
};

type SupportedEncoding = 'br' | 'gzip';

type ResolvePreCompressedAssetResult = {
  selected: {
    filepath: string;
    encoding: SupportedEncoding;
  } | null;
  hasVariant: boolean;
};

const PRE_COMPRESSED_ASSET_EXTENSIONS: Record<SupportedEncoding, string> = {
  br: '.br',
  gzip: '.gz',
};

const PRE_COMPRESSED_SUPPORTED_ENCODINGS: SupportedEncoding[] = ['br', 'gzip'];

const parseAcceptEncoding = (value: string) =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [rawName, ...params] = item.split(';');
      const name = rawName.trim().toLowerCase();
      let q = 1;

      for (const param of params) {
        const [key, rawValue] = param.split('=').map(v => v.trim());
        if (key.toLowerCase() !== 'q' || rawValue == null) {
          continue;
        }

        const parsedQ = Number(rawValue);
        if (!Number.isNaN(parsedQ)) {
          q = Math.max(0, Math.min(parsedQ, 1));
        }
      }

      return {
        name,
        q,
      };
    });

const getAcceptedEncodings = (
  value: string | null | undefined,
): SupportedEncoding[] => {
  if (!value) {
    return [];
  }

  const parsed = parseAcceptEncoding(value);
  const qualityByEncoding = new Map<string, number>();
  let wildcardQuality: number | undefined;

  for (const { name, q } of parsed) {
    if (name === '*') {
      wildcardQuality = q;
      continue;
    }
    qualityByEncoding.set(name, q);
  }

  const getQuality = (encoding: SupportedEncoding) => {
    const explicit = qualityByEncoding.get(encoding);
    if (explicit !== undefined) {
      return explicit;
    }
    return wildcardQuality ?? 0;
  };

  return PRE_COMPRESSED_SUPPORTED_ENCODINGS.map(encoding => ({
    encoding,
    quality: getQuality(encoding),
  }))
    .filter(item => item.quality > 0)
    .sort((a, b) => b.quality - a.quality)
    .map(item => item.encoding);
};

const appendVaryHeader = (
  c: Parameters<Middleware>[0],
  value: string,
): void => {
  const current = c.res.headers.get('Vary');

  if (!current) {
    c.header('Vary', value);
    return;
  }

  const values = current
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);

  if (!values.includes(value.toLowerCase())) {
    c.header('Vary', `${current}, ${value}`);
  }
};

const resolvePreCompressedAsset = async (
  c: Parameters<Middleware>[0],
  filepath: string,
): Promise<ResolvePreCompressedAssetResult> => {
  const brPath = `${filepath}${PRE_COMPRESSED_ASSET_EXTENSIONS.br}`;
  const gzipPath = `${filepath}${PRE_COMPRESSED_ASSET_EXTENSIONS.gzip}`;

  const [hasBr, hasGzip] = await Promise.all([
    fs.pathExists(brPath),
    fs.pathExists(gzipPath),
  ]);

  const hasVariant = hasBr || hasGzip;
  if (!hasVariant) {
    return {
      selected: null,
      hasVariant: false,
    };
  }

  const acceptedEncodings = getAcceptedEncodings(
    c.req.header('accept-encoding'),
  );

  for (const encoding of acceptedEncodings) {
    if (encoding === 'br' && hasBr) {
      return {
        selected: {
          filepath: brPath,
          encoding,
        },
        hasVariant: true,
      };
    }

    if (encoding === 'gzip' && hasGzip) {
      return {
        selected: {
          filepath: gzipPath,
          encoding,
        },
        hasVariant: true,
      };
    }
  }

  return {
    selected: null,
    hasVariant: true,
  };
};

export function createPublicMiddleware({
  pwd,
  routes,
}: PublicMiddlwareOptions): Middleware {
  return async (c, next) => {
    const route = matchPublicRoute(c.req, routes);

    if (route) {
      const { entryPath } = route;
      const originFilename = path.join(pwd, entryPath);
      const preCompressedAsset = await resolvePreCompressedAsset(
        c,
        originFilename,
      );
      const filename = preCompressedAsset.selected?.filepath ?? originFilename;
      const data = await fileReader.readFile(filename, 'buffer');
      const mimeType = getMimeType(originFilename);

      if (data !== null) {
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

        if (preCompressedAsset.hasVariant) {
          appendVaryHeader(c, 'Accept-Encoding');
        }

        if (preCompressedAsset.selected) {
          c.header('Content-Encoding', preCompressedAsset.selected.encoding);
        }

        c.header('Content-Length', String(data.byteLength));

        return c.body(body, 200);
      }
    }

    return await next();
  };
}

function matchPublicRoute(req: HonoRequest, routes: ServerRoute[]) {
  for (const route of routes.sort(sortRoutes)) {
    if (
      !route.isSSR &&
      route.entryPath.startsWith('public') &&
      req.path.startsWith(route.urlPath)
    ) {
      return route;
    }
  }
  return undefined;
}

// Remove domain name from assetPrefix if it exists
const extractPathname = (url: string): string => {
  try {
    // Check if the URL contains a protocol
    if (url.includes('://')) {
      return new URL(url).pathname || '/';
    }
    // Handle protocol-relative URLs (starting with //)
    if (url.startsWith('//')) {
      return new URL(`http:${url}`).pathname || '/';
    }
    return url;
  } catch (e) {
    return url;
  }
};

const MODULE_FEDERATION_MANIFEST_FILE = 'mf-manifest.json';
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

type ModuleFederationServeAssets = {
  assets: Set<string>;
  remoteEntry: string | null;
};

const trimLeadingSlash = (value: string) => value.replace(/^\/+/, '');

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
  if (!assetPath) {
    return;
  }

  set.add(trimLeadingSlash(assetPath));
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

const patchModuleFederationManifestPublicPath = (
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

const patchModuleFederationRemoteEntryPublicPath = (
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

const getModuleFederationAssetList = async (
  pwd: string,
): Promise<ModuleFederationServeAssets> => {
  const assets = new Set<string>();
  const manifestPath = path.join(pwd, MODULE_FEDERATION_MANIFEST_FILE);

  if (!(await fs.pathExists(manifestPath))) {
    return {
      assets,
      remoteEntry: null,
    };
  }

  assets.add(MODULE_FEDERATION_MANIFEST_FILE);
  const manifestBuffer = await fileReader.readFileFromSystem(
    manifestPath,
    'buffer',
  );

  if (manifestBuffer === null) {
    return {
      assets,
      remoteEntry: null,
    };
  }

  for (const filename of MODULE_FEDERATION_OPTIONAL_FILES) {
    if (await fs.pathExists(path.join(pwd, filename))) {
      assets.add(filename);
    }
  }

  let remoteEntryFile: string | null = null;
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
      remoteEntryFile = remoteEntry;
    }
    if (dtsZip) {
      assets.add(dtsZip);
    }
    if (dtsApi) {
      assets.add(dtsApi);
    }

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

  return {
    assets,
    remoteEntry: remoteEntryFile,
  };
};

export interface ServerStaticOptions {
  pwd: string;
  output: OutputNormalizedConfig;
  html: HtmlNormalizedConfig;
  server: ServerNormalizedConfig;
  routes?: ServerRoute[];
}

/**
 * This middleware is used to serve static assets
 * TODO: In next major version, only serve static assets in the `static` and `upload` directory.
 *
 * 1. In dev mode, the static assets generated by bundler will be served by the rsbuildDevMiddleware, and other file in `static` directory will be served by this middleware.
 * 2. In prod mode, all the static assets in `static` and `upload` directory will be served by this middleware.
 * 3. So some file not in `static` can be access in dev mode, but not in prod mode. Cause we can not serve all files in prod mode, as we should not expose server code in prod mode.
 * 4. Through Modern.js not serve this file in prod mode, you can upload the files to a CDN.
 */
export function createStaticMiddleware(
  options: ServerStaticOptions,
): Middleware {
  const { pwd, routes } = options;
  const prefix = options.output.assetPrefix || '/';
  const pathPrefix = extractPathname(prefix);

  const { distPath: { css: cssPath, js: jsPath, media: mediaPath } = {} } =
    options.output;
  const { favicon } = options.html;
  const { publicDir } = options.server;
  const favicons = prepareFavicons(favicon);
  const staticFiles = [cssPath, jsPath, mediaPath].filter(v => Boolean(v));

  // Handle custom publicDir: string | string[]
  // Convert publicDir paths to regex patterns for matching
  // e.g., './locales' or 'locales' -> 'locales/'
  const publicDirPatterns = getPublicDirPatterns(publicDir);

  // TODO: If possible, we should not use `...staticFiles` here, file should only be read in static and upload dir.
  const staticReg = [
    'static/',
    'upload/',
    ...staticFiles,
    ...publicDirPatterns,
  ];
  // TODO: Also remove iconReg
  const iconReg = ['favicon.ico', 'icon.png', ...favicons];
  const regPrefix = pathPrefix.endsWith('/') ? pathPrefix : `${pathPrefix}/`;
  const staticPathRegExp = new RegExp(
    `^${regPrefix}(${[...staticReg, ...iconReg].join('|')})`,
  );
  const publicMiddleware = createPublicMiddleware({
    pwd,
    routes: routes || [],
  });
  let moduleFederationAssetsPromise: Promise<ModuleFederationServeAssets> | null =
    null;

  const getModuleFederationAssets = async () => {
    if (!moduleFederationAssetsPromise) {
      moduleFederationAssetsPromise = getModuleFederationAssetList(pwd);
    }

    return moduleFederationAssetsPromise;
  };

  const serveFile = async (
    c: Parameters<Middleware>[0],
    filepath: string,
    moduleFederationAsset = false,
    moduleFederationRemoteEntry = false,
    requestPath = '',
  ) => {
    if (moduleFederationAsset) {
      c.header('Access-Control-Allow-Origin', '*');
      c.header('Access-Control-Allow-Headers', '*');
      c.header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    }

    const mimeType = getMimeType(filepath);
    if (mimeType) {
      c.header('Content-Type', mimeType);
    }

    const shouldPatchManifest =
      moduleFederationAsset && requestPath === MODULE_FEDERATION_MANIFEST_FILE;
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

    if (preCompressedAsset.hasVariant) {
      appendVaryHeader(c, 'Accept-Encoding');
    }

    if (preCompressedAsset.selected) {
      c.header('Content-Encoding', preCompressedAsset.selected.encoding);
    }

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

  /**
   * The function is modified based on
   * https://github.com/honojs/node-server/blob/main/src/serve-static.ts
   *
   * MIT Licensed
   * https://github.com/honojs/node-server/tree/8cea466fd05e6d2e99c28011fc0e2c2d3f3397c9?tab=readme-ov-file#license
   * */
  return async (c, next) => {
    // If page route hit, we should skip static middleware for performance
    const pageRoute = c.get('route');
    const pathname = c.req.path;
    if (pageRoute && path.extname(pathname) === '') {
      return next();
    }

    // Check if path matches static resource pattern
    const hit = staticPathRegExp.test(pathname);
    const requestPath = trimLeadingSlash(
      pathname.replace(pathPrefix, () => ''),
    );

    if (requestPath.includes('..')) {
      return next();
    }

    const moduleFederationAssetMeta = await getModuleFederationAssets();
    const isModuleFederationAsset =
      moduleFederationAssetMeta.assets.has(requestPath);
    const isModuleFederationRemoteEntry =
      moduleFederationAssetMeta.remoteEntry === requestPath;

    const serveByPath = async (
      filepath: string,
      moduleFederationAsset = false,
      moduleFederationRemoteEntry = false,
    ) => {
      if (!(await fs.pathExists(filepath))) {
        return null;
      }

      return serveFile(
        c,
        filepath,
        moduleFederationAsset,
        moduleFederationRemoteEntry,
        requestPath,
      );
    };

    // FIXME: shoudn't hit, when cssPath, jsPath, mediaPath as '.'
    if (hit) {
      const response = await serveByPath(
        path.join(pwd, requestPath),
        isModuleFederationAsset,
        isModuleFederationRemoteEntry,
      );
      if (response !== null) {
        return response;
      }

      // FIXME: we shoud return a response with status is 404, if we can't found static asset
      // return c.html(createErrorHtml(404), 404);

      // In some case, page route would hit the staticPathRegExp.
      // So we call next().
      return next();
    }

    if (isModuleFederationAsset) {
      const response = await serveByPath(
        path.join(pwd, requestPath),
        true,
        isModuleFederationRemoteEntry,
      );
      if (response !== null) {
        return response;
      }
    }

    return publicMiddleware(c, next);
  };
}

const prepareFavicons = (
  favicon?: string | ((o: { entryName: string; value: string }) => string),
) => {
  const faviconNames = [];

  // TODO: handle favicon as function.
  if (favicon && typeof favicon === 'string') {
    faviconNames.push(favicon.substring(favicon.lastIndexOf('/') + 1));
  }
  return faviconNames;
};
