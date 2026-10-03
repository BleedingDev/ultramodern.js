import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeHttpProbes } from '../../../scripts/ultramodern-renderers/acceptance/native-http-probes.mjs';

// These tests check specifications and failure paths only. They do not start a
// host or certify native SSR, transport, public data decoding, or browser gates.
function inputs(renderer = 'solid') {
  return {
    kind: 'hand-authored',
    environment: 'production',
    identity: {
      renderer,
      appId: `authored-${renderer}`,
      entryName: 'server-entry-unrelated-to-prefix',
      protocolVersion: 1,
      buildId: 'actual-build-id',
    },
    routePrefix: '/owned/native',
    pageRouteId: 'opaque page/id&actual=1',
    controlRouteId: 'opaque control/id&actual=2',
    runId: 'run_20261003_1',
    headIncludes: ['/static/css/actual-emitted.123.css'],
  };
}

function url(path) {
  return new URL(path, 'https://owning-fixture.invalid');
}

function byId(probes, id) {
  const found = probes.cases.find(specification => specification.id === id);
  assert.ok(found, `missing ${id}`);
  return found;
}

for (const renderer of ['solid', 'octane']) {
  test(`${renderer}: exact analyzed prefixes and opaque native IDs bind requests`, () => {
    const configuration = inputs(renderer);
    const probes = createNativeHttpProbes(configuration);
    assert.equal(probes.controlRouteId, configuration.controlRouteId);
    assert.equal(byId(probes, 'native-document').path, '/owned/native/');
    const head = byId(probes, 'native-head-assets');
    assert.deepEqual(head.expect.headIncludes, [
      `${renderer} acceptance home`,
      'Native renderer conformance',
      ...configuration.headIncludes,
    ]);
    assert.ok(
      head.expect.bodyIncludes.includes(
        `Hand-authored ${renderer === 'solid' ? 'Solid' : 'Octane'} consumer`,
      ),
    );
    for (const specification of probes.cases) {
      assert.equal(url(specification.path).pathname, '/owned/native/');
      const loaderId = url(specification.path).searchParams.get('__loader');
      if (
        specification.id.startsWith('native-document') ||
        specification.id === 'native-head-assets'
      )
        assert.equal(loaderId, null);
      else assert.equal(loaderId, configuration.pageRouteId);
      assert.deepEqual(specification.expect.identity, configuration.identity);
    }
  });
}

test('empty startup CSS retains mandatory native title, meta and current identity header checks', () => {
  for (const renderer of ['solid', 'octane'])
    for (const kind of ['generated', 'hand-authored'])
      for (const environment of ['production', 'development']) {
        const configuration = {
          ...inputs(renderer),
          kind,
          environment,
          headIncludes: [],
          identityHeader: 'x-current-renderer',
        };
        const head = byId(
          createNativeHttpProbes(configuration),
          'native-head-assets',
        );
        assert.deepEqual(head.expect.headIncludes, [
          `${renderer} acceptance home`,
          'Native renderer conformance',
        ]);
        assert.deepEqual(head.expect.identity, configuration.identity);
        assert.equal(head.expect.identityHeader, 'x-current-renderer');
        assert.equal(head.expect.status, 200);
        assert.equal(head.headers['cache-control'], 'no-store');
      }
});

test('SSR stream and abort use real document URLs and native data controls', () => {
  const configuration = inputs();
  const probes = createNativeHttpProbes(configuration);
  for (const [scenario, specification] of [
    ['stream', probes.stream],
    ['abort', probes.abort],
  ]) {
    const document = url(specification.path);
    assert.equal(document.pathname, '/owned/native/');
    assert.equal(document.searchParams.get('__loader'), null);
    assert.equal(document.searchParams.get('case'), scenario);
    assert.equal(
      document.searchParams.get('conformanceId'),
      `${configuration.runId}-${scenario}`,
    );
    const state = url(specification.statePath);
    assert.equal(state.pathname, '/owned/native/control');
    assert.equal(
      state.searchParams.get('__loader'),
      configuration.controlRouteId,
    );
    assert.equal(
      state.searchParams.get('conformanceId'),
      document.searchParams.get('conformanceId'),
    );
    assert.equal(specification.firstIncludes, 'Native critical value');
  }
  assert.equal(probes.stream.dimension, 'ssr');
  assert.equal(probes.stream.statePath, probes.stream.releasePath);
  assert.equal(
    probes.stream.finalIncludes,
    `Native late value ${probes.stream.headers['x-conformance-private']}`,
  );
  assert.equal(probes.abort.expectCleanupCount, 1);
});

test('concurrent requests overlap behind one control group and exclude every sibling marker', () => {
  const configuration = inputs();
  const [group] = createNativeHttpProbes(configuration).concurrent;
  assert.equal(group.dimension, 'data');
  assert.equal(group.readyPath, group.releasePath);
  assert.equal(
    url(group.readyPath).searchParams.get('__loader'),
    configuration.controlRouteId,
  );
  const token = url(group.readyPath).searchParams.get('conformanceId');
  const values = group.cases.map(
    specification => specification.headers['x-conformance-private'],
  );
  assert.equal(new Set(values).size, 2);
  for (const specification of group.cases) {
    const target = url(specification.path);
    assert.equal(
      target.searchParams.get('__loader'),
      configuration.pageRouteId,
    );
    assert.equal(target.searchParams.get('case'), 'concurrent');
    assert.equal(target.searchParams.get('conformanceId'), token);
    const own = specification.headers['x-conformance-private'];
    assert.deepEqual(specification.expect.bodyIncludes, [own]);
    assert.deepEqual(
      specification.expect.bodyExcludes,
      values.filter(value => value !== own),
    );
    assert.equal(specification.dimension, group.dimension);
    assert.deepEqual(specification.expect.headers['set-cookie'], [
      `conformance-group=${token}; Path=/; SameSite=Lax`,
      `conformance-private=${own}; Path=/; SameSite=Lax`,
    ]);
  }
});

test('approved document, loader and action headers preserve exact repeated cookie policy', () => {
  const probes = createNativeHttpProbes(inputs());
  for (const id of [
    'native-document-cookies',
    'native-loader-cookies',
    'native-action-cookies',
  ]) {
    const specification = byId(probes, id);
    const token = url(specification.path).searchParams.get('conformanceId');
    const privateValue = specification.headers['x-conformance-private'];
    assert.equal(specification.expect.headers['cache-control'], 'no-store');
    assert.equal(
      specification.expect.headers['x-conformance-private'],
      privateValue,
    );
    assert.deepEqual(specification.expect.headers['set-cookie'], [
      `conformance-group=${token}; Path=/; SameSite=Lax`,
      `conformance-private=${privateValue}; Path=/; SameSite=Lax`,
    ]);
    assert.ok(specification.expect.bodyIncludes.includes(privateValue));
    if (specification.dimension !== 'ssr') {
      assert.equal(
        specification.expect.headers['content-type'],
        'application/vnd.ultramodern.data+json; charset=utf-8',
      );
      assert.equal(specification.expect.headers['x-modernjs-response'], 'yes');
    }
  }
  const action = byId(probes, 'native-action-cookies');
  assert.equal(action.method, 'POST');
  assert.equal(
    action.headers['content-type'],
    'application/x-www-form-urlencoded',
  );
  const form = new URLSearchParams(action.body);
  assert.equal(form.get('intent'), 'save');
  assert.ok(action.expect.bodyIncludes.includes(form.get('name')));
});

test('native redirects assert actual wire transport and leave decoded original statuses to their owner', () => {
  const probes = createNativeHttpProbes(inputs());
  const document = byId(probes, 'native-document-redirect');
  assert.equal(document.expect.status, 302);
  assert.equal(document.expect.headers.location, '/about');
  for (const id of ['native-loader-redirect', 'native-action-redirect']) {
    const specification = byId(probes, id);
    assert.equal(specification.expect.status, 200);
    assert.equal(specification.expect.headers['x-modernjs-redirect'], '/about');
    assert.equal(specification.expect.headers.location, undefined);
    assert.deepEqual(specification.expect.bodyIncludes, ['/about']);
  }
  const obligations = probes.ownerRequirements.find(
    value => value.outcomes,
  ).outcomes;
  assert.deepEqual(
    obligations.filter(value => value.kind === 'redirect'),
    [
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
    ],
  );
  assert.deepEqual(
    byId(probes, 'native-action-redirect').expect.headers['set-cookie'],
    ['conformance-saved=1; Path=/; SameSite=Lax'],
  );
});

test('status cases use stable approved value strings and sanitized production errors', () => {
  const probes = createNativeHttpProbes(inputs());
  assert.equal(byId(probes, 'native-loader-not-found').expect.status, 404);
  const invalid = byId(probes, 'native-action-invalid');
  assert.equal(invalid.expect.status, 422);
  assert.equal(new URLSearchParams(invalid.body).get('name'), '');
  assert.deepEqual(invalid.expect.bodyIncludes, ['Name required']);
  for (const id of ['native-loader-error', 'native-action-error']) {
    const specification = byId(probes, id);
    assert.equal(specification.expect.status, 500);
    assert.deepEqual(specification.expect.bodyIncludes, [
      'Unexpected Server Error',
    ]);
    assert.equal(specification.expect.bodyExcludes.length, 1);
  }
  // No expected raw wire object key, JSON field order, or Seroval node encoding.
  for (const specification of probes.cases.filter(
    value => value.dimension === 'data' || value.dimension === 'action',
  ))
    assert.ok(
      (specification.expect.bodyIncludes ?? []).every(
        value => !/[{}[\]:]/u.test(value) && !value.includes('"'),
      ),
    );
});

test('genuine generated markers and server error privacy follow the actual development host', () => {
  const probes = createNativeHttpProbes({
    ...inputs(),
    kind: 'generated',
    environment: 'development',
  });
  assert.ok(
    byId(probes, 'native-document').expect.bodyIncludes.includes(
      'Generated Solid consumer',
    ),
  );
  for (const [id, message] of [
    ['native-loader-error', 'Native loader failure'],
    ['native-action-error', 'Native action failure'],
  ]) {
    assert.deepEqual(byId(probes, id).expect.bodyIncludes, [
      'Unexpected Server Error',
    ]);
    assert.deepEqual(byId(probes, id).expect.bodyExcludes, [message]);
  }
  assert.equal(probes.kind, 'generated');
  assert.equal(probes.environment, 'development');
});

test('native RSC is rejected by the real early-dispatch headers before entry identity exists', () => {
  const probes = createNativeHttpProbes(inputs());
  assert.deepEqual(probes.nativeRsc.headers, {
    'x-rsc-tree': 'conformance-unsupported',
  });
  assert.equal(probes.nativeRsc.path, '/owned/native/');
  assert.equal(probes.nativeRsc.expect.status, 400);
  assert.equal(probes.nativeRsc.expect.identity, undefined);
  assert.equal(
    probes.nativeRsc.diagnosticCode,
    'unsupported-renderer-capability',
  );
});

test('root and trailing-slash prefixes retain the explicit owning route location', () => {
  for (const [routePrefix, page, control] of [
    ['/', '/', '/control'],
    ['/native/', '/native/', '/native/control'],
    ['/native', '/native/', '/native/control'],
  ]) {
    const probes = createNativeHttpProbes({ ...inputs(), routePrefix });
    assert.equal(byId(probes, 'native-document').path, page);
    assert.equal(url(probes.stream.statePath).pathname, control);
  }
});

test('fresh run tokens isolate every held lifecycle and fit the native bounded observer contract', () => {
  const configuration = { ...inputs(), runId: 'r'.repeat(47) };
  const probes = createNativeHttpProbes(configuration);
  const paths = [
    ...probes.cases.map(value => value.path),
    probes.concurrent[0].readyPath,
    probes.stream.statePath,
    probes.abort.statePath,
  ];
  const tokens = paths
    .map(value => url(value).searchParams.get('conformanceId'))
    .filter(Boolean);
  assert.equal(new Set(tokens).size, 6);
  assert.ok(tokens.every(token => /^[A-Za-z0-9_-]{1,64}$/u.test(token)));
  const other = createNativeHttpProbes({
    ...configuration,
    runId: 'other-run',
  });
  assert.notEqual(probes.stream.statePath, other.stream.statePath);
});

test('invalid identity, authoritative routing, assets, and control token inputs fail closed', () => {
  const good = inputs();
  const bad = [
    { kind: undefined },
    { kind: 'invented-kind' },
    { environment: undefined },
    { environment: 'invented-host' },
    { identity: undefined },
    { identity: { ...good.identity, renderer: 'react' } },
    { identity: { ...good.identity, protocolVersion: 2 } },
    { identity: { ...good.identity, buildId: ' ' } },
    { identity: { ...good.identity, candidateDigest: 'not-runtime-identity' } },
    ...[
      undefined,
      '',
      'native',
      '//other-host',
      '/a//b',
      '/a/../b',
      '/a/%2e%2e/b',
      '/a%2fb',
      '/a\\b',
      '/a?case=stream',
      '/a#fragment',
    ].map(routePrefix => ({ routePrefix })),
    { pageRouteId: '' },
    { controlRouteId: ' ' },
    { controlRouteId: good.pageRouteId },
    ...[undefined, '', 'with spaces', 'bad?query', 'r'.repeat(48)].map(
      runId => ({ runId }),
    ),
    ...[undefined, 'not-an-array', [''], [null], ['/actual.css', 1]].map(
      headIncludes => ({ headIncludes }),
    ),
    { identityHeader: '' },
    { identityHeader: 'bad header' },
    { identityHeader: 'x-header\nleak' },
  ];
  for (const overrides of bad)
    assert.throws(
      () => createNativeHttpProbes({ ...good, ...overrides }),
      /native-http-probes:/u,
    );
});

test('supplied identity and asset markers are copied without claiming observed evidence', () => {
  const configuration = inputs();
  const original = structuredClone(configuration.identity);
  const probes = createNativeHttpProbes({
    ...configuration,
    identityHeader: 'x-owner-runtime-profile',
  });
  configuration.identity.buildId = 'later-build';
  configuration.headIncludes.push('/late-asset.css');
  assert.equal(probes.identityHeader, 'x-owner-runtime-profile');
  assert.deepEqual(byId(probes, 'native-document').expect.identity, original);
  assert.equal(
    byId(probes, 'native-document').expect.identityHeader,
    probes.identityHeader,
  );
  assert.ok(
    !byId(probes, 'native-head-assets').expect.headIncludes.includes(
      '/late-asset.css',
    ),
  );
  assert.equal(probes.observations, undefined);
  assert.equal(probes.assertionCount, undefined);
  assert.equal(probes.certified, undefined);
  assert.ok(probes.ownerRequirements.length > 0);
});
