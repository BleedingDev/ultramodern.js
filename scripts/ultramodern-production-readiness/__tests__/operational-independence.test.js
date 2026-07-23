const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function loadProof() {
  return import('../operational-independence.mjs');
}

test('operational process environment preserves exact pnpm and scrubs build identity overrides', async () => {
  const { createOperationalProcessEnv } = await loadProof();
  const env = createOperationalProcessEnv({
    PATH: '/exact/pnpm/bin',
    npm_config_registry: 'http://registry.example.test',
    ULTRAMODERN_SOURCE_REVISION: 'forbidden-source-override',
    MODERNJS_DEPLOY: 'cloudflare',
  });
  assert.equal(env.PATH, '/exact/pnpm/bin');
  assert.equal(env.npm_config_registry, 'http://registry.example.test');
  assert.equal(env.ULTRAMODERN_SOURCE_REVISION, undefined);
  assert.equal(env.MODERNJS_DEPLOY, undefined);
});

test('Node served proof starts each remote deterministically and waits before starting the shell', async () => {
  const { startNodeTargetsInDependencyOrder } = await loadProof();
  const events = [];
  const target = (id, kind = 'vertical') => ({
    app: { id, kind },
    baseUrl: `http://${id}.test`,
  });
  const inventory = target('inventory');
  const finance = target('finance');
  const shell = target('shell-super-app', 'shell');
  const servers = [];

  await startNodeTargetsInDependencyOrder({
    artifactDir: '/proof/artifacts',
    processEnv: { PATH: '/exact/pnpm/bin' },
    projectDir: '/proof/workspace',
    servers,
    startServerImpl: currentTarget => {
      events.push(`start:${currentTarget.app.id}`);
      return {
        exited: new Promise(() => {}),
        logPath: `/proof/${currentTarget.app.id}.log`,
      };
    },
    startup: {
      remoteLayers: [[inventory, finance]],
      shells: [shell],
    },
    waitForTargetImpl: async (currentTarget, options) => {
      events.push(
        `ready:${currentTarget.app.id}:${String(options.requireManifest)}`,
      );
    },
  });

  assert.equal(servers.length, 3);
  assert.deepEqual(events, [
    'start:inventory',
    'ready:inventory:true',
    'start:finance',
    'ready:finance:true',
    'start:shell-super-app',
    'ready:shell-super-app:false',
  ]);
});

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function createIdentity(sourceRevision, buildMarker) {
  return {
    unitId: 'proof/catalog',
    buildMarker,
    sourceRevision,
    releaseVersion: '0.1.0',
  };
}

function createOutput({
  id,
  kind = 'vertical',
  identity,
  treeToken,
  surfaceTokens,
  envelopeToken = treeToken,
}) {
  const surfaces = Object.fromEntries(
    Object.entries(surfaceTokens).map(([surface, token]) => [
      surface,
      {
        artifactCount: surface === 'backendFederation' ? 2 : 1,
        artifacts: [{ logicalPath: `${surface}.js`, sha256: token }],
        carrierPaths: [`${surface}.js`],
        digest: token,
        identity,
      },
    ]),
  );
  return {
    app: {
      id,
      kind,
      package: `@proof/${id}`,
      path: kind === 'shell' ? `apps/${id}` : `verticals/${id}`,
    },
    artifactRoot:
      kind === 'shell' ? `apps/${id}/.output` : `verticals/${id}/.output`,
    envelope:
      kind === 'shell' && !identity
        ? { present: false }
        : {
            envelopeDigest: envelopeToken,
            envelopeFile: { sha256: envelopeToken, byteLength: 10 },
            identity,
            surfaces,
          },
    tree: {
      entryCount: 1,
      entries: [
        {
          path: 'index.js',
          type: 'file',
          byteLength: 1,
          sha256: treeToken,
        },
      ],
      treeDigest: treeToken,
    },
  };
}

function createComparisonFixture() {
  const c0 = 'a'.repeat(40);
  const c1 = 'b'.repeat(40);
  const beforeIdentity = createIdentity(c0, 'marker-c0');
  const afterIdentity = createIdentity(c1, 'marker-c1');
  const beforeSurfaces = {
    uiClient: 'ui-c0',
    ssr: 'ssr-c0',
    apiBackend: 'api-c0',
    backendFederation: 'backend-c0',
  };
  const afterSurfaces = {
    uiClient: 'ui-c1',
    ssr: 'ssr-c1',
    apiBackend: 'api-c1',
    backendFederation: 'backend-c1',
  };
  const apps = {
    shell: {
      id: 'shell-super-app',
      kind: 'shell',
      package: '@proof/shell-super-app',
      path: 'apps/shell-super-app',
    },
    changed: {
      id: 'catalog',
      kind: 'vertical',
      package: '@proof/catalog',
      path: 'verticals/catalog',
    },
    sibling: {
      id: 'checkout',
      kind: 'vertical',
      package: '@proof/checkout',
      path: 'verticals/checkout',
    },
  };
  const shell = createOutput({
    id: apps.shell.id,
    kind: 'shell',
    treeToken: 'shell-tree',
    surfaceTokens: {},
  });
  const sibling = createOutput({
    id: apps.sibling.id,
    identity: createIdentity(c0, 'checkout-marker'),
    treeToken: 'sibling-tree',
    surfaceTokens: beforeSurfaces,
    envelopeToken: 'sibling-envelope',
  });
  const baseline = {
    [apps.shell.id]: shell,
    [apps.changed.id]: createOutput({
      id: apps.changed.id,
      identity: beforeIdentity,
      treeToken: 'catalog-tree-c0',
      surfaceTokens: beforeSurfaces,
      envelopeToken: 'catalog-envelope-c0',
    }),
    [apps.sibling.id]: sibling,
  };
  const changed = {
    [apps.shell.id]: structuredClone(shell),
    [apps.changed.id]: createOutput({
      id: apps.changed.id,
      identity: afterIdentity,
      treeToken: 'catalog-tree-c1',
      surfaceTokens: afterSurfaces,
      envelopeToken: 'catalog-envelope-c1',
    }),
    [apps.sibling.id]: structuredClone(sibling),
  };
  return {
    apps,
    baseline,
    changed,
    revisions: { baseline: c0, changed: c1 },
  };
}

function createServedBehaviorFixture(overrides = {}) {
  const identity = createIdentity('b'.repeat(40), 'marker-c1');
  const expectedApiValue = 'Inventory C1 operational proof response';
  const expectedUiValue =
    'C1 operational independence: inventory UI and localization moved together.';
  const marker = {
    build: identity.buildMarker,
    buildMarker: identity.buildMarker,
    sourceRevision: identity.sourceRevision,
    unitId: identity.unitId,
    version: identity.releaseVersion,
  };
  const responses = {
    'http://inventory.test/en': `<main data-app-id="inventory"><p data-build-marker="${identity.buildMarker}">inventory</p></main>`,
    'http://shell.test/en': `<section data-modern-boundary-id="verticalInventory" data-modern-mf-expose="./Widget"><p>${expectedUiValue}</p></section>`,
    'http://inventory.test/inventory-api/inventory': JSON.stringify({
      items: [{ marker, title: expectedApiValue }],
    }),
    ...overrides.responses,
  };
  return {
    app: {
      api: { prefix: '/inventory-api', stem: 'inventory' },
      id: 'inventory',
      moduleFederation: { name: 'verticalInventory' },
    },
    baseUrl: 'http://inventory.test',
    expectedApiValue,
    expectedUiValue,
    fetchImpl: async url => {
      const parsedUrl = new URL(url);
      const body = responses[`${parsedUrl.origin}${parsedUrl.pathname}`];
      return new Response(body ?? 'missing', {
        headers: {
          'content-type': body?.startsWith('{')
            ? 'application/json'
            : 'text/html',
        },
        status: body === undefined ? 404 : 200,
      });
    },
    identity,
    platform: 'node',
    uiBaseUrl: 'http://shell.test',
    ...overrides,
  };
}

function canonical(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

function createEnvelopeFixture(
  root,
  target = 'node',
  { neutralNodeLauncher = false } = {},
) {
  const identity = createIdentity('a'.repeat(40), '0123456789abcdef');
  const files = {
    'public/client.js': `export const identity=${JSON.stringify(identity)};`,
    'server/ssr.js': `export const identity=${JSON.stringify(identity)};`,
    'api/index.js': `module.exports=${JSON.stringify(identity)};`,
    'backend-mf-manifest.json': JSON.stringify({ identity }),
    'backendRemoteEntry.cjs': `module.exports=${JSON.stringify(identity)};`,
    'node_modules/@bleedingdev/runtime/package.json': JSON.stringify({
      name: '@bleedingdev/runtime',
      version: '1.0.0',
    }),
    ...(neutralNodeLauncher
      ? { 'index.js': "require('./server/ssr.js');\n" }
      : {}),
  };
  for (const [logicalPath, source] of Object.entries(files)) {
    const filePath = path.join(root, logicalPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  const runtimes =
    target === 'node'
      ? {
          'public/client.js': 'browser',
          'server/ssr.js': 'nodejs',
          'api/index.js': 'nodejs',
          'backend-mf-manifest.json': 'module-federation-manifest',
          'backendRemoteEntry.cjs': 'nodejs',
          'node_modules/@bleedingdev/runtime/package.json': 'nodejs-deployment',
          ...(neutralNodeLauncher ? { 'index.js': 'nodejs' } : {}),
        }
      : {
          'public/client.js': 'browser',
          'server/ssr.js': 'workerd',
          'api/index.js': 'workerd-effect',
          'backend-mf-manifest.json': 'module-federation-manifest',
          'backendRemoteEntry.cjs': 'commonjs-module',
          'node_modules/@bleedingdev/runtime/package.json':
            'workerd-deployment',
        };
  const artifacts = Object.keys(files)
    .sort()
    .map(logicalPath => {
      const bytes = fs.readFileSync(path.join(root, logicalPath));
      return {
        kind: 'file',
        logicalPath,
        runtime: runtimes[logicalPath],
        byteLength: bytes.byteLength,
        sha256: digest(bytes),
      };
    });
  const aliasPath = path.join(root, 'node_modules/@modern-js/runtime');
  const aliasTarget = path.join(root, 'node_modules/@bleedingdev/runtime');
  fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
  fs.symlinkSync(
    path.relative(path.dirname(aliasPath), aliasTarget),
    aliasPath,
    'dir',
  );
  artifacts.push({
    kind: 'symbolic-link',
    linkTarget: path.relative(path.dirname(aliasPath), aliasTarget),
    logicalPath: 'node_modules/@modern-js/runtime',
    runtime: 'nodejs-deployment',
    targetKind: 'directory',
    targetLogicalPath: 'node_modules/@bleedingdev/runtime',
  });
  artifacts.sort((left, right) =>
    left.logicalPath.localeCompare(right.logicalPath),
  );
  const payload = {
    schemaVersion: 3,
    kind: 'ultramodern-target-microvertical-release-envelope',
    target,
    identity,
    artifacts,
    surfaces: {
      uiClient: ['public/client.js'],
      ssr: [...(neutralNodeLauncher ? ['index.js'] : []), 'server/ssr.js'],
      apiBackend: ['api/index.js'],
      backendFederation: {
        manifest: 'backend-mf-manifest.json',
        container: 'backendRemoteEntry.cjs',
      },
    },
  };
  const envelope = {
    ...payload,
    envelopeDigest: digest(Buffer.from(canonical(payload))),
  };
  const envelopePath = path.join(
    root,
    'release/microvertical-release-envelope.json',
  );
  fs.mkdirSync(path.dirname(envelopePath), { recursive: true });
  fs.writeFileSync(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
  return { envelope, envelopePath, identity };
}

function rewriteEnvelopeArtifact(root, logicalPath, source) {
  const envelopePath = path.join(
    root,
    'release/microvertical-release-envelope.json',
  );
  const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
  fs.writeFileSync(path.join(root, logicalPath), source);
  const bytes = fs.readFileSync(path.join(root, logicalPath));
  const artifact = envelope.artifacts.find(
    candidate => candidate.logicalPath === logicalPath,
  );
  artifact.byteLength = bytes.byteLength;
  artifact.sha256 = digest(bytes);
  const payload = {
    schemaVersion: envelope.schemaVersion,
    kind: envelope.kind,
    target: envelope.target,
    identity: envelope.identity,
    artifacts: envelope.artifacts,
    surfaces: envelope.surfaces,
  };
  envelope.envelopeDigest = digest(Buffer.from(canonical(payload)));
  fs.writeFileSync(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
}

test('build commands use native workspace C0 scripts and one exact C1 package filter', async () => {
  const { createBuildCommand, createWorkspaceBuildCommand } = await loadProof();

  assert.deepEqual(createBuildCommand('@proof/catalog', 'node'), {
    command: 'pnpm',
    args: ['--filter', '@proof/catalog', 'run', 'build'],
  });
  assert.deepEqual(createBuildCommand('@proof/catalog', 'cloudflare'), {
    command: 'pnpm',
    args: ['--filter', '@proof/catalog', 'run', 'cloudflare:build'],
  });
  assert.deepEqual(createWorkspaceBuildCommand('node'), {
    command: 'pnpm',
    args: ['run', 'build'],
  });
  assert.deepEqual(createWorkspaceBuildCommand('cloudflare'), {
    command: 'pnpm',
    args: ['run', 'cloudflare:build'],
  });
  assert.throws(
    () => createBuildCommand('@proof/catalog', 'all'),
    /Unsupported build target/,
  );
});

test('path guard accepts only a non-empty changed-MicroVertical diff', async () => {
  const { assertChangedPathsOwnedBy } = await loadProof();

  assert.deepEqual(
    assertChangedPathsOwnedBy(
      ['verticals/catalog/src/catalog.tsx', 'verticals/catalog/api/index.ts'],
      'verticals/catalog',
    ),
    ['verticals/catalog/src/catalog.tsx', 'verticals/catalog/api/index.ts'],
  );
  assert.throws(
    () => assertChangedPathsOwnedBy([], 'verticals/catalog'),
    /at least one tracked file/,
  );
  assert.throws(
    () =>
      assertChangedPathsOwnedBy(
        ['verticals/catalog/src/catalog.tsx', 'package.json'],
        'verticals/catalog',
      ),
    /outside verticals\/catalog: package\.json/,
  );
  assert.throws(
    () =>
      assertChangedPathsOwnedBy(
        ['verticals/catalogue/src/page.tsx'],
        'verticals/catalog',
      ),
    /outside verticals\/catalog/,
  );
});

test('topology selector allows extra ERP verticals while isolating three chosen apps', async t => {
  const { readTopologyApps } = await loadProof();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'operational-independence-topology-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.modernjs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.modernjs/ultramodern.json'),
    JSON.stringify({
      topology: {
        apps: [
          {
            id: 'shell-super-app',
            kind: 'shell',
            package: '@proof/shell-super-app',
            path: 'apps/shell-super-app',
          },
          ...['inventory', 'finance', 'people', 'analytics'].map(id => ({
            id,
            kind: 'vertical',
            package: `@proof/${id}`,
            path: `verticals/${id}`,
          })),
        ],
      },
    }),
  );

  assert.deepEqual(
    readTopologyApps(root, {
      shell: 'shell-super-app',
      changed: 'inventory',
      sibling: 'finance',
    }),
    {
      shell: {
        id: 'shell-super-app',
        kind: 'shell',
        package: '@proof/shell-super-app',
        path: 'apps/shell-super-app',
      },
      changed: {
        id: 'inventory',
        kind: 'vertical',
        package: '@proof/inventory',
        path: 'verticals/inventory',
      },
      sibling: {
        id: 'finance',
        kind: 'vertical',
        package: '@proof/finance',
        path: 'verticals/finance',
      },
    },
  );
});

test('comparison proves all changed surfaces rotate and siblings stay byte-identical', async () => {
  const { compareTargetSnapshots } = await loadProof();
  const fixture = createComparisonFixture();

  const result = compareTargetSnapshots({
    target: 'node',
    ...fixture,
  });

  assert.equal(result.changed.changed, true);
  assert.deepEqual(Object.keys(result.changed.surfaces).sort(), [
    'apiBackend',
    'backendFederation',
    'ssr',
    'uiClient',
  ]);
  assert.equal(result.shell.byteIdentical, true);
  assert.equal(result.shell.envelopeIdentical, true);
  assert.equal(result.sibling.byteIdentical, true);
  assert.equal(result.sibling.envelopeIdentical, true);
});

test('comparison rejects every stale changed-MicroVertical surface', async () => {
  const { compareTargetSnapshots } = await loadProof();

  for (const surface of [
    'uiClient',
    'ssr',
    'apiBackend',
    'backendFederation',
  ]) {
    const fixture = createComparisonFixture();
    fixture.changed.catalog.envelope.surfaces[surface].digest =
      fixture.baseline.catalog.envelope.surfaces[surface].digest;
    assert.throws(
      () =>
        compareTargetSnapshots({
          target: 'node',
          ...fixture,
        }),
      new RegExp(`${surface} surface did not rotate`),
    );
  }
});

test('comparison rejects one-byte sibling drift and envelope drift', async () => {
  const { compareTargetSnapshots } = await loadProof();

  const bytesFixture = createComparisonFixture();
  bytesFixture.changed.checkout.tree.entries[0].sha256 = 'different-byte';
  assert.throws(
    () =>
      compareTargetSnapshots({
        target: 'cloudflare',
        ...bytesFixture,
      }),
    /checkout final output bytes changed unexpectedly/,
  );

  const envelopeFixture = createComparisonFixture();
  envelopeFixture.changed.checkout.envelope.envelopeFile.sha256 =
    'different-envelope';
  assert.throws(
    () =>
      compareTargetSnapshots({
        target: 'cloudflare',
        ...envelopeFixture,
      }),
    /checkout release envelope changed unexpectedly/,
  );
});

test('cross-target check requires the exact same changed identity', async () => {
  const { assertCrossTargetIdentity } = await loadProof();
  const fixture = createComparisonFixture();
  const node = fixture.changed.catalog;
  const cloudflare = structuredClone(node);
  cloudflare.envelope.envelopeDigest = 'cloudflare-envelope';

  assert.deepEqual(assertCrossTargetIdentity(node, cloudflare), {
    equal: true,
    identity: node.envelope.identity,
    nodeEnvelopeDigest: node.envelope.envelopeDigest,
    cloudflareEnvelopeDigest: 'cloudflare-envelope',
  });

  cloudflare.envelope.identity.buildMarker = 'wrong-marker';
  assert.throws(
    () => assertCrossTargetIdentity(node, cloudflare),
    /identities do not match/,
  );
});

test('served behavior derives both changed and shell targets from one topology', async () => {
  const { servedBehaviorAppIds } = await loadProof();
  const apps = createComparisonFixture().apps;

  assert.deepEqual(servedBehaviorAppIds(apps), {
    appId: 'catalog',
    shellId: 'shell-super-app',
  });
  assert.throws(
    () =>
      servedBehaviorAppIds({
        changed: apps.changed,
      }),
    /requires distinct changed-MicroVertical and shell app ids/,
  );
});

test('served behavior requires exact visible UI, API value, and C1 runtime identity', async () => {
  const { verifyServedBehavior } = await loadProof();
  const fixture = createServedBehaviorFixture();

  const evidence = await verifyServedBehavior(fixture);

  assert.equal(evidence.result, 'pass');
  assert.equal(evidence.responses.api.value, fixture.expectedApiValue);
  assert.equal(evidence.responses.ui.value, fixture.expectedUiValue);
  assert.equal(evidence.responses.ui.visiblyRendered, true);
  assert.equal(
    evidence.identity.sourceRevision,
    fixture.identity.sourceRevision,
  );
  assert.match(evidence.responses.api.bodySha256, /^[a-f0-9]{64}$/u);
});

test('served behavior rejects artifact-only decoys and stale live responses', async () => {
  const { verifyServedBehavior } = await loadProof();
  const fixture = createServedBehaviorFixture({
    responses: {
      'http://shell.test/en':
        '<section data-modern-boundary-id="verticalInventory" data-modern-mf-expose="./Widget"><script>C1 operational independence: inventory UI and localization moved together.</script><p>stale UI</p></section>',
      'http://inventory.test/inventory-api/inventory': JSON.stringify({
        items: [
          {
            marker: {
              build: 'marker-c1',
              buildMarker: 'marker-c1',
              sourceRevision: 'b'.repeat(40),
              unitId: 'proof/catalog',
              version: '0.1.0',
            },
            title: 'stale API response',
          },
        ],
      }),
    },
  });

  await assert.rejects(
    verifyServedBehavior(fixture),
    /did not visibly render the exact expected C1 UI value|did not serve the exact expected C1 API value/,
  );
});

test('served behavior rejects a forged marker even when exact C1 values are live', async () => {
  const { verifyServedBehavior } = await loadProof();
  const fixture = createServedBehaviorFixture();
  const forgedResponses = {
    'http://inventory.test/inventory-api/inventory': JSON.stringify({
      items: [
        {
          marker: {
            build: 'forged',
            buildMarker: 'forged',
            sourceRevision: fixture.identity.sourceRevision,
            unitId: fixture.identity.unitId,
            version: fixture.identity.releaseVersion,
          },
          title: fixture.expectedApiValue,
        },
      ],
    }),
  };

  await assert.rejects(
    verifyServedBehavior(
      createServedBehaviorFixture({ responses: forgedResponses }),
    ),
    /API marker build does not match the C1 release identity/,
  );
});

test('served behavior rejects a stale API response even when the C1 artifact value is known', async () => {
  const { verifyServedBehavior } = await loadProof();
  const fixture = createServedBehaviorFixture();
  const staleApiResponse = JSON.stringify({
    items: [
      {
        marker: {
          build: fixture.identity.buildMarker,
          buildMarker: fixture.identity.buildMarker,
          sourceRevision: fixture.identity.sourceRevision,
          unitId: fixture.identity.unitId,
          version: fixture.identity.releaseVersion,
        },
        title: 'stale API response',
      },
    ],
  });

  await assert.rejects(
    verifyServedBehavior(
      createServedBehaviorFixture({
        responses: {
          'http://inventory.test/inventory-api/inventory': staleApiResponse,
        },
      }),
    ),
    /did not serve the exact expected C1 API value/,
  );
});

test('final-envelope verification binds all four surfaces to real bytes and identity', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'operational-independence-envelope-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = createEnvelopeFixture(root);

  const evidence = readAndVerifyEnvelope(root, 'node');

  assert.deepEqual(evidence.identity, fixture.identity);
  assert.deepEqual(Object.keys(evidence.surfaces).sort(), [
    'apiBackend',
    'backendFederation',
    'ssr',
    'uiClient',
  ]);
  assert.equal(
    Object.values(evidence.surfaces).every(
      surface => surface.carrierPaths.length > 0,
    ),
    true,
  );
});

test('final-envelope verification accepts a neutral Node launcher outside the compiled SSR identity closure', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'operational-independence-node-launcher-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createEnvelopeFixture(root, 'node', { neutralNodeLauncher: true });

  const evidence = readAndVerifyEnvelope(root, 'node');

  assert.equal(evidence.surfaces.ssr.artifacts.length, 2);
  assert.deepEqual(evidence.surfaces.ssr.carrierPaths, ['server/ssr.js']);
});

test('final-envelope verification still rejects prior identity in a neutral Node launcher', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'operational-independence-stale-node-launcher-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createEnvelopeFixture(root, 'node', { neutralNodeLauncher: true });
  const priorIdentity = createIdentity('b'.repeat(40), 'fedcba9876543210');
  rewriteEnvelopeArtifact(
    root,
    'index.js',
    `require('./server/ssr.js');\n/* ${priorIdentity.buildMarker} ${priorIdentity.sourceRevision} */\n`,
  );

  assert.throws(
    () =>
      readAndVerifyEnvelope(root, 'node', {
        forbiddenIdentity: priorIdentity,
      }),
    /retains prior release identity residue/,
  );
});

test('final-envelope verification rejects stale artifact bytes and forged payloads', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const staleRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'operational-independence-stale-'),
  );
  const forgedRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'operational-independence-forged-'),
  );
  t.after(() => {
    fs.rmSync(staleRoot, { recursive: true, force: true });
    fs.rmSync(forgedRoot, { recursive: true, force: true });
  });

  createEnvelopeFixture(staleRoot);
  fs.appendFileSync(path.join(staleRoot, 'api/index.js'), '\n// stale');
  assert.throws(
    () => readAndVerifyEnvelope(staleRoot, 'node'),
    /digest does not match final bytes/,
  );

  const forged = createEnvelopeFixture(forgedRoot);
  const envelope = JSON.parse(fs.readFileSync(forged.envelopePath, 'utf8'));
  envelope.identity.sourceRevision = 'b'.repeat(40);
  fs.writeFileSync(
    forged.envelopePath,
    `${JSON.stringify(envelope, null, 2)}\n`,
  );
  assert.throws(
    () => readAndVerifyEnvelope(forgedRoot, 'node'),
    /does not carry the exact release identity|canonical payload/,
  );
});

test('final-envelope verification rejects a fresh decoy beside a stale compiled surface artifact', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'operational-independence-mixed-surface-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = createEnvelopeFixture(root);
  const stalePath = 'public/stale-client.js';
  fs.writeFileSync(path.join(root, stalePath), 'export const stale = true;');
  const envelope = JSON.parse(fs.readFileSync(fixture.envelopePath, 'utf8'));
  const staleBytes = fs.readFileSync(path.join(root, stalePath));
  envelope.artifacts.push({
    kind: 'file',
    logicalPath: stalePath,
    runtime: 'browser',
    byteLength: staleBytes.byteLength,
    sha256: digest(staleBytes),
  });
  envelope.artifacts.sort((left, right) =>
    left.logicalPath.localeCompare(right.logicalPath),
  );
  envelope.surfaces.uiClient.push(stalePath);
  envelope.surfaces.uiClient.sort((left, right) => left.localeCompare(right));
  const payload = {
    schemaVersion: envelope.schemaVersion,
    kind: envelope.kind,
    target: envelope.target,
    identity: envelope.identity,
    artifacts: envelope.artifacts,
    surfaces: envelope.surfaces,
  };
  envelope.envelopeDigest = digest(Buffer.from(canonical(payload)));
  fs.writeFileSync(
    fixture.envelopePath,
    `${JSON.stringify(envelope, null, 2)}\n`,
  );

  assert.throws(
    () => readAndVerifyEnvelope(root, 'node'),
    /stale-client\.js" does not carry the exact release identity/,
  );
});

test('final-envelope verification structurally binds file and symbolic-link artifact kinds', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'operational-independence-symlink-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = createEnvelopeFixture(root);

  const evidence = readAndVerifyEnvelope(root, 'node');
  assert.deepEqual(
    evidence.artifacts.find(
      artifact => artifact.logicalPath === 'node_modules/@modern-js/runtime',
    ),
    {
      kind: 'symbolic-link',
      linkTarget: '../@bleedingdev/runtime',
      logicalPath: 'node_modules/@modern-js/runtime',
      runtime: 'nodejs-deployment',
      targetKind: 'directory',
      targetLogicalPath: 'node_modules/@bleedingdev/runtime',
    },
  );

  const aliasPath = path.join(root, 'node_modules/@modern-js/runtime');
  const copyTarget = path.join(root, 'node_modules/@bleedingdev/runtime-copy');
  fs.cpSync(path.join(root, 'node_modules/@bleedingdev/runtime'), copyTarget, {
    recursive: true,
  });
  fs.rmSync(aliasPath);
  fs.symlinkSync(
    path.relative(path.dirname(aliasPath), copyTarget),
    aliasPath,
    'dir',
  );
  assert.throws(
    () => readAndVerifyEnvelope(root, 'node'),
    /linkTarget|targetLogicalPath/,
  );

  fs.rmSync(aliasPath);
  fs.symlinkSync('../@bleedingdev/runtime', aliasPath, 'dir');
  const clientPath = path.join(root, 'public/client.js');
  const clientCopyPath = path.join(root, 'public/client-copy.js');
  fs.copyFileSync(clientPath, clientCopyPath);
  fs.rmSync(clientPath);
  fs.symlinkSync('client-copy.js', clientPath);
  assert.throws(
    () => readAndVerifyEnvelope(root, 'node'),
    /file artifact|regular file|symbolic link/,
  );

  fs.rmSync(clientPath);
  fs.renameSync(clientCopyPath, clientPath);
  const publicPath = path.join(root, 'public');
  const publicTargetPath = path.join(root, '..public-target');
  fs.renameSync(publicPath, publicTargetPath);
  fs.symlinkSync('..public-target', publicPath, 'dir');
  assert.throws(
    () => readAndVerifyEnvelope(root, 'node'),
    /symbolic-link ancestor/,
  );

  fs.rmSync(publicPath);
  fs.renameSync(publicTargetPath, publicPath);
  const envelope = JSON.parse(fs.readFileSync(fixture.envelopePath, 'utf8'));
  envelope.surfaces.uiClient = ['node_modules/@modern-js/runtime'];
  const payload = {
    schemaVersion: envelope.schemaVersion,
    kind: envelope.kind,
    target: envelope.target,
    identity: envelope.identity,
    artifacts: envelope.artifacts,
    surfaces: envelope.surfaces,
  };
  envelope.envelopeDigest = digest(Buffer.from(canonical(payload)));
  fs.writeFileSync(
    fixture.envelopePath,
    `${JSON.stringify(envelope, null, 2)}\n`,
  );
  assert.throws(
    () => readAndVerifyEnvelope(root, 'node'),
    /surface.*file artifact|symbolic-link artifact/,
  );
});

test('final-envelope verification rejects hostile symbolic-link targets and metadata', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const roots = [];
  t.after(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  for (const failure of [
    'outside-root',
    'private-release',
    'ancestor',
    'target-kind',
  ]) {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), `operational-independence-${failure}-`),
    );
    roots.push(root);
    const fixture = createEnvelopeFixture(root);
    const aliasPath = path.join(root, 'node_modules/@modern-js/runtime');
    const envelope = JSON.parse(fs.readFileSync(fixture.envelopePath, 'utf8'));
    const aliasArtifact = envelope.artifacts.find(
      artifact => artifact.logicalPath === 'node_modules/@modern-js/runtime',
    );

    if (failure === 'target-kind') {
      aliasArtifact.targetKind = 'file';
    } else {
      fs.rmSync(aliasPath);
      const target =
        failure === 'outside-root'
          ? fs.mkdtempSync(
              path.join(os.tmpdir(), 'operational-independence-external-'),
            )
          : failure === 'private-release'
            ? path.join(root, 'release')
            : path.join(root, 'node_modules');
      if (failure === 'outside-root') {
        roots.push(target);
      }
      const linkTarget = path.relative(path.dirname(aliasPath), target);
      fs.symlinkSync(linkTarget, aliasPath, 'dir');
      aliasArtifact.linkTarget = linkTarget;
      aliasArtifact.targetLogicalPath =
        failure === 'private-release' ? 'release' : 'node_modules';
    }

    const payload = {
      schemaVersion: envelope.schemaVersion,
      kind: envelope.kind,
      target: envelope.target,
      identity: envelope.identity,
      artifacts: envelope.artifacts,
      surfaces: envelope.surfaces,
    };
    envelope.envelopeDigest = digest(Buffer.from(canonical(payload)));
    fs.writeFileSync(
      fixture.envelopePath,
      `${JSON.stringify(envelope, null, 2)}\n`,
    );

    assert.throws(
      () => readAndVerifyEnvelope(root, 'node'),
      failure === 'outside-root'
        ? /outside artifactRoot/
        : failure === 'private-release'
          ? /private release metadata/
          : failure === 'ancestor'
            ? /ancestor directory/
            : /targetKind/,
    );
  }
});

test('final-envelope verification rejects prior identity residue in every C1 compiled module', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'operational-independence-residue-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = createEnvelopeFixture(root);
  const priorIdentity = createIdentity('b'.repeat(40), 'fedcba9876543210');
  const currentSource = fs.readFileSync(
    path.join(root, 'api/index.js'),
    'utf8',
  );
  rewriteEnvelopeArtifact(
    root,
    'api/index.js',
    `${currentSource}\n/* ${priorIdentity.buildMarker} ${priorIdentity.sourceRevision} */`,
  );

  assert.throws(
    () =>
      readAndVerifyEnvelope(root, 'node', {
        forbiddenIdentity: priorIdentity,
      }),
    /retains prior release identity residue/,
  );
});

test('argument parser requires the two commit refs and workspace', async () => {
  const { parseArgs } = await loadProof();

  assert.deepEqual(
    parseArgs([
      '--workspace',
      '/tmp/proof',
      '--baseline-ref',
      'HEAD^',
      '--changed-ref',
      'HEAD',
      '--changed-id',
      'catalog',
      '--expected-api-value',
      'C1 API',
      '--expected-ui-value',
      'C1 UI',
    ]),
    {
      workspace: '/tmp/proof',
      baselineRef: 'HEAD^',
      changedRef: 'HEAD',
      changedId: 'catalog',
      expectedApiValue: 'C1 API',
      expectedUiValue: 'C1 UI',
    },
  );
  assert.throws(
    () => parseArgs(['--workspace', '/tmp/proof']),
    /--baseline-ref is required/,
  );
  assert.throws(() => parseArgs(['--wat']), /Unknown argument: --wat/);
});
