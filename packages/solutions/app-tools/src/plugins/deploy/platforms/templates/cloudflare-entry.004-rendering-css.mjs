function createNoopMonitors() {
  const noop = () => {};

  return {
    debug: noop,
    error: noop,
    info: noop,
    warn: noop,
  };
}

const DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY = '__modernDistributedSsrFragments';

function distributedSsrFragmentKey(remote, expose) {
  return `${remote}::${expose}`;
}

function escapeFragmentRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function openingTagHasAttribute(openingTag, name, value) {
  const pattern = new RegExp(
    `\\s${escapeFragmentRegExp(name)}=(?:"${escapeFragmentRegExp(value)}"|'${escapeFragmentRegExp(value)}')`,
    'u',
  );

  return pattern.test(openingTag);
}

function extractRenderedBoundaryElement(html, boundaryId, expose) {
  const boundaryPattern = new RegExp(
    `\\sdata-modern-boundary-id=(?:"${escapeFragmentRegExp(boundaryId)}"|'${escapeFragmentRegExp(boundaryId)}')`,
    'u',
  );
  const boundaryMatch = boundaryPattern.exec(html);
  if (!boundaryMatch) {
    return undefined;
  }

  const openingStart = html.lastIndexOf('<', boundaryMatch.index);
  const openingEnd = html.indexOf('>', boundaryMatch.index);
  if (openingStart < 0 || openingEnd < 0) {
    return undefined;
  }

  const openingTag = html.slice(openingStart, openingEnd + 1);
  const tagName = /^<([a-z][\w:-]*)\b/iu.exec(openingTag)?.[1];
  if (
    !tagName ||
    !openingTagHasAttribute(openingTag, 'data-modern-mf-expose', expose)
  ) {
    return undefined;
  }

  const tagPattern = new RegExp(
    `<\\/?${escapeFragmentRegExp(tagName)}\\b[^>]*>`,
    'giu',
  );
  let depth = 0;

  for (const tagMatch of html.slice(openingStart).matchAll(tagPattern)) {
    const tag = tagMatch[0];
    const absoluteStart = openingStart + (tagMatch.index ?? 0);
    if (tag.startsWith('</')) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(openingStart, absoluteStart + tag.length);
      }
    } else if (!tag.endsWith('/>')) {
      depth += 1;
    }
  }

  return undefined;
}

function fragmentLocale(request) {
  const segment = new URL(request.url).pathname.split('/').filter(Boolean)[0];

  return segment && /^[a-z\d-]+$/iu.test(segment) ? segment : 'en';
}

function createFragmentFailure(fragment, reason) {
  return {
    boundaryId: fragment.boundaryId,
    expose: fragment.expose,
    reason,
    remote: fragment.remote,
    status: 'degraded',
  };
}

function emitFragmentFailure(binding, fragment, reason) {
  try {
    console.error(
      JSON.stringify({
        appName: 'modern-js-cloudflare-worker',
        eventName: 'modernjs:microvertical-server-fallback',
        metadata: {
          classification: 'remote-unavailable',
          expose: fragment.expose,
          platform: 'cloudflare-service-binding',
          reason,
          remote: fragment.remote,
          serviceBinding: binding.binding,
          status: 'degraded',
        },
        phase: 'discovery',
        reason: 'remote-unavailable',
        schemaVersion: 1,
      }),
    );
  } catch {}
}

async function fetchDistributedSsrFragment(binding, fragment, request, env) {
  const key = distributedSsrFragmentKey(fragment.remote, fragment.expose);
  const service = env?.[binding.binding];
  if (!service || typeof service.fetch !== 'function') {
    emitFragmentFailure(binding, fragment, 'binding-unavailable');
    return [key, createFragmentFailure(fragment, 'binding-unavailable')];
  }

  const fragmentPath = fragment.path.replaceAll(
    '{locale}',
    encodeURIComponent(fragmentLocale(request)),
  );
  const fragmentUrl = new URL(fragmentPath, request.url);
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-modern-js-fragment-request', '1');

  try {
    const response = await service.fetch(
      new Request(fragmentUrl, {
        headers,
        method: 'GET',
      }),
    );
    if (!response.ok) {
      const reason = `fragment-http-${response.status}`;
      emitFragmentFailure(binding, fragment, reason);
      return [key, createFragmentFailure(fragment, reason)];
    }

    const html = await response.text();
    const fragmentHtml = extractRenderedBoundaryElement(
      html,
      fragment.boundaryId,
      fragment.expose,
    );
    if (!fragmentHtml) {
      emitFragmentFailure(binding, fragment, 'fragment-contract-mismatch');
      return [
        key,
        createFragmentFailure(fragment, 'fragment-contract-mismatch'),
      ];
    }

    return [
      key,
      {
        boundaryId: fragment.boundaryId,
        expose: fragment.expose,
        html: fragmentHtml,
        remote: fragment.remote,
        status: 'ready',
      },
    ];
  } catch {
    emitFragmentFailure(binding, fragment, 'fragment-request-failed');
    return [key, createFragmentFailure(fragment, 'fragment-request-failed')];
  }
}

async function collectDistributedSsrFragments(request, env) {
  const bindings = Array.isArray(MODERN_WORKER_MANIFEST.serviceBindings)
    ? MODERN_WORKER_MANIFEST.serviceBindings
    : [];
  const requests = bindings.flatMap(binding =>
    Array.isArray(binding.fragments)
      ? binding.fragments.map(fragment =>
          fetchDistributedSsrFragment(binding, fragment, request, env),
        )
      : [],
  );

  if (requests.length === 0) {
    return undefined;
  }

  return {
    fragments: Object.fromEntries(await Promise.all(requests)),
    required: true,
  };
}

function createRequestHandlerOptions({
  route,
  htmlTemplate,
  routeManifest,
  loadableStats,
  distributedSsrFragments,
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
    locals:
      distributedSsrFragments === undefined
        ? {}
        : {
            [DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY]: distributedSsrFragments,
          },
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
    return new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
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
  const [htmlTemplate, routeManifest, loadableStats, distributedSsrFragments] =
    await Promise.all([
      readAssetText(route.entryPath, request, env),
      readAssetJson(
        MODERN_WORKER_MANIFEST.resources.routeManifest,
        request,
        env,
      ),
      readAssetJson(
        MODERN_WORKER_MANIFEST.resources.loadableStats,
        request,
        env,
      ),
      collectDistributedSsrFragments(request, env),
    ]);

  return createRequestHandlerOptions({
    route,
    htmlTemplate: htmlTemplate || '',
    routeManifest,
    loadableStats,
    distributedSsrFragments,
  });
}
