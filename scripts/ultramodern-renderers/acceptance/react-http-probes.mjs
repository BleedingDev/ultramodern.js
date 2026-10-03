import assert from 'node:assert/strict';

const identityHeaderDefault = 'x-ultramodern-renderer-identity';
const privateHeader = 'x-conformance-private';
const jsonType = 'application/json; charset=utf-8';
const deferredType = 'text/modernjs-deferred; charset=UTF-8';

function requireValue(condition, message) {
  assert.ok(condition, `react-http-probes: ${message}`);
}

/**
 * Build probeHttp specifications for the genuine React acceptance corpus.
 * Supply current SSR identity metadata, analyzed server prefix and opaque route
 * IDs, actual consumer kind/environment, emitted head asset markers, and a fresh
 * runId (1..47 ASCII letters/digits/_/-). No authority or admission is inferred.
 * Pass result.identityHeader to probeHttp when overriding the default header.
 * Controls are approved raw JSON Responses: use the driver's JSON control path,
 * never the non-React renderer-core/data decoder. Document stream/abort use the
 * owning React Await producer; plain deferred returns supply no response init.
 * This function starts no host and returns no observed acceptance evidence.
 */
export function createReactHttpProbes({
  kind,
  environment,
  identity,
  routePrefix,
  pageRouteId,
  controlRouteId,
  runId,
  headIncludes,
  identityHeader = identityHeaderDefault,
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
    'current built SSR renderer identity is required',
  );
  requireValue(identity.renderer === 'react', 'the React renderer is required');
  requireValue(
    Object.keys(identity).sort().join(',') ===
      'appId,buildId,entryName,protocolVersion,renderer',
    'identity must use the current renderer identity schema',
  );
  for (const name of ['appId', 'entryName', 'buildId'])
    requireValue(
      typeof identity[name] === 'string' && identity[name].trim().length > 0,
      `identity ${name} is required`,
    );
  requireValue(identity.protocolVersion === 1, 'unsupported identity protocol');
  requireValue(
    typeof routePrefix === 'string' &&
      /^\/(?:[^/?#\\\s]+\/)*[^/?#\\\s]*$/u.test(routePrefix) &&
      !routePrefix.split('/').some(part => part === '.' || part === '..') &&
      !/%(?:2e|2f|5c)/iu.test(routePrefix),
    'an explicit absolute analyzed route prefix is required',
  );
  for (const [name, value] of Object.entries({ pageRouteId, controlRouteId }))
    requireValue(
      typeof value === 'string' && value.trim().length > 0,
      `the actual ${name} is required`,
    );
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
  const path = (pathname, parameters) =>
    `${pathname}?${new URLSearchParams(parameters).toString()}`;
  const documentPath = parameters => path(pagePath, parameters);
  const dataPath = parameters =>
    path(pagePath, {
      __loader: pageRouteId,
      __ssrDirect: 'true',
      ...parameters,
    });
  const control = conformanceId =>
    path(`${prefix}/control`, {
      __loader: controlRouteId,
      __ssrDirect: 'true',
      conformanceId,
    });
  const headers = privateValue => ({
    'cache-control': 'no-store',
    [privateHeader]: privateValue,
  });
  const approvedHeaders = (conformanceId, privateValue) => ({
    'content-type': jsonType,
    'cache-control': 'no-store',
    [privateHeader]: privateValue,
    'set-cookie': [
      `conformance-group=${encodeURIComponent(conformanceId)}; Path=/; SameSite=Lax`,
      `conformance-private=${encodeURIComponent(privateValue)}; Path=/; SameSite=Lax`,
    ],
    'x-modernjs-response': 'yes',
  });
  const expectation = (status, details = {}) => ({
    status,
    identity: boundIdentity,
    identityHeader,
    ...details,
  });
  const renderMarker = `${kind === 'generated' ? 'Generated' : 'Hand-authored'} React consumer`;
  const documentMarkers = ['data-testid="native-layout"', renderMarker];
  const dataPrivate = `${runId}-loader-private`;
  const actionPrivate = `${runId}-action-private`;
  const savedName = `${runId}-saved`;
  const groupIds = Object.fromEntries(
    ['data-cookies', 'action-cookies', 'concurrent', 'stream', 'abort'].map(
      suffix => [suffix, `${runId}-${suffix}`],
    ),
  );
  const form = intent =>
    new URLSearchParams({ name: savedName, intent }).toString();
  const formHeaders = {
    ...headers(actionPrivate),
    'content-type': 'application/x-www-form-urlencoded',
  };
  const errorExpectation = authoredMessage => ({
    headers: { 'content-type': 'application/json', 'x-modernjs-error': 'yes' },
    bodyIncludes: [
      environment === 'production'
        ? 'Unexpected Server Error'
        : authoredMessage,
    ],
    ...(environment === 'production'
      ? { bodyExcludes: [authoredMessage, '"stack"'] }
      : {}),
  });
  const cases = [
    {
      id: 'react-document',
      dimension: 'ssr',
      path: pagePath,
      headers: { 'cache-control': 'no-store' },
      expect: expectation(200, { bodyIncludes: documentMarkers }),
    },
    {
      id: 'react-head-assets',
      dimension: 'head-assets',
      path: pagePath,
      headers: { 'cache-control': 'no-store' },
      expect: expectation(200, {
        bodyIncludes: documentMarkers,
        headIncludes: [
          'react acceptance home',
          'Native renderer conformance',
          ...headIncludes,
        ],
      }),
    },
    {
      id: 'react-loader',
      dimension: 'data',
      path: dataPath({}),
      headers: headers(dataPrivate),
      expect: expectation(200, {
        headers: { 'content-type': deferredType, 'x-modernjs-response': 'yes' },
        bodyIncludes: ['Native loader value', dataPrivate],
      }),
    },
    {
      id: 'react-loader-cookies',
      dimension: 'data',
      path: dataPath({
        case: 'cookies',
        conformanceId: groupIds['data-cookies'],
      }),
      headers: headers(dataPrivate),
      expect: expectation(200, {
        headers: approvedHeaders(groupIds['data-cookies'], dataPrivate),
        bodyIncludes: ['Native loader value', dataPrivate],
      }),
    },
    {
      id: 'react-loader-not-found',
      dimension: 'data',
      path: dataPath({ case: 'not-found' }),
      expect: expectation(404, {
        headers: {
          'content-type': 'text/plain;charset=UTF-8',
          'x-modernjs-catch': 'yes',
        },
        bodyIncludes: ['Native route not found'],
      }),
    },
    {
      id: 'react-loader-error',
      dimension: 'data',
      path: dataPath({ case: 'error' }),
      expect: expectation(500, errorExpectation('Native loader failure')),
    },
    {
      id: 'react-document-redirect',
      dimension: 'data',
      path: documentPath({ case: 'redirect' }),
      expect: expectation(307, { headers: { location: `${prefix}/about` } }),
    },
    {
      id: 'react-loader-redirect',
      dimension: 'data',
      path: dataPath({ case: 'redirect' }),
      expect: expectation(204, {
        headers: {
          'x-modernjs-redirect': '/about',
          'x-modernjs-response': 'yes',
        },
      }),
    },
    {
      id: 'react-action',
      dimension: 'action',
      path: dataPath({}),
      method: 'POST',
      headers: formHeaders,
      body: form('save'),
      expect: expectation(200, {
        headers: { 'content-type': jsonType, 'x-modernjs-response': 'yes' },
        bodyIncludes: [savedName, actionPrivate],
      }),
    },
    {
      id: 'react-action-cookies',
      dimension: 'action',
      path: dataPath({
        case: 'cookies',
        conformanceId: groupIds['action-cookies'],
      }),
      method: 'POST',
      headers: formHeaders,
      body: form('save'),
      expect: expectation(200, {
        headers: approvedHeaders(groupIds['action-cookies'], actionPrivate),
        bodyIncludes: [savedName, actionPrivate],
      }),
    },
    {
      id: 'react-action-invalid',
      dimension: 'action',
      path: dataPath({}),
      method: 'POST',
      headers: formHeaders,
      body: new URLSearchParams({ name: '', intent: 'save' }).toString(),
      expect: expectation(422, {
        headers: {
          'content-type': 'application/json',
          'x-modernjs-response': 'yes',
        },
        bodyIncludes: ['Name required'],
      }),
    },
    {
      id: 'react-action-error',
      dimension: 'action',
      path: dataPath({}),
      method: 'POST',
      headers: formHeaders,
      body: form('throw'),
      expect: expectation(500, errorExpectation('Native action failure')),
    },
    {
      id: 'react-action-redirect',
      dimension: 'action',
      path: dataPath({}),
      method: 'POST',
      headers: formHeaders,
      body: form('redirect'),
      expect: expectation(204, {
        headers: {
          'x-modernjs-redirect': '/about',
          'x-modernjs-response': 'yes',
          'set-cookie': ['conformance-saved=1; Path=/; SameSite=Lax'],
        },
      }),
    },
  ];
  const privateValues = [`${runId}-request-a`, `${runId}-request-b`];
  const concurrent = [
    {
      id: 'react-overlapping-requests',
      dimension: 'data',
      readyPath: control(groupIds.concurrent),
      releasePath: control(groupIds.concurrent),
      cases: privateValues.map((privateValue, index) => ({
        id: `react-concurrent-${index}`,
        dimension: 'data',
        path: dataPath({
          case: 'concurrent',
          conformanceId: groupIds.concurrent,
        }),
        headers: headers(privateValue),
        expect: expectation(200, {
          headers: approvedHeaders(groupIds.concurrent, privateValue),
          bodyIncludes: [privateValue],
          bodyExcludes: privateValues.filter(value => value !== privateValue),
        }),
      })),
    },
  ];
  const streamPrivate = `${runId}-stream-private`;
  const abortPrivate = `${runId}-abort-private`;
  return {
    controlRouteId,
    controlProtocol: 'react-json',
    identityHeader,
    cases,
    concurrent,
    stream: {
      id: 'react-deferred-document',
      dimension: 'ssr',
      path: documentPath({ case: 'stream', conformanceId: groupIds.stream }),
      headers: headers(streamPrivate),
      statePath: control(groupIds.stream),
      releasePath: control(groupIds.stream),
      firstIncludes: 'Native critical value',
      finalIncludes: `Native late value ${streamPrivate}`,
      expect: expectation(200, {
        bodyIncludes: [
          ...documentMarkers,
          'Native critical value',
          'Native pending',
          `Native late value ${streamPrivate}`,
        ],
      }),
    },
    abort: {
      id: 'react-aborted-document',
      path: documentPath({ case: 'abort', conformanceId: groupIds.abort }),
      headers: headers(abortPrivate),
      statePath: control(groupIds.abort),
      firstIncludes: 'Native critical value',
      expectCleanupCount: 1,
    },
    ownerRequirements: [
      {
        owner: 'React HTTP runner',
        requirement:
          'Use approved raw JSON control responses, not renderer-core/data decoding. Main response identity must match current installed SSR metadata; controls must belong to that owning request lifecycle.',
      },
      {
        owner: 'React protocol/browser acceptance',
        requirement:
          'Verify actual deferred client decoding, native router adoption, hydration and cancellation. Raw data redirects are204 with empty body and no Location; they do not retain original302/303. Inspect raw observations for forbidden normal response markers on caught404/500 errors.',
      },
      {
        owner: 'React redirect runtime',
        requirement:
          'Keep intended /about data target for every analyzed prefix. The current literal basename replacement can corrupt it for overlapping prefixes; this probe must fail on that framework defect.',
      },
      {
        owner: 'React build/artifact acceptance',
        requirement:
          'Bind identity to actual SSR metadata, prefix/route IDs to current analysis, headIncludes to compiled assets, environment/kind to the actual host and corpus, and runId to a fresh host run. React RSC support belongs to its separate positive runner.',
      },
    ],
  };
}
