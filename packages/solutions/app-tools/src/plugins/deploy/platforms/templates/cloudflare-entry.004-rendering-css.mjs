function createNoopMonitors() {
  const noop = () => {};

  return {
    debug: noop,
    error: noop,
    info: noop,
    warn: noop,
  };
}

function createRequestHandlerOptions({
  route,
  htmlTemplate,
  routeManifest,
  loadableStats,
}) {
  const monitors = createNoopMonitors();

  return {
    resource: {
      route,
      routeManifest,
      loadableStats,
      htmlTemplate,
      entryName: route.entryName,
    },
    params: {},
    loaderContext: {},
    config: {},
    locals: {},
    staticGenerate: false,
    monitors,
    onError(error) {
      monitors.error(error);
    },
    onTiming() {},
    reporter: {
      reportTiming: () => {},
    },
  };
}

function collectRouteCssAssets(route, routeManifest) {
  const routeAssets = routeManifest?.routeAssets || {};
  const candidateKeys = [route.entryName, `async-${route.entryName}`].filter(
    Boolean,
  );
  const assets = new Set();

  for (const key of candidateKeys) {
    const routeAsset = routeAssets[key];
    const cssAssets = [
      ...(Array.isArray(routeAsset?.referenceCssAssets)
        ? routeAsset.referenceCssAssets
        : []),
      ...(Array.isArray(routeAsset?.assets) ? routeAsset.assets : []),
    ];

    for (const asset of cssAssets) {
      if (typeof asset === 'string' && asset.endsWith('.css')) {
        assets.add(asset);
      }
    }
  }

  return [...assets];
}

function collectRenderedFederatedExposes(html) {
  const renderedExposes = [];
  const tagPattern =
    /<[^>]*data-modern-(?:boundary-id|mf-expose)=["'][^"']+["'][^>]*>/g;
  const attributePattern =
    /\s(data-modern-(?:boundary-id|mf-expose))=["']([^"']+)["']/g;

  for (const [tag] of html.matchAll(tagPattern)) {
    const attributes = {};

    for (const [, name, value] of tag.matchAll(attributePattern)) {
      attributes[name] = value;
    }

    const boundaryId = attributes['data-modern-boundary-id'];
    const expose = attributes['data-modern-mf-expose'];

    if (boundaryId && expose) {
      renderedExposes.push({ boundaryId, expose });
    }
  }

  return renderedExposes;
}

function getRemoteManifestUrl(remote, request) {
  const entry = remote?.entry;

  if (typeof entry !== 'string' || entry.length === 0) {
    return undefined;
  }

  return new URL(entry, request.url).toString();
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function getRemoteAssetBase(remoteManifest, manifestUrl) {
  const publicPath =
    typeof remoteManifest?.metaData?.publicPath === 'string'
      ? remoteManifest.metaData.publicPath
      : undefined;
  const fallbackBase = new URL('.', manifestUrl).toString();

  if (!publicPath || publicPath === 'auto') {
    return fallbackBase;
  }

  try {
    return new URL(ensureTrailingSlash(publicPath), manifestUrl).toString();
  } catch {
    return fallbackBase;
  }
}

async function fetchRemoteJson(jsonUrl) {
  if (!remoteJsonPromises.has(jsonUrl)) {
    remoteJsonPromises.set(
      jsonUrl,
      fetch(jsonUrl)
        .then(response => {
          if (!response.ok) {
            remoteJsonPromises.delete(jsonUrl);

            return {};
          }

          return response.json().catch(() => {
            remoteJsonPromises.delete(jsonUrl);

            return {};
          });
        })
        .catch(() => {
          remoteJsonPromises.delete(jsonUrl);

          return {};
        }),
    );
  }

  return remoteJsonPromises.get(jsonUrl);
}

function findRemoteExpose(remoteManifest, exposePath) {
  const exposes = Array.isArray(remoteManifest?.exposes)
    ? remoteManifest.exposes
    : [];
  const normalizedExpose = exposePath.replace(/^\.\//u, '');

  return exposes.find(expose => {
    if (!expose || typeof expose !== 'object') {
      return false;
    }

    return (
      expose.path === exposePath ||
      expose.path === `./${normalizedExpose}` ||
      expose.name === normalizedExpose
    );
  });
}

function collectCssAssetEntries(assets) {
  const cssAssets = assets?.css;

  return [
    ...(Array.isArray(cssAssets?.sync) ? cssAssets.sync : []),
    ...(Array.isArray(cssAssets?.async) ? cssAssets.async : []),
  ].filter(asset => typeof asset === 'string' && asset.endsWith('.css'));
}

function collectRouteManifestCssAssets(routeManifest) {
  const routeAssets = routeManifest?.routeAssets || {};
  const assets = new Set();

  for (const routeAsset of Object.values(routeAssets)) {
    const cssAssets = [
      ...(Array.isArray(routeAsset?.referenceCssAssets)
        ? routeAsset.referenceCssAssets
        : []),
      ...(Array.isArray(routeAsset?.assets) ? routeAsset.assets : []),
    ];

    for (const asset of cssAssets) {
      if (typeof asset === 'string' && asset.endsWith('.css')) {
        assets.add(asset);
      }
    }
  }

  return [...assets];
}

async function collectRenderedRemoteCssHrefs(html, request, env) {
  const renderedExposes = collectRenderedFederatedExposes(html);

  if (renderedExposes.length === 0) {
    return [];
  }

  const hostManifest = await readAssetJson('mf-manifest.json', request, env);
  const remotes = Array.isArray(hostManifest?.remotes)
    ? hostManifest.remotes
    : [];
  const remoteByBoundary = new Map();
  const hrefs = new Set();

  for (const remote of remotes) {
    if (typeof remote?.alias === 'string') {
      remoteByBoundary.set(remote.alias, remote);
    }

    if (typeof remote?.federationContainerName === 'string') {
      remoteByBoundary.set(remote.federationContainerName, remote);
    }
  }

  await Promise.all(
    renderedExposes.map(async ({ boundaryId, expose }) => {
      const remote = remoteByBoundary.get(boundaryId);
      const manifestUrl = remote
        ? getRemoteManifestUrl(remote, request)
        : undefined;

      if (!manifestUrl) {
        return;
      }

      const remoteManifest = await fetchRemoteJson(manifestUrl);
      const remoteExpose = findRemoteExpose(remoteManifest, expose);
      const publicPath = getRemoteAssetBase(remoteManifest, manifestUrl);
      const remoteRouteManifest = await fetchRemoteJson(
        new URL('routes-manifest.json', publicPath).toString(),
      );

      for (const asset of collectCssAssetEntries(remoteExpose?.assets)) {
        hrefs.add(new URL(asset, publicPath).toString());
      }

      for (const asset of collectRouteManifestCssAssets(remoteRouteManifest)) {
        hrefs.add(new URL(asset, publicPath).toString());
      }
    }),
  );

  return [...hrefs];
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isAbsoluteUrl(value) {
  return /^[a-z][a-z\d+.-]*:/iu.test(value);
}

function toRouteCssHtmlHref(asset) {
  if (isAbsoluteUrl(asset) || asset.startsWith('/')) {
    return asset;
  }

  return `/${asset.replace(/^\/+/u, '')}`;
}

async function withRouteCssLinks(response, route, routeManifest, request, env) {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('text/html')) {
    return response;
  }

  const html = await response.text();
  const cssEntries = [
    ...collectRouteCssAssets(route, routeManifest).map(asset => {
      const href = toRouteCssHtmlHref(asset);

      return {
        href,
        preloadHref: new URL(href, request.url).toString(),
      };
    }),
    ...(await collectRenderedRemoteCssHrefs(html, request, env)).map(href => ({
      href,
      preloadHref: new URL(href, request.url).toString(),
    })),
  ];

  if (cssEntries.length === 0) {
    return response;
  }

  const seenCssHrefs = new Set();
  const uniqueCssEntries = cssEntries.filter(entry => {
    if (seenCssHrefs.has(entry.preloadHref)) {
      return false;
    }

    seenCssHrefs.add(entry.preloadHref);
    return true;
  });
  const headers = new Headers(response.headers);

  for (const { preloadHref } of uniqueCssEntries) {
    headers.append('link', `<${preloadHref}>; rel=preload; as=style`);
  }

  const links = uniqueCssEntries
    .filter(
      ({ href, preloadHref }) =>
        !html.includes(href) && !html.includes(preloadHref),
    )
    .map(
      ({ href }) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`,
    );

  if (links.length === 0 || !html.includes('</head>')) {
    return new Response(html, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  return new Response(html.replace('</head>', `${links.join('')}</head>`), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function getRequestHandlerOptions(route, request, env) {
  const [htmlTemplate, routeManifest, loadableStats] = await Promise.all([
    readAssetText(route.entryPath, request, env),
    readAssetJson(MODERN_WORKER_MANIFEST.resources.routeManifest, request, env),
    readAssetJson(MODERN_WORKER_MANIFEST.resources.loadableStats, request, env),
  ]);

  return createRequestHandlerOptions({
    route,
    htmlTemplate: htmlTemplate || '',
    routeManifest,
    loadableStats,
  });
}
