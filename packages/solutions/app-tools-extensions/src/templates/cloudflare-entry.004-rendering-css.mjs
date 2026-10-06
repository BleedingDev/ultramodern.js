function createNoopMonitors() {
  const noop = () => {};

  return {
    counter: noop,
    debug: noop,
    error: noop,
    info: noop,
    push: noop,
    timing: noop,
    trace: noop,
    warn: noop,
  };
}

const DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY = '__modernDistributedSsrFragments';
const DISTRIBUTED_SSR_FRAGMENT_REQUEST_LOCALS_KEY =
  '__modernDistributedSsrFragmentRequest';
const DISTRIBUTED_SSR_CSS_HEADER = 'x-modern-distributed-ssr-css';
const DISTRIBUTED_SSR_PROVENANCE_HEADER = 'x-modern-distributed-ssr-provenance';
const CLOUDFLARE_STYLESHEET_LINKS_SENTINEL =
  '<meta data-modern-cloudflare-stylesheet-links>';

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

function findFragmentMarker(html, boundaryId, expose, marker, fromIndex = 0) {
  const tagPattern = /<template\b[^>]*>/giu;
  tagPattern.lastIndex = fromIndex;

  for (const match of html.matchAll(tagPattern)) {
    const tag = match[0];
    if (
      openingTagHasAttribute(tag, 'data-modern-boundary-id', boundaryId) &&
      openingTagHasAttribute(tag, 'data-modern-mf-expose', expose) &&
      openingTagHasAttribute(tag, 'data-modern-distributed-ssr-marker', marker)
    ) {
      return {
        end: (match.index ?? 0) + tag.length,
        start: match.index ?? 0,
      };
    }
  }

  return undefined;
}

function extractRenderedFragmentHtml(html, boundaryId, expose) {
  const start = findFragmentMarker(html, boundaryId, expose, 'start');
  if (start) {
    const startClose = html.indexOf('</template>', start.end);
    const contentStart =
      startClose === -1 ? start.end : startClose + '</template>'.length;
    const end = findFragmentMarker(
      html,
      boundaryId,
      expose,
      'end',
      contentStart,
    );

    if (end && end.start >= contentStart) {
      return html.slice(contentStart, end.start);
    }
  }

  return extractRenderedBoundaryElement(html, boundaryId, expose);
}

function readOpeningTagAttributes(openingTag) {
  const attributes = {};
  const opening = /^<\/?[A-Za-z][\w:-]*/u.exec(openingTag);
  if (!opening) return attributes;
  let remaining = openingTag.slice(opening[0].length);
  const attribute =
    /^\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/u;
  while (remaining) {
    const match = attribute.exec(remaining);
    if (!match) break;
    const name = match[1].toLowerCase();
    if (!Object.hasOwn(attributes, name))
      attributes[name] = match[2] ?? match[3] ?? match[4] ?? '';
    remaining = remaining.slice(match[0].length);
  }
  return attributes;
}

function readOpeningTagAttribute(openingTag, name) {
  const pattern = new RegExp(
    `\\s${escapeFragmentRegExp(name)}=(?:"([^"]*)"|'([^']*)')`,
    'iu',
  );
  const match = pattern.exec(openingTag);

  return match?.[1] ?? match?.[2];
}

function collectStylesheetHrefs(html) {
  const hrefs = [];

  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const link = match[0];
    const rel = readOpeningTagAttribute(link, 'rel');
    const href = readOpeningTagAttribute(link, 'href');

    if (href && rel?.toLowerCase().split(/\s+/u).includes('stylesheet')) {
      hrefs.push(href);
    }
  }

  return hrefs;
}

function normalizeStylesheetHref(href, requestUrl) {
  try {
    return new URL(href, requestUrl).toString();
  } catch {
    return href;
  }
}

function dedupeStylesheetLinks(html, seenHrefs = new Set(), requestUrl) {
  return html.replace(/<link\b[^>]*>/giu, link => {
    const rel = readOpeningTagAttribute(link, 'rel');
    const href = readOpeningTagAttribute(link, 'href');

    if (!href || !rel?.toLowerCase().split(/\s+/u).includes('stylesheet')) {
      return link;
    }

    const normalizedHref = normalizeStylesheetHref(href, requestUrl);
    if (seenHrefs.has(normalizedHref)) {
      return '';
    }

    seenHrefs.add(normalizedHref);
    return link;
  });
}

function stripStylesheetLinks(html) {
  return html.replace(/<link\b[^>]*>/giu, link => {
    const rel = readOpeningTagAttribute(link, 'rel');
    return rel?.toLowerCase().split(/\s+/u).includes('stylesheet') ? '' : link;
  });
}

function createStylesheetLinksHtml(stylesheetEntries) {
  return stylesheetEntries
    .map(({ href, reactResource }) =>
      reactResource
        ? `<link href="${escapeAttribute(href)}" rel="stylesheet" type="text/css" data-precedence="default">`
        : `<link rel="stylesheet" href="${escapeAttribute(href)}">`,
    )
    .join('');
}

function createStylesheetLinkStream(
  body,
  stylesheetEntries,
  requestUrl,
  resolveRemoteCss = async () => [],
) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const seenHrefs = new Set();
  const pendingEntries = [...stylesheetEntries];
  const maxTagLength = 64 * 1024;
  const maxHeadLength = 256 * 1024;
  let reader;
  let cancelled = false;
  let finished = false;
  let headParts;
  let headLength = 0;
  let headSlot;
  let rawText;
  let pending = '';

  const linksFor = entries => {
    const missing = entries.filter(({ preloadHref }) => {
      if (seenHrefs.has(preloadHref)) return false;
      seenHrefs.add(preloadHref);
      return true;
    });
    return createStylesheetLinksHtml(missing);
  };
  const tagEnd = value => {
    let quote;
    for (let index = 1; index < value.length; index += 1) {
      const character = value[index];
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        return index;
      }
    }
    return -1;
  };

  const consume = async final => {
    let output = '';
    const append = value => {
      if (headParts === undefined) {
        output += value;
      } else {
        headLength += encoder.encode(value).byteLength;
        if (headLength > maxHeadLength)
          throw new RangeError('Cloudflare HTML stream head exceeds 256 KiB');
        headParts.push(value);
      }
    };
    while (pending && !cancelled) {
      if (rawText) {
        const match = rawText.comment
          ? /-->/u.exec(pending)
          : new RegExp(`</${rawText.tag}(?=[\\s/>])`, 'iu').exec(pending);
        if (!match) {
          const keep = final ? 0 : rawText.comment ? 2 : rawText.tag.length + 2;
          const available = Math.max(0, pending.length - keep);
          append(pending.slice(0, available));
          pending = pending.slice(available);
          break;
        }
        const end = match.index + (rawText.comment ? match[0].length : 0);
        append(pending.slice(0, end));
        pending = pending.slice(end);
        rawText = undefined;
        continue;
      }
      const opening = pending.indexOf('<');
      if (opening < 0) {
        append(pending);
        pending = '';
        break;
      }
      if (opening > 0) {
        append(pending.slice(0, opening));
        pending = pending.slice(opening);
      }
      if (!final && pending.length < 4 && '<!--'.startsWith(pending)) break;
      if (pending.startsWith('<!--')) {
        append('<!--');
        pending = pending.slice(4);
        rawText = { comment: true };
        continue;
      }
      const closing = tagEnd(pending);
      if (closing < 0) {
        if (encoder.encode(pending).byteLength > maxTagLength)
          throw new RangeError(
            'Cloudflare HTML stream has an unterminated tag larger than 64 KiB',
          );
        if (final) {
          append(pending);
          pending = '';
        }
        break;
      }
      if (
        encoder.encode(pending.slice(0, closing + 1)).byteLength > maxTagLength
      )
        throw new RangeError('Cloudflare HTML stream tag exceeds 64 KiB');
      const tag = pending.slice(0, closing + 1);
      pending = pending.slice(closing + 1);
      if (/^<head(?:\s|>)/iu.test(tag)) {
        headParts = [];
        headLength = 0;
        headSlot = undefined;
      }
      if (tag === CLOUDFLARE_STYLESHEET_LINKS_SENTINEL && headParts) {
        if (headSlot === undefined) {
          headSlot = headParts.length;
          append('');
        }
        continue;
      }
      const attributes = readOpeningTagAttributes(tag);
      if (
        output &&
        headParts === undefined &&
        attributes['data-modern-boundary-id'] &&
        attributes['data-modern-mf-expose']
      ) {
        pending = tag + pending;
        return output;
      }
      if (/^<link(?=[\s/>])/iu.test(tag)) {
        const rel = attributes.rel;
        const href = attributes.href;
        if (href && rel?.toLowerCase().split(/\s+/u).includes('stylesheet')) {
          const normalized = normalizeStylesheetHref(href, requestUrl);
          if (seenHrefs.has(normalized)) continue;
          seenHrefs.add(normalized);
        }
      }
      const remoteHrefs = await resolveRemoteCss(attributes);
      const remoteEntries = remoteHrefs.map(href => ({
        href,
        preloadHref: normalizeStylesheetHref(href, requestUrl),
        reactResource: true,
      }));
      if (headParts) pendingEntries.push(...remoteEntries);
      else append(linksFor(remoteEntries));
      if (/^<\/head\s*>$/iu.test(tag) && headParts) {
        const links = linksFor(pendingEntries);
        if (headSlot === undefined) append(links);
        else {
          headLength += encoder.encode(links).byteLength;
          if (headLength > maxHeadLength)
            throw new RangeError('Cloudflare HTML stream head exceeds 256 KiB');
          headParts[headSlot] = links;
        }
        append(tag);
        output += headParts.join('');
        headParts = undefined;
      } else {
        append(tag);
      }
      const rawOpening = /^<(script|style|title|textarea)(?=[\s/>])/iu.exec(
        tag,
      );
      if (rawOpening) rawText = { tag: rawOpening[1].toLowerCase() };
    }
    if (final && headParts) {
      if (headSlot !== undefined) {
        const links = linksFor(pendingEntries);
        headLength += encoder.encode(links).byteLength;
        if (headLength > maxHeadLength)
          throw new RangeError('Cloudflare HTML stream head exceeds 256 KiB');
        headParts[headSlot] = links;
      }
      output += headParts.join('');
      headParts = undefined;
    }
    return output;
  };

  return new ReadableStream(
    {
      async pull(controller) {
        try {
          reader ??= body.getReader();
          while (!cancelled) {
            const output = await consume(finished);
            if (cancelled) return;
            if (output) controller.enqueue(encoder.encode(output));
            if (finished && pending.length === 0) {
              reader.releaseLock();
              controller.close();
            }
            if (output || finished) return;
            const result = await reader.read();
            finished = result.done;
            pending += result.done
              ? decoder.decode()
              : typeof result.value === 'string'
                ? result.value
                : decoder.decode(result.value, { stream: true });
          }
        } catch (error) {
          if (cancelled) return;
          cancelled = true;
          try {
            await reader?.cancel(error);
          } finally {
            reader?.releaseLock();
            controller.error(error);
          }
        }
      },
      async cancel(reason) {
        cancelled = true;
        if (reader) {
          try {
            await reader.cancel(reason);
          } finally {
            reader.releaseLock();
          }
        } else {
          await body.cancel(reason);
        }
      },
    },
    { highWaterMark: 0 },
  );
}

function readFragmentStylesheetAssets(response) {
  const value = response.headers.get(DISTRIBUTED_SSR_CSS_HEADER);

  if (value === null) {
    return undefined;
  }

  try {
    const assets = JSON.parse(value);

    return Array.isArray(assets) &&
      assets.every(asset => typeof asset === 'string' && asset.endsWith('.css'))
      ? assets
      : undefined;
  } catch {
    return undefined;
  }
}

async function resolveFragmentStylesheetHrefs(
  stylesheetAssets,
  fragment,
  fragmentUrl,
  request,
  env,
) {
  const hostManifest = await readAssetJson('mf-manifest.json', request, env);
  const remote = (
    Array.isArray(hostManifest?.remotes) ? hostManifest.remotes : []
  ).find(
    candidate =>
      candidate?.alias === fragment.remote ||
      candidate?.federationContainerName === fragment.boundaryId,
  );
  const manifestUrl = remote
    ? getRemoteManifestUrl(remote, request)
    : undefined;
  const publicBase = manifestUrl
    ? new URL('.', manifestUrl).toString()
    : undefined;
  const hrefs = stylesheetAssets.map(href => {
    const resolved = new URL(href, fragmentUrl);

    if (
      publicBase &&
      (!isAbsoluteUrl(href) || resolved.origin === fragmentUrl.origin)
    ) {
      return new URL(href.replace(/^\/+/u, ''), publicBase).toString();
    }

    return resolved.toString();
  });

  return [...new Set(hrefs)];
}

function createHydratableFragmentHtml(fragmentHtml) {
  return `<!--$-->${fragmentHtml}<!--/$-->`;
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );

  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function serializeDistributedSsrProps(props) {
  const seen = new WeakSet();
  const serialized = JSON.stringify(props, (_key, value) => {
    if (
      typeof value === 'bigint' ||
      typeof value === 'function' ||
      typeof value === 'symbol'
    ) {
      throw new TypeError('Distributed SSR props must be JSON serializable.');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Distributed SSR props must contain finite numbers.');
    }
    if (value && typeof value === 'object') {
      if (seen.has(value)) {
        throw new TypeError('Distributed SSR props must not contain cycles.');
      }
      seen.add(value);
    }
    return value;
  });

  if (typeof serialized !== 'string') {
    throw new TypeError('Distributed SSR props must serialize to JSON.');
  }

  return serialized;
}

function readFragmentProvenance(response) {
  const value = response.headers.get(DISTRIBUTED_SSR_PROVENANCE_HEADER);
  if (value === null) {
    return undefined;
  }

  try {
    const provenance = JSON.parse(decodeURIComponent(value));
    return provenance && typeof provenance === 'object'
      ? provenance
      : undefined;
  } catch {
    return undefined;
  }
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

async function fetchDistributedSsrFragment(
  binding,
  fragment,
  propsJson,
  request,
  env,
) {
  const service = env?.[binding.binding];
  if (!service || typeof service.fetch !== 'function') {
    emitFragmentFailure(binding, fragment, 'binding-unavailable');
    return createFragmentFailure(fragment, 'binding-unavailable');
  }

  const fragmentPath = fragment.path.replaceAll(
    '{locale}',
    encodeURIComponent(fragmentLocale(request)),
  );
  const fragmentUrl = new URL(fragmentPath, request.url);
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-modern-js-fragment-request', '1');
  headers.set('x-modern-distributed-ssr-boundary-id', fragment.boundaryId);
  headers.set('x-modern-distributed-ssr-expose', fragment.expose);
  headers.set('x-modern-distributed-ssr-props', encodeURIComponent(propsJson));
  headers.set('x-modern-distributed-ssr-remote', fragment.remote);
  headers.set('x-modern-distributed-ssr-source-url', request.url);

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
      return createFragmentFailure(fragment, reason);
    }

    const html = await response.text();
    const stylesheetAssets = readFragmentStylesheetAssets(response);
    const renderedBoundaryHtml = extractRenderedFragmentHtml(
      html,
      fragment.boundaryId,
      fragment.expose,
    );
    const provenance = readFragmentProvenance(response);
    if (
      !renderedBoundaryHtml ||
      stylesheetAssets === undefined ||
      provenance?.boundaryId !== fragment.boundaryId ||
      provenance?.expose !== fragment.expose ||
      provenance?.remote !== fragment.remote ||
      typeof provenance?.buildMarker !== 'string' ||
      typeof provenance?.digest !== 'string' ||
      typeof provenance?.sourceRevision !== 'string' ||
      typeof provenance?.unitId !== 'string' ||
      provenance.digest !== (await sha256Hex(renderedBoundaryHtml))
    ) {
      emitFragmentFailure(binding, fragment, 'fragment-contract-mismatch');
      return createFragmentFailure(fragment, 'fragment-contract-mismatch');
    }
    const stylesheetHrefs = await resolveFragmentStylesheetHrefs(
      stylesheetAssets,
      fragment,
      fragmentUrl,
      request,
      env,
    );
    const fragmentHtml = createHydratableFragmentHtml(
      stripStylesheetLinks(renderedBoundaryHtml),
    );

    return {
      boundaryId: fragment.boundaryId,
      buildMarker: provenance.buildMarker,
      digest: provenance.digest,
      expose: fragment.expose,
      html: fragmentHtml,
      provenance,
      remote: fragment.remote,
      status: 'ready',
      stylesheetHrefs,
    };
  } catch {
    emitFragmentFailure(binding, fragment, 'fragment-request-failed');
    return createFragmentFailure(fragment, 'fragment-request-failed');
  }
}

function createDistributedSsrFragmentContext(request, env) {
  const bindings = Array.isArray(MODERN_WORKER_MANIFEST.serviceBindings)
    ? MODERN_WORKER_MANIFEST.serviceBindings
    : [];
  const configuredFragments = bindings.flatMap(binding =>
    Array.isArray(binding.fragments)
      ? binding.fragments.map(fragment => ({ binding, fragment }))
      : [],
  );
  if (configuredFragments.length === 0) {
    return undefined;
  }
  const cache = new Map();
  const pendingResolutions = new Set();
  const stylesheetHrefsByFragment = configuredFragments.map(() => new Set());

  const getCurrentStylesheetHrefs = (boundaryId, expose) => {
    const hrefs = new Set();
    let configured = false;
    for (const [index, { fragment }] of configuredFragments.entries()) {
      if (
        (boundaryId !== undefined && fragment.boundaryId !== boundaryId) ||
        (expose !== undefined && fragment.expose !== expose)
      ) {
        continue;
      }
      configured = true;
      for (const href of stylesheetHrefsByFragment[index]) hrefs.add(href);
    }
    if (boundaryId !== undefined && !configured) return undefined;
    return [...hrefs];
  };

  return {
    required: true,
    getCurrentStylesheetHrefs,
    async getStylesheetHrefs() {
      while (pendingResolutions.size > 0) {
        await Promise.all([...pendingResolutions]);
      }
      return getCurrentStylesheetHrefs();
    },
    resolve(remote, expose, props) {
      const configuredIndex = configuredFragments.findIndex(
        candidate =>
          candidate.fragment.remote === remote &&
          candidate.fragment.expose === expose,
      );
      if (configuredIndex < 0) {
        return {
          boundaryId: remote,
          expose,
          reason: 'fragment-not-configured',
          remote,
          status: 'degraded',
        };
      }
      const configured = configuredFragments[configuredIndex];

      let propsJson;
      try {
        propsJson = serializeDistributedSsrProps(props);
      } catch {
        return createFragmentFailure(
          configured.fragment,
          'fragment-props-not-serializable',
        );
      }
      const key = `${distributedSsrFragmentKey(remote, expose)}::${propsJson}`;
      if (!cache.has(key)) {
        const resolution = fetchDistributedSsrFragment(
          configured.binding,
          configured.fragment,
          propsJson,
          request,
          env,
        ).then(result => {
          if (result.status === 'ready') {
            for (const href of result.stylesheetHrefs) {
              stylesheetHrefsByFragment[configuredIndex].add(href);
            }
          }
          const { stylesheetHrefs: _stylesheetHrefs, ...publicResult } = result;
          cache.set(key, publicResult);
          return publicResult;
        });

        pendingResolutions.add(resolution);
        resolution.then(
          () => pendingResolutions.delete(resolution),
          () => pendingResolutions.delete(resolution),
        );
        cache.set(key, resolution);
      }

      return cache.get(key);
    },
  };
}

function readDistributedSsrFragmentRequest(request) {
  if (request.headers.get('x-modern-js-fragment-request') !== '1') {
    return undefined;
  }

  try {
    const boundaryId = request.headers.get(
      'x-modern-distributed-ssr-boundary-id',
    );
    const expose = request.headers.get('x-modern-distributed-ssr-expose');
    const propsValue = request.headers.get('x-modern-distributed-ssr-props');
    const remote = request.headers.get('x-modern-distributed-ssr-remote');
    const sourceUrl = request.headers.get(
      'x-modern-distributed-ssr-source-url',
    );
    const props = JSON.parse(decodeURIComponent(propsValue ?? ''));
    if (
      !boundaryId ||
      !expose ||
      !remote ||
      !sourceUrl ||
      !props ||
      typeof props !== 'object' ||
      Array.isArray(props)
    ) {
      return undefined;
    }

    return { boundaryId, expose, props, remote, sourceUrl };
  } catch {
    return undefined;
  }
}

function withCloudflareStylesheetLinksSentinel(htmlTemplate) {
  if (htmlTemplate.includes(CLOUDFLARE_STYLESHEET_LINKS_SENTINEL)) {
    return htmlTemplate;
  }

  const closingHeads = [...htmlTemplate.matchAll(/<\/head\s*>/giu)];
  const closingHead = closingHeads.at(-1);
  if (closingHead?.index === undefined) {
    return htmlTemplate;
  }

  return `${htmlTemplate.slice(
    0,
    closingHead.index,
  )}${CLOUDFLARE_STYLESHEET_LINKS_SENTINEL}${htmlTemplate.slice(
    closingHead.index,
  )}`;
}

function createRequestHandlerOptions({
  route,
  htmlTemplate,
  routeManifest,
  loadableStats,
  env,
  executionContext,
  distributedSsrFragments,
  distributedSsrFragmentRequest,
}) {
  const monitors = createNoopMonitors();

  return {
    resource: {
      route,
      routeManifest,
      loadableStats,
      htmlTemplate: withCloudflareStylesheetLinksSentinel(htmlTemplate),
      entryName: route.entryName,
    },
    params: {},
    loaderContext: new Map(),
    config: {},
    platform: { kind: 'worker', bindings: env },
    executionContext,
    locals: {
      ...(distributedSsrFragments === undefined
        ? {}
        : {
            [DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY]: distributedSsrFragments,
          }),
      ...(distributedSsrFragmentRequest === undefined
        ? {}
        : {
            [DISTRIBUTED_SSR_FRAGMENT_REQUEST_LOCALS_KEY]:
              distributedSsrFragmentRequest,
          }),
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

function isAutomaticPublicPath(publicPath) {
  return publicPath === 'auto' || publicPath === 'auto/';
}

function getRemoteAssetBase(remoteManifest, manifestUrl) {
  const publicPath =
    typeof remoteManifest?.metaData?.publicPath === 'string'
      ? remoteManifest.metaData.publicPath
      : undefined;
  const fallbackBase = new URL('.', manifestUrl).toString();

  if (!publicPath || isAutomaticPublicPath(publicPath)) {
    return fallbackBase;
  }

  try {
    return new URL(ensureTrailingSlash(publicPath), manifestUrl).toString();
  } catch {
    return fallbackBase;
  }
}

// Per-request scope for in-flight remote JSON fetches. A fetch Promise is
// request-bound I/O in workerd: it must never be stored on a module-level
// map and awaited by a later, unrelated request (that throws "Cannot
// perform I/O on behalf of a different request"). This scope only dedupes
// concurrent lookups for the same URL made while handling one request; it is
// created fresh per request and discarded once that request completes.
function createRemoteJsonFetchScope() {
  return new Map();
}

async function fetchRemoteJson(jsonUrl, pendingFetches) {
  if (remoteJsonCache.has(jsonUrl)) {
    return remoteJsonCache.get(jsonUrl);
  }

  if (pendingFetches.has(jsonUrl)) {
    return pendingFetches.get(jsonUrl);
  }

  const pending = (async () => {
    let response;
    try {
      response = await fetch(jsonUrl);
    } catch {
      return {};
    }

    if (!response.ok) {
      return {};
    }

    const value = await response.json().catch(() => undefined);
    if (value === undefined) {
      return {};
    }

    // Only a settled, plain value is safe to share across requests.
    remoteJsonCache.set(jsonUrl, value);
    return value;
  })();

  pendingFetches.set(jsonUrl, pending);

  try {
    return await pending;
  } finally {
    pendingFetches.delete(jsonUrl);
  }
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

function collectLocalFragmentCssAssets(html, request) {
  if (request.headers.get('x-modern-js-fragment-request') !== '1') {
    return undefined;
  }

  const renderedExposes = collectRenderedFederatedExposes(html);
  const localManifest = MODERN_WORKER_MANIFEST.moduleFederation;
  if (!localManifest) {
    return undefined;
  }
  const containerName = localManifest?.name;
  const assets = new Set();

  for (const { boundaryId, expose } of renderedExposes) {
    if (containerName && boundaryId !== containerName) {
      continue;
    }

    const localExpose = findRemoteExpose(localManifest, expose);

    for (const asset of Array.isArray(localExpose?.css)
      ? localExpose.css
      : []) {
      assets.add(asset);
    }
  }

  return [...assets];
}

async function createLocalFragmentProvenance(html, request) {
  const fragmentRequest = readDistributedSsrFragmentRequest(request);
  if (!fragmentRequest) {
    return undefined;
  }
  const localManifest = MODERN_WORKER_MANIFEST.moduleFederation;
  const deliveryUnit = MODERN_WORKER_MANIFEST.deliveryUnit;
  if (
    !localManifest ||
    localManifest.name !== fragmentRequest.boundaryId ||
    !findRemoteExpose(localManifest, fragmentRequest.expose) ||
    typeof deliveryUnit?.buildMarker !== 'string' ||
    typeof deliveryUnit?.sourceRevision !== 'string' ||
    typeof deliveryUnit?.unitId !== 'string'
  ) {
    return undefined;
  }
  const fragmentHtml = extractRenderedFragmentHtml(
    html,
    fragmentRequest.boundaryId,
    fragmentRequest.expose,
  );
  if (!fragmentHtml) {
    return undefined;
  }

  return {
    boundaryId: fragmentRequest.boundaryId,
    buildMarker: deliveryUnit.buildMarker,
    digest: await sha256Hex(fragmentHtml),
    expose: fragmentRequest.expose,
    remote: fragmentRequest.remote,
    sourceRevision: deliveryUnit.sourceRevision,
    unitId: deliveryUnit.unitId,
  };
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

async function collectRenderedRemoteCssHrefs(
  html,
  request,
  env,
  exposes,
  pendingRemoteJsonFetches,
) {
  const bodyStart = html.indexOf('</head>');
  const composedFragmentHrefs = collectStylesheetHrefs(
    bodyStart >= 0 ? html.slice(bodyStart + '</head>'.length) : html,
  );

  if (composedFragmentHrefs.length > 0) {
    return [...new Set(composedFragmentHrefs)];
  }

  const renderedExposes = exposes ?? collectRenderedFederatedExposes(html);

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

      const remoteManifest = await fetchRemoteJson(
        manifestUrl,
        pendingRemoteJsonFetches,
      );
      const remoteExpose = findRemoteExpose(remoteManifest, expose);
      const publicPath = getRemoteAssetBase(remoteManifest, manifestUrl);
      const remoteRouteManifest = await fetchRemoteJson(
        new URL('routes-manifest.json', publicPath).toString(),
        pendingRemoteJsonFetches,
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

async function withRouteCssLinks(
  response,
  route,
  routeManifest,
  request,
  env,
  distributedSsrFragmentCssHrefs,
  distributedSsrFragments,
) {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('text/html') || response.body === null) {
    return response;
  }

  // Scoped to this one request/response cycle; never stored on a module map.
  const pendingRemoteJsonFetches = createRemoteJsonFetchScope();

  if (readDistributedSsrFragmentRequest(request) === undefined) {
    const resolvedDistributedSsrFragmentCssHrefs =
      distributedSsrFragments?.getCurrentStylesheetHrefs() ??
      (await Promise.resolve(distributedSsrFragmentCssHrefs ?? []));
    const headers = new Headers(response.headers);
    const cssEntries = [
      ...collectRouteCssAssets(route, routeManifest).map(asset => {
        const href = toRouteCssHtmlHref(asset);

        return {
          href,
          preloadHref: new URL(href, request.url).toString(),
          reactResource: false,
        };
      }),
      ...resolvedDistributedSsrFragmentCssHrefs.map(href => ({
        href,
        preloadHref: new URL(href, request.url).toString(),
        reactResource: true,
      })),
    ];
    const seenCssHrefs = new Set();
    const uniqueCssEntries = cssEntries.filter(entry => {
      if (seenCssHrefs.has(entry.preloadHref)) {
        return false;
      }

      seenCssHrefs.add(entry.preloadHref);
      return true;
    });
    const requestOrigin = new URL(request.url).origin;
    for (const { preloadHref } of uniqueCssEntries) {
      const preloadUrl = new URL(preloadHref);
      const preloadReference =
        preloadUrl.origin === requestOrigin
          ? `${preloadUrl.pathname}${preloadUrl.search}`
          : preloadUrl.toString();

      headers.append('link', `<${preloadReference}>; rel=preload; as=style`);
    }
    headers.delete('content-length');

    const seenExposes = new Set();
    const resolveRemoteCss = async attributes => {
      const boundaryId = attributes['data-modern-boundary-id'];
      const expose = attributes['data-modern-mf-expose'];
      if (!boundaryId || !expose) return [];
      const verifiedHrefs = distributedSsrFragments?.getCurrentStylesheetHrefs(
        boundaryId,
        expose,
      );
      if (verifiedHrefs !== undefined) return verifiedHrefs;
      const key = JSON.stringify([boundaryId, expose]);
      if (seenExposes.has(key)) return [];
      seenExposes.add(key);
      return collectRenderedRemoteCssHrefs(
        '',
        request,
        env,
        [{ boundaryId, expose }],
        pendingRemoteJsonFetches,
      );
    };
    return new Response(
      createStylesheetLinkStream(
        response.body,
        uniqueCssEntries,
        request.url,
        resolveRemoteCss,
      ),
      {
        headers,
        status: response.status,
        statusText: response.statusText,
      },
    );
  }

  const resolvedDistributedSsrFragmentCssHrefs = await Promise.resolve(
    distributedSsrFragments?.getStylesheetHrefs() ??
      distributedSsrFragmentCssHrefs ??
      [],
  );
  const html = dedupeStylesheetLinks(
    await response.text(),
    undefined,
    request.url,
  );
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const localFragmentCssAssets = collectLocalFragmentCssAssets(html, request);
  const localFragmentProvenance = await createLocalFragmentProvenance(
    html,
    request,
  );

  if (localFragmentCssAssets !== undefined) {
    headers.set(
      DISTRIBUTED_SSR_CSS_HEADER,
      JSON.stringify(localFragmentCssAssets),
    );
  }
  if (localFragmentProvenance !== undefined) {
    headers.set(
      DISTRIBUTED_SSR_PROVENANCE_HEADER,
      encodeURIComponent(JSON.stringify(localFragmentProvenance)),
    );
  }

  const cssEntries = [
    ...collectRouteCssAssets(route, routeManifest).map(asset => {
      const href = toRouteCssHtmlHref(asset);

      return {
        href,
        preloadHref: new URL(href, request.url).toString(),
        reactResource: false,
      };
    }),
    ...(resolvedDistributedSsrFragmentCssHrefs.length > 0
      ? resolvedDistributedSsrFragmentCssHrefs
      : await collectRenderedRemoteCssHrefs(
          html,
          request,
          env,
          undefined,
          pendingRemoteJsonFetches,
        )
    ).map(href => ({
      href,
      preloadHref: new URL(href, request.url).toString(),
      reactResource: true,
    })),
  ];

  const requestOrigin = new URL(request.url).origin;
  if (cssEntries.length === 0) {
    return new Response(html, {
      headers,
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
  for (const { preloadHref } of uniqueCssEntries) {
    const preloadUrl = new URL(preloadHref);
    const preloadReference =
      preloadUrl.origin === requestOrigin
        ? `${preloadUrl.pathname}${preloadUrl.search}`
        : preloadUrl.toString();

    headers.append('link', `<${preloadReference}>; rel=preload; as=style`);
  }

  const links = uniqueCssEntries
    .filter(
      ({ href, preloadHref }) =>
        !html.includes(href) && !html.includes(preloadHref),
    )
    .map(({ href, reactResource }) =>
      reactResource
        ? `<link href="${escapeAttribute(href)}" rel="stylesheet" type="text/css" data-precedence="default">`
        : `<link rel="stylesheet" href="${escapeAttribute(href)}">`,
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

async function getRequestHandlerOptions(
  route,
  request,
  env,
  executionContext,
  includeHtmlTemplate = true,
) {
  const [htmlTemplate, routeManifest, loadableStats] = await Promise.all([
    includeHtmlTemplate
      ? readAssetText(route.entryPath, request, env)
      : undefined,
    readAssetJson(MODERN_WORKER_MANIFEST.resources.routeManifest, request, env),
    readAssetJson(MODERN_WORKER_MANIFEST.resources.loadableStats, request, env),
  ]);
  const distributedSsrFragments = createDistributedSsrFragmentContext(
    request,
    env,
  );
  const distributedSsrFragmentRequest =
    readDistributedSsrFragmentRequest(request);

  const options = createRequestHandlerOptions({
    route,
    htmlTemplate: htmlTemplate || '',
    routeManifest,
    loadableStats,
    env,
    executionContext,
    distributedSsrFragments,
    distributedSsrFragmentRequest,
  });
  if (!includeHtmlTemplate) {
    delete options.resource.htmlTemplate;
  }
  return options;
}
