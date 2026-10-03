import assert from 'node:assert/strict';
import test from 'node:test';
import { createReactHttpProbes } from '../../../scripts/ultramodern-renderers/acceptance/react-http-probes.mjs';

// Specification/failure tests only. No synthetic host or installed React runtime
// is used to claim source, transport, streaming, browser or admission success.
function inputs() {
  return {
    kind: 'hand-authored',
    environment: 'production',
    identity: {
      renderer: 'react',
      appId: 'authored-react',
      entryName: 'actual-SSR-unrelated-to-prefix',
      protocolVersion: 1,
      buildId: 'actual-built-id',
    },
    routePrefix: '/owned/react',
    pageRouteId: 'actual opaque/page&id=1',
    controlRouteId: 'actual opaque/control&id=2',
    runId: 'react-run_1',
    headIncludes: ['/static/css/actual-head.123.css'],
  };
}

function url(path) {
  return new URL(path, 'https://owning-fixture.invalid');
}

function byId(probes, id) {
  const specification = probes.cases.find(value => value.id === id);
  assert.ok(specification, `missing ${id}`);
  return specification;
}

test('React exact analyzed route IDs and prefix bind current built identity without entry inference', () => {
  const configuration = inputs();
  const probes = createReactHttpProbes(configuration);
  assert.equal(probes.cases.length, 13);
  assert.equal(probes.controlRouteId, configuration.controlRouteId);
  assert.equal(byId(probes, 'react-document').path, '/owned/react/');
  for (const specification of probes.cases) {
    const target = url(specification.path);
    assert.equal(target.pathname, '/owned/react/');
    const document = [
      'react-document',
      'react-head-assets',
      'react-document-redirect',
    ].includes(specification.id);
    assert.equal(
      target.searchParams.get('__loader'),
      document ? null : configuration.pageRouteId,
    );
    assert.equal(
      target.searchParams.get('__ssrDirect'),
      document ? null : 'true',
    );
    assert.deepEqual(specification.expect.identity, configuration.identity);
  }
});

test('compiled head markers and actual corpus kind are explicit', () => {
  for (const kind of ['generated', 'hand-authored']) {
    const configuration = { ...inputs(), kind };
    const head = byId(
      createReactHttpProbes(configuration),
      'react-head-assets',
    );
    assert.deepEqual(head.expect.headIncludes, [
      'react acceptance home',
      'Native renderer conformance',
      ...configuration.headIncludes,
    ]);
    assert.ok(
      head.expect.bodyIncludes.includes(
        `${kind === 'generated' ? 'Generated' : 'Hand-authored'} React consumer`,
      ),
    );
    assert.equal(head.dimension, 'head-assets');
  }
});

test('empty startup CSS retains mandatory React title, meta and current identity header checks', () => {
  for (const kind of ['generated', 'hand-authored'])
    for (const environment of ['production', 'development']) {
      const configuration = {
        ...inputs(),
        kind,
        environment,
        headIncludes: [],
        identityHeader: 'x-current-renderer',
      };
      const head = byId(
        createReactHttpProbes(configuration),
        'react-head-assets',
      );
      assert.deepEqual(head.expect.headIncludes, [
        'react acceptance home',
        'Native renderer conformance',
      ]);
      assert.deepEqual(head.expect.identity, configuration.identity);
      assert.equal(head.expect.identityHeader, 'x-current-renderer');
      assert.equal(head.expect.status, 200);
      assert.equal(head.headers['cache-control'], 'no-store');
    }
});

test('plain React loader uses owning deferred wire and plain action uses actual raw JSON wire', () => {
  const probes = createReactHttpProbes(inputs());
  const loader = byId(probes, 'react-loader');
  const action = byId(probes, 'react-action');
  assert.equal(loader.expect.status, 200);
  assert.equal(
    loader.expect.headers['content-type'],
    'text/modernjs-deferred; charset=UTF-8',
  );
  assert.equal(
    action.expect.headers['content-type'],
    'application/json; charset=utf-8',
  );
  assert.equal(action.method, 'POST');
  assert.equal(new URLSearchParams(action.body).get('intent'), 'save');
  for (const specification of [loader, action]) {
    assert.equal(specification.expect.headers['x-modernjs-response'], 'yes');
    assert.ok(
      specification.expect.bodyIncludes.includes(
        specification.headers['x-conformance-private'],
      ),
    );
    assert.equal(
      specification.expect.headers['x-conformance-private'],
      undefined,
    );
    assert.equal(specification.expect.headers['set-cookie'], undefined);
    assert.equal(specification.expect.headers['cache-control'], undefined);
  }
});

test('approved raw JSON loader/action responses preserve only their actual cookie policy', () => {
  const probes = createReactHttpProbes(inputs());
  for (const id of ['react-loader-cookies', 'react-action-cookies']) {
    const specification = byId(probes, id);
    const token = url(specification.path).searchParams.get('conformanceId');
    const privateValue = specification.headers['x-conformance-private'];
    assert.equal(
      specification.expect.headers['content-type'],
      'application/json; charset=utf-8',
    );
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
  }
});

test('matched thrown404 retains text/catch marker while invalid422 is an approved JSON response', () => {
  const probes = createReactHttpProbes(inputs());
  const notFound = byId(probes, 'react-loader-not-found');
  assert.equal(notFound.expect.status, 404);
  assert.deepEqual(notFound.expect.headers, {
    'content-type': 'text/plain;charset=UTF-8',
    'x-modernjs-catch': 'yes',
  });
  assert.deepEqual(notFound.expect.bodyIncludes, ['Native route not found']);
  const invalid = byId(probes, 'react-action-invalid');
  assert.equal(invalid.expect.status, 422);
  assert.deepEqual(invalid.expect.headers, {
    'content-type': 'application/json',
    'x-modernjs-response': 'yes',
  });
  assert.equal(new URLSearchParams(invalid.body).get('name'), '');
  assert.deepEqual(invalid.expect.bodyIncludes, ['Name required']);
});

test('500 errors match actual host environment and production sanitization', () => {
  for (const environment of ['production', 'development']) {
    const probes = createReactHttpProbes({ ...inputs(), environment });
    for (const [id, message] of [
      ['react-loader-error', 'Native loader failure'],
      ['react-action-error', 'Native action failure'],
    ]) {
      const specification = byId(probes, id);
      assert.equal(specification.expect.status, 500);
      assert.deepEqual(specification.expect.headers, {
        'content-type': 'application/json',
        'x-modernjs-error': 'yes',
      });
      assert.deepEqual(specification.expect.bodyIncludes, [
        environment === 'production' ? 'Unexpected Server Error' : message,
      ]);
      assert.deepEqual(
        specification.expect.bodyExcludes,
        environment === 'production' ? [message, '"stack"'] : undefined,
      );
    }
  }
});

test('document redirect is native307 with analyzed prefix while real data redirects are204', () => {
  const probes = createReactHttpProbes(inputs());
  const document = byId(probes, 'react-document-redirect');
  assert.equal(document.expect.status, 307);
  assert.equal(document.expect.headers.location, '/owned/react/about');
  for (const id of ['react-loader-redirect', 'react-action-redirect']) {
    const specification = byId(probes, id);
    assert.equal(specification.expect.status, 204);
    assert.equal(specification.expect.headers['x-modernjs-redirect'], '/about');
    assert.equal(specification.expect.headers['x-modernjs-response'], 'yes');
    assert.equal(specification.expect.headers.location, undefined);
    assert.equal(specification.expect.bodyIncludes, undefined);
  }
  assert.deepEqual(
    byId(probes, 'react-action-redirect').expect.headers['set-cookie'],
    ['conformance-saved=1; Path=/; SameSite=Lax'],
  );
  const overlap = createReactHttpProbes({ ...inputs(), routePrefix: '/a' });
  assert.equal(
    byId(overlap, 'react-loader-redirect').expect.headers[
      'x-modernjs-redirect'
    ],
    '/about',
  );
  assert.ok(
    overlap.ownerRequirements.some(value =>
      value.requirement.includes('literal basename replacement'),
    ),
  );
});

test('real held concurrency requests share one observer and exclude all sibling private markers', () => {
  const configuration = inputs();
  const [group] = createReactHttpProbes(configuration).concurrent;
  assert.equal(group.readyPath, group.releasePath);
  assert.equal(
    url(group.readyPath).searchParams.get('__loader'),
    configuration.controlRouteId,
  );
  assert.equal(url(group.readyPath).searchParams.get('__ssrDirect'), 'true');
  const values = group.cases.map(
    value => value.headers['x-conformance-private'],
  );
  assert.equal(new Set(values).size, 2);
  for (const specification of group.cases) {
    assert.equal(specification.dimension, group.dimension);
    assert.equal(
      url(specification.path).searchParams.get('case'),
      'concurrent',
    );
    assert.equal(
      url(specification.path).searchParams.get('__loader'),
      configuration.pageRouteId,
    );
    assert.equal(
      url(specification.path).searchParams.get('conformanceId'),
      url(group.readyPath).searchParams.get('conformanceId'),
    );
    const own = specification.headers['x-conformance-private'];
    assert.deepEqual(specification.expect.bodyIncludes, [own]);
    assert.deepEqual(
      specification.expect.bodyExcludes,
      values.filter(value => value !== own),
    );
    assert.equal(
      specification.expect.headers['content-type'],
      'application/json; charset=utf-8',
    );
    assert.equal(specification.expect.headers['set-cookie'].length, 2);
  }
});

test('stream/abort request genuine document SSR and do not invent response init headers', () => {
  const configuration = inputs();
  const probes = createReactHttpProbes(configuration);
  for (const [scenario, specification] of [
    ['stream', probes.stream],
    ['abort', probes.abort],
  ]) {
    assert.equal(url(specification.path).searchParams.get('__loader'), null);
    assert.equal(url(specification.path).searchParams.get('__ssrDirect'), null);
    assert.equal(url(specification.path).searchParams.get('case'), scenario);
    assert.equal(url(specification.statePath).pathname, '/owned/react/control');
    assert.equal(
      url(specification.statePath).searchParams.get('__loader'),
      configuration.controlRouteId,
    );
    assert.equal(
      url(specification.statePath).searchParams.get('conformanceId'),
      url(specification.path).searchParams.get('conformanceId'),
    );
    assert.equal(specification.firstIncludes, 'Native critical value');
    assert.equal(specification.expect?.headers, undefined);
  }
  assert.equal(probes.stream.dimension, 'ssr');
  assert.equal(probes.stream.statePath, probes.stream.releasePath);
  assert.equal(
    probes.stream.finalIncludes,
    `Native late value ${probes.stream.headers['x-conformance-private']}`,
  );
  assert.ok(probes.stream.expect.bodyIncludes.includes('Native pending'));
  assert.equal(probes.abort.expectCleanupCount, 1);
});

test('fresh tokens fit the genuine bounded control contract and do not share latches', () => {
  const probes = createReactHttpProbes({ ...inputs(), runId: 'r'.repeat(47) });
  const paths = [
    ...probes.cases.map(value => value.path),
    probes.concurrent[0].readyPath,
    probes.stream.statePath,
    probes.abort.statePath,
  ];
  const tokens = paths
    .map(value => url(value).searchParams.get('conformanceId'))
    .filter(Boolean);
  assert.equal(new Set(tokens).size, 5);
  assert.ok(tokens.every(value => /^[A-Za-z0-9_-]{1,64}$/u.test(value)));
  const other = createReactHttpProbes({ ...inputs(), runId: 'other-run' });
  assert.notEqual(probes.stream.statePath, other.stream.statePath);
});

test('explicit root/trailing prefixes retain authoritative route location and redirect target', () => {
  for (const [routePrefix, expected] of [
    ['/', '/'],
    ['/native', '/native/'],
    ['/native/', '/native/'],
  ]) {
    const probes = createReactHttpProbes({ ...inputs(), routePrefix });
    assert.equal(byId(probes, 'react-document').path, expected);
    assert.equal(
      byId(probes, 'react-document-redirect').expect.headers.location,
      `${expected}about`,
    );
    assert.equal(url(probes.stream.statePath).pathname, `${expected}control`);
  }
});

test('missing or malformed current authority fails closed', () => {
  const good = inputs();
  const bad = [
    { kind: undefined },
    { kind: 'pretend' },
    { environment: undefined },
    { environment: 'test' },
    { identity: undefined },
    { identity: { ...good.identity, renderer: 'solid' } },
    { identity: { ...good.identity, buildId: ' ' } },
    { identity: { ...good.identity, protocolVersion: 2 } },
    { identity: { ...good.identity, digest: 'candidate-not-runtime' } },
    ...[
      undefined,
      '',
      'native',
      '//host',
      '/a//b',
      '/a/../b',
      '/a/%2e%2e/b',
      '/a%2fb',
      '/a\\b',
      '/a?x=1',
      '/a#x',
    ].map(routePrefix => ({ routePrefix })),
    { pageRouteId: '' },
    { controlRouteId: ' ' },
    { controlRouteId: good.pageRouteId },
    ...[undefined, '', 'with space', 'bad?query', 'r'.repeat(48)].map(
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
      () => createReactHttpProbes({ ...good, ...overrides }),
      /react-http-probes:/u,
    );
});

test('identity/assets are copied, controls use JSON, and no unsupported React RSC or admission is invented', () => {
  const configuration = inputs();
  const original = structuredClone(configuration.identity);
  const probes = createReactHttpProbes({
    ...configuration,
    identityHeader: 'x-owner-profile',
  });
  configuration.identity.buildId = 'later-build';
  configuration.headIncludes.push('/later.css');
  assert.deepEqual(byId(probes, 'react-document').expect.identity, original);
  assert.equal(probes.identityHeader, 'x-owner-profile');
  assert.equal(
    byId(probes, 'react-document').expect.identityHeader,
    probes.identityHeader,
  );
  assert.ok(
    !byId(probes, 'react-head-assets').expect.headIncludes.includes(
      '/later.css',
    ),
  );
  assert.equal(probes.controlProtocol, 'react-json');
  assert.equal(probes.decodeControlResponse, undefined);
  assert.equal(probes.nativeRsc, undefined);
  assert.equal(probes.observations, undefined);
  assert.equal(probes.certified, undefined);
  assert.ok(
    !JSON.stringify(probes.cases).includes('application/vnd.ultramodern'),
  );
});
