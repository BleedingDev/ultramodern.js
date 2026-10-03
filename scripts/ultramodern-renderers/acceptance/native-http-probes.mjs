import assert from 'node:assert/strict';

const dataContentType = 'application/vnd.ultramodern.data+json; charset=utf-8';
const defaultIdentityHeader = 'x-ultramodern-renderer-identity';
const privateHeader = 'x-conformance-private';

function requireValue(condition, message) {
  assert.ok(condition, `native-http-probes: ${message}`);
}

/**
 * Build probeHttp specifications for the authored Solid/Octane SSR fixtures.
 * Inputs must come from the current built identity, analyzed server route prefix,
 * authorized native route IR, and emitted head assets. No host is started and no
 * route ID, asset filename, entry prefix, or acceptance evidence is inferred.
 * runId must be a fresh fixture token, 1..47 ASCII letters/digits/_/-.
 * headIncludes supplies actual emitted asset markers; authored title/description
 * markers are added here. Pass result.identityHeader to probeHttp if overridden.
 * Controls require the runner's owning public readDataResponse decoder. The
 * ownerRequirements list describes checks that raw HTTP markers cannot prove.
 */
export function createNativeHttpProbes({
  kind,
  environment,
  identity,
  routePrefix,
  pageRouteId,
  controlRouteId,
  runId,
  headIncludes,
  identityHeader = defaultIdentityHeader,
}) {
  requireValue(
    ['generated', 'hand-authored'].includes(kind),
    'the actual generated or hand-authored consumer kind is required',
  );
  requireValue(
    ['development', 'production'].includes(environment),
    'the actual host environment is required',
  );
  requireValue(
    identity && typeof identity === 'object' && !Array.isArray(identity),
    'built renderer identity is required',
  );
  requireValue(
    ['solid', 'octane'].includes(identity.renderer),
    'an authored Solid or Octane renderer is required',
  );
  requireValue(
    Object.keys(identity).sort().join(',') ===
      'appId,buildId,entryName,protocolVersion,renderer',
    'identity must use the current renderer identity schema',
  );
  for (const key of ['appId', 'entryName', 'buildId']) {
    requireValue(
      typeof identity[key] === 'string' && identity[key].trim().length > 0,
      `identity ${key} is required`,
    );
  }
  requireValue(identity.protocolVersion === 1, 'unsupported identity protocol');
  requireValue(
    typeof routePrefix === 'string' &&
      /^\/(?:[^/?#\\\s]+\/)*[^/?#\\\s]*$/u.test(routePrefix) &&
      !routePrefix.split('/').some(part => part === '.' || part === '..') &&
      !/%(?:2e|2f|5c)/iu.test(routePrefix),
    'an explicit absolute analyzed route prefix is required',
  );
  for (const [name, value] of Object.entries({ pageRouteId, controlRouteId })) {
    requireValue(
      typeof value === 'string' && value.trim().length > 0,
      `the actual ${name} is required`,
    );
  }
  requireValue(pageRouteId !== controlRouteId, 'route IDs must differ');
  requireValue(
    typeof runId === 'string' && /^[A-Za-z0-9_-]{1,47}$/u.test(runId),
    'runId must be a fresh bounded fixture token (1..47 characters)',
  );
  requireValue(
    Array.isArray(headIncludes) &&
      headIncludes.every(
        value => typeof value === 'string' && value.length > 0,
      ),
    'actual emitted head asset markers are required',
  );
  requireValue(
    typeof identityHeader === 'string' &&
      /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(identityHeader),
    'identityHeader must be an HTTP header name',
  );

  const boundIdentity = structuredClone(identity);
  const prefix = routePrefix === '/' ? '' : routePrefix.replace(/\/$/u, '');
  const pagePath = `${prefix}/`;
  const controlPath = `${prefix}/control`;
  const path = (pathname, parameters) =>
    `${pathname}?${new URLSearchParams(parameters).toString()}`;
  const documentPath = parameters => path(pagePath, parameters);
  const dataPath = parameters =>
    path(pagePath, { __loader: pageRouteId, ...parameters });
  const control = conformanceId =>
    path(controlPath, { __loader: controlRouteId, conformanceId });
  const headers = privateValue => ({
    'cache-control': 'no-store',
    [privateHeader]: privateValue,
  });
  const cookies = (conformanceId, privateValue) => [
    `conformance-group=${encodeURIComponent(conformanceId)}; Path=/; SameSite=Lax`,
    `conformance-private=${encodeURIComponent(privateValue)}; Path=/; SameSite=Lax`,
  ];
  const approvedHeaders = (conformanceId, privateValue) => ({
    'cache-control': 'no-store',
    [privateHeader]: privateValue,
    'set-cookie': cookies(conformanceId, privateValue),
  });
  const dataHeaders = {
    'content-type': dataContentType,
    'cache-control': 'no-store',
    'x-modernjs-response': 'yes',
  };
  const expectation = (status, details = {}) => ({
    status,
    identity: boundIdentity,
    identityHeader,
    ...details,
  });
  const groupIds = Object.fromEntries(
    [
      'document-cookies',
      'data-cookies',
      'action-cookies',
      'concurrent',
      'stream',
      'abort',
    ].map(suffix => [suffix, `${runId}-${suffix}`]),
  );
  const documentPrivate = `${runId}-document-private`;
  const dataPrivate = `${runId}-data-private`;
  const actionPrivate = `${runId}-action-private`;
  const savedName = `${runId}-saved`;
  const renderMarker = `${kind === 'generated' ? 'Generated' : 'Hand-authored'} ${identity.renderer === 'solid' ? 'Solid' : 'Octane'} consumer`;
  const bodyIncludes = ['data-testid="native-layout"', renderMarker];
  const actionBody = intent =>
    new URLSearchParams({ name: savedName, intent }).toString();
  const actionHeaders = {
    ...headers(actionPrivate),
    'content-type': 'application/x-www-form-urlencoded',
  };
  const errorExpectation = authoredMessage => ({
    headers: dataHeaders,
    // The owning generated server entry uses handleDataRequest's default
    // production projection in both build modes. Client-only data is separate.
    bodyIncludes: ['Unexpected Server Error'],
    bodyExcludes: [authoredMessage],
  });

  const cases = [
    {
      id: 'native-document',
      dimension: 'ssr',
      path: pagePath,
      headers: { 'cache-control': 'no-store' },
      expect: expectation(200, { bodyIncludes }),
    },
    {
      id: 'native-head-assets',
      dimension: 'head-assets',
      path: pagePath,
      headers: { 'cache-control': 'no-store' },
      expect: expectation(200, {
        bodyIncludes,
        headIncludes: [
          `${identity.renderer} acceptance home`,
          'Native renderer conformance',
          ...headIncludes,
        ],
      }),
    },
    {
      id: 'native-document-cookies',
      dimension: 'ssr',
      path: documentPath({
        case: 'cookies',
        conformanceId: groupIds['document-cookies'],
      }),
      headers: headers(documentPrivate),
      expect: expectation(200, {
        headers: approvedHeaders(groupIds['document-cookies'], documentPrivate),
        bodyIncludes: [...bodyIncludes, 'Native loader value', documentPrivate],
      }),
    },
    {
      id: 'native-loader-cookies',
      dimension: 'data',
      path: dataPath({
        case: 'cookies',
        conformanceId: groupIds['data-cookies'],
      }),
      headers: headers(dataPrivate),
      expect: expectation(200, {
        headers: {
          ...dataHeaders,
          ...approvedHeaders(groupIds['data-cookies'], dataPrivate),
        },
        bodyIncludes: ['Native loader value', dataPrivate],
      }),
    },
    {
      id: 'native-loader-not-found',
      dimension: 'data',
      path: dataPath({ case: 'not-found' }),
      expect: expectation(404, {
        headers: dataHeaders,
        bodyIncludes: ['Native route not found'],
      }),
    },
    {
      id: 'native-loader-error',
      dimension: 'data',
      path: dataPath({ case: 'error' }),
      expect: expectation(500, errorExpectation('Native loader failure')),
    },
    {
      id: 'native-document-redirect',
      dimension: 'data',
      path: documentPath({ case: 'redirect' }),
      expect: expectation(302, { headers: { location: '/about' } }),
    },
    {
      id: 'native-loader-redirect',
      dimension: 'data',
      path: dataPath({ case: 'redirect' }),
      expect: expectation(200, {
        headers: { ...dataHeaders, 'x-modernjs-redirect': '/about' },
        bodyIncludes: ['/about'],
      }),
    },
    {
      id: 'native-action-cookies',
      dimension: 'action',
      path: dataPath({
        case: 'cookies',
        conformanceId: groupIds['action-cookies'],
      }),
      method: 'POST',
      headers: actionHeaders,
      body: actionBody('save'),
      expect: expectation(200, {
        headers: {
          ...dataHeaders,
          ...approvedHeaders(groupIds['action-cookies'], actionPrivate),
        },
        bodyIncludes: [savedName, actionPrivate],
      }),
    },
    {
      id: 'native-action-invalid',
      dimension: 'action',
      path: dataPath({}),
      method: 'POST',
      headers: actionHeaders,
      body: new URLSearchParams({ name: '', intent: 'save' }).toString(),
      expect: expectation(422, {
        headers: dataHeaders,
        bodyIncludes: ['Name required'],
      }),
    },
    {
      id: 'native-action-error',
      dimension: 'action',
      path: dataPath({}),
      method: 'POST',
      headers: actionHeaders,
      body: actionBody('throw'),
      expect: expectation(500, errorExpectation('Native action failure')),
    },
    {
      id: 'native-action-redirect',
      dimension: 'action',
      path: dataPath({}),
      method: 'POST',
      headers: actionHeaders,
      body: actionBody('redirect'),
      expect: expectation(200, {
        headers: {
          ...dataHeaders,
          'x-modernjs-redirect': '/about',
          'set-cookie': ['conformance-saved=1; Path=/; SameSite=Lax'],
        },
        bodyIncludes: ['/about'],
      }),
    },
  ];
  const privateValues = [`${runId}-request-a`, `${runId}-request-b`];
  const concurrent = [
    {
      id: 'native-overlapping-requests',
      dimension: 'data',
      readyPath: control(groupIds.concurrent),
      releasePath: control(groupIds.concurrent),
      cases: privateValues.map((privateValue, index) => ({
        id: `native-concurrent-${index}`,
        dimension: 'data',
        path: dataPath({
          case: 'concurrent',
          conformanceId: groupIds.concurrent,
        }),
        headers: headers(privateValue),
        expect: expectation(200, {
          headers: {
            ...dataHeaders,
            ...approvedHeaders(groupIds.concurrent, privateValue),
          },
          bodyIncludes: [privateValue],
          bodyExcludes: privateValues.filter(value => value !== privateValue),
        }),
      })),
    },
  ];
  const streamPrivate = `${runId}-stream-private`;
  const abortPrivate = `${runId}-abort-private`;
  const stream = {
    id: 'native-deferred-document',
    dimension: 'ssr',
    path: documentPath({ case: 'stream', conformanceId: groupIds.stream }),
    headers: headers(streamPrivate),
    statePath: control(groupIds.stream),
    releasePath: control(groupIds.stream),
    firstIncludes: 'Native critical value',
    finalIncludes: `Native late value ${streamPrivate}`,
    expect: expectation(200, {
      headers: approvedHeaders(groupIds.stream, streamPrivate),
      bodyIncludes: [
        ...bodyIncludes,
        'Native critical value',
        `Native late value ${streamPrivate}`,
      ],
    }),
  };
  const abort = {
    id: 'native-aborted-document',
    path: documentPath({ case: 'abort', conformanceId: groupIds.abort }),
    headers: headers(abortPrivate),
    statePath: control(groupIds.abort),
    firstIncludes: 'Native critical value',
    expectCleanupCount: 1,
  };

  return {
    kind,
    environment,
    controlRouteId,
    identityHeader,
    cases,
    concurrent,
    stream,
    abort,
    nativeRsc: {
      id: 'native-rsc-before-dispatch',
      path: pagePath,
      headers: { 'x-rsc-tree': 'conformance-unsupported' },
      diagnosticCode: 'unsupported-renderer-capability',
      expect: {
        status: 400,
        headers: { 'cache-control': 'no-store' },
        bodyIncludes: ['unsupported-renderer-capability', 'rsc'],
      },
    },
    ownerRequirements: [
      {
        owner: 'native fixture runner',
        requirement:
          'Decode control responses with the installed public readDataResponse; validate built identity, controlRouteId, operation, success status 200, and object value.',
      },
      {
        owner: 'native data reader/browser acceptance',
        requirement:
          'Decode the real page data outcomes with the installed public reader; HTTP markers do not certify Seroval decoding, route identity, original redirect status, or router adoption.',
        outcomes: [
          {
            probeId: 'native-loader-redirect',
            kind: 'redirect',
            status: 302,
            location: '/about',
          },
          {
            probeId: 'native-action-redirect',
            kind: 'redirect',
            status: 303,
            location: '/about',
          },
          {
            probeId: 'native-loader-not-found',
            kind: 'not-found',
            status: 404,
          },
          { probeId: 'native-action-invalid', kind: 'error', status: 422 },
          { probeId: 'native-loader-error', kind: 'error', status: 500 },
          { probeId: 'native-action-error', kind: 'error', status: 500 },
        ],
      },
      {
        owner: 'native build/artifact acceptance',
        requirement:
          'Bind identity to current SSR metadata, routePrefix and IDs to analyzed native IR, headIncludes to actual emitted assets, kind/environment to this real consumer host, and runId to a fresh owning host run.',
      },
    ],
  };
}
