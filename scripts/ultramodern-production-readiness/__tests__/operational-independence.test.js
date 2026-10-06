const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function loadProof() {
  return import('../operational-independence.mjs');
}

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

function reseal(envelopePath, envelope) {
  const payload = {
    schemaVersion: envelope.schemaVersion,
    kind: envelope.kind,
    target: envelope.target,
    identity: envelope.identity,
    ...(Object.hasOwn(envelope, 'ui') ? { ui: envelope.ui } : {}),
    artifacts: envelope.artifacts,
    surfaces: envelope.surfaces,
  };
  envelope.envelopeDigest = digest(Buffer.from(canonical(payload)));
  fs.writeFileSync(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
}

function makeRoot(t, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// A real `node` release tree plus envelope/carrier metadata re-derived from bytes.
function createEnvelopeFixture(
  root,
  {
    uiEnabled = true,
    apiEnabled = true,
    target = 'node',
    appId = 'catalog',
    buildMarker = '0123456789abcdef',
    identity = createIdentity('a'.repeat(40), buildMarker),
  } = {},
) {
  const ui = {
    rendererIdentity: {
      renderer: 'react',
      appId,
      entryName: 'main',
      protocolVersion: 1,
      buildId: identity.buildMarker,
    },
    rendererProfile: {
      renderer: 'react',
      protocolVersion: 1,
      compiler: { name: '@rsbuild/plugin-react', version: '2.1.0' },
      hydration: { name: 'react-dom', version: '19.3.0' },
      router: {
        name: '@tanstack/react-router',
        version: '1.170.41',
        coreName: '@tanstack/router-core',
        coreVersion: '1.171.34',
      },
    },
  };
  const provider = { framework: 'tanstack', ...ui.rendererProfile.router };
  ui.routerBindings = {
    main: {
      owner: '@fixture/tanstack-router-owner',
      evidence: 'file-routes',
      defaultProvider: provider,
      providers: [provider],
    },
  };
  const deliveryUnit = {
    appId: ui.rendererIdentity.appId,
    build: identity.buildMarker,
    buildMarker: identity.buildMarker,
    deployProfile: 'cloudflare-ssr-mf-effect-v1',
    kind: 'microvertical-delivery-unit',
    packageName: `@fixture/${appId}`,
    schemaVersion: 1,
    sourceRevision: identity.sourceRevision,
    unitId: identity.unitId,
    version: identity.releaseVersion,
  };
  const runtimes = {
    'public/client.js': 'browser',
    'server/ssr.js': 'nodejs',
    'api/index.js': 'nodejs',
    'backend-mf-manifest.json': 'module-federation-manifest',
    'backendRemoteEntry.cjs': 'nodejs',
    'node_modules/@bleedingdev/runtime/package.json': 'nodejs-deployment',
    'ultramodern-build.json': 'release-identity-metadata',
  };
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
    'ultramodern-build.json': JSON.stringify({
      schemaVersion: 2,
      kind: 'ultramodern-build-artifact',
      deliveryUnit,
      surfaces: {
        api: { ...deliveryUnit, surface: 'api' },
        ...(uiEnabled ? { ui: { ...deliveryUnit, surface: 'ui', ...ui } } : {}),
      },
    }),
  };
  if (!uiEnabled) {
    delete files['public/client.js'];
    delete files['server/ssr.js'];
  }
  if (!apiEnabled) {
    delete files['api/index.js'];
    delete files['backend-mf-manifest.json'];
    delete files['backendRemoteEntry.cjs'];
  }
  for (const [logicalPath, source] of Object.entries(files)) {
    const filePath = path.join(root, logicalPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
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
  fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
  fs.symlinkSync('../@bleedingdev/runtime', aliasPath, 'dir');
  artifacts.push({
    kind: 'symbolic-link',
    linkTarget: '../@bleedingdev/runtime',
    logicalPath: 'node_modules/@modern-js/runtime',
    runtime: 'nodejs-deployment',
    targetKind: 'directory',
    targetLogicalPath: 'node_modules/@bleedingdev/runtime',
  });
  const carrierSurfaces = {
    'api/index.js': ['apiBackend'],
    'backend-mf-manifest.json': ['backendFederation'],
    'backendRemoteEntry.cjs': ['backendFederation'],
    'public/client.js': ['uiClient'],
    'server/ssr.js': ['ssr'],
  };
  const carrierMetadata = {
    schemaVersion: 1,
    kind: 'ultramodern-release-identity-carriers',
    identity,
    carriers: Object.entries(carrierSurfaces)
      .filter(([logicalPath]) => Object.hasOwn(files, logicalPath))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([logicalPath, surfaces]) => {
        const bytes = fs.readFileSync(path.join(root, logicalPath));
        return {
          logicalPath,
          byteLength: bytes.byteLength,
          sha256: digest(bytes),
          surfaces,
        };
      }),
  };
  const carrierMetadataPath =
    'release/microvertical-release-identity-carriers.json';
  const carrierMetadataBytes = Buffer.from(
    `${JSON.stringify(carrierMetadata, null, 2)}\n`,
  );
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.writeFileSync(path.join(root, carrierMetadataPath), carrierMetadataBytes);
  artifacts.push({
    kind: 'file',
    logicalPath: carrierMetadataPath,
    runtime: 'release-identity-metadata',
    byteLength: carrierMetadataBytes.byteLength,
    sha256: digest(carrierMetadataBytes),
  });
  artifacts.sort((left, right) =>
    left.logicalPath.localeCompare(right.logicalPath),
  );
  const envelope = {
    schemaVersion: 5,
    kind: 'ultramodern-target-microvertical-release-envelope',
    target,
    identity,
    ...(uiEnabled ? { ui } : {}),
    artifacts,
    surfaces: {
      uiClient: uiEnabled ? ['public/client.js'] : [],
      ssr: uiEnabled ? ['server/ssr.js'] : [],
      apiBackend: apiEnabled ? ['api/index.js'] : [],
      ...(apiEnabled
        ? {
            backendFederation: {
              manifest: 'backend-mf-manifest.json',
              container: 'backendRemoteEntry.cjs',
            },
          }
        : {}),
    },
  };
  const envelopePath = path.join(
    root,
    'release/microvertical-release-envelope.json',
  );
  reseal(envelopePath, envelope);
  return { envelope, envelopePath, identity };
}

test('cross-target coherence accepts distinct markers from separately verified target carriers', async t => {
  const { assertCrossTargetIdentity, readAndVerifyEnvelope } =
    await loadProof();
  const nodeRoot = makeRoot(t, 'operational-node-coherence');
  const cloudflareRoot = makeRoot(t, 'operational-cloudflare-coherence');
  const nodeFixture = createEnvelopeFixture(nodeRoot, {
    buildMarker: '3'.repeat(64),
  });
  const cloudflareFixture = createEnvelopeFixture(cloudflareRoot, {
    target: 'cloudflare',
    buildMarker: '6'.repeat(64),
  });
  const node = { envelope: readAndVerifyEnvelope(nodeRoot, 'node') };
  const cloudflare = {
    envelope: readAndVerifyEnvelope(cloudflareRoot, 'cloudflare'),
  };

  const binding = assertCrossTargetIdentity(node, cloudflare);

  assert.deepEqual(binding.nodeIdentity, nodeFixture.identity);
  assert.deepEqual(binding.cloudflareIdentity, cloudflareFixture.identity);
  assert.notEqual(
    binding.nodeIdentity.buildMarker,
    binding.cloudflareIdentity.buildMarker,
  );
  assert.equal(Object.hasOwn(binding.identity, 'buildMarker'), false);
  assert.equal(
    Object.hasOwn(binding.renderer.rendererIdentity, 'buildId'),
    false,
  );
  for (const field of ['sourceRevision', 'unitId', 'releaseVersion']) {
    const foreign = structuredClone(cloudflare);
    foreign.envelope.identity[field] = `foreign-${field}`;
    assert.throws(
      () => assertCrossTargetIdentity(node, foreign),
      /identities do not match/u,
      field,
    );
  }
  for (const mutate of [
    ui => {
      ui.rendererIdentity.appId = 'foreign';
    },
    ui => {
      ui.rendererProfile.compiler.version = '99.0.0';
    },
    ui => {
      ui.rendererProfile.hydration.version = '99.0.0';
    },
    ui => {
      ui.rendererProfile.router.coreVersion = '99.0.0';
    },
    ui => {
      ui.routerBindings.main.owner = '@foreign/router-owner';
    },
  ]) {
    const foreign = structuredClone(cloudflare);
    mutate(foreign.envelope.ui);
    assert.throws(
      () => assertCrossTargetIdentity(node, foreign),
      /identities do not match/u,
    );
  }
  const wrongOwnMarker = structuredClone(cloudflareFixture.envelope);
  wrongOwnMarker.identity.buildMarker = nodeFixture.identity.buildMarker;
  wrongOwnMarker.ui.rendererIdentity.buildId = nodeFixture.identity.buildMarker;
  reseal(cloudflareFixture.envelopePath, wrongOwnMarker);
  assert.throws(
    () => readAndVerifyEnvelope(cloudflareRoot, 'cloudflare'),
    /carrier metadata does not match the release envelope identity/u,
  );
});

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

test('baseline build coverage fails closed on a missing or wrong-target MicroVertical envelope', async t => {
  const { assertBaselineBuildCoverage } = await loadProof();
  const root = makeRoot(t, 'operational-baseline-coverage');
  const envelopeOf = appPath =>
    path.join(
      root,
      appPath,
      '.output/release/microvertical-release-envelope.json',
    );
  const configPath = path.join(root, 'topology', 'reference-topology.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      shell: {
        id: 'shell-super-app',
        kind: 'shell',
        path: 'apps/shell',
        package: '@fixture/shell',
      },
      verticals: [
        {
          id: 'catalog',
          kind: 'vertical',
          path: 'verticals/catalog',
          package: '@fixture/catalog',
        },
        {
          id: 'checkout',
          kind: 'vertical',
          path: 'verticals/checkout',
          package: '@fixture/checkout',
        },
      ],
    }),
  );
  fs.mkdirSync(path.join(root, 'topology/local-overlays'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'topology/local-overlays/development.json'),
    JSON.stringify({
      ports: { 'shell-super-app': 3000, catalog: 3001, checkout: 3002 },
    }),
  );
  for (const [appPath, name] of [
    ['apps/shell', '@fixture/shell'],
    ['verticals/catalog', '@fixture/catalog'],
    ['verticals/checkout', '@fixture/checkout'],
  ]) {
    fs.mkdirSync(path.join(root, appPath), { recursive: true });
    fs.writeFileSync(
      path.join(root, appPath, 'package.json'),
      JSON.stringify({ name }),
    );
  }
  fs.mkdirSync(path.join(root, 'apps/shell/.output'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/shell/.output/index.js'), 'served');
  for (const appPath of ['verticals/catalog', 'verticals/checkout']) {
    fs.mkdirSync(path.dirname(envelopeOf(appPath)), { recursive: true });
    fs.writeFileSync(envelopeOf(appPath), JSON.stringify({ target: 'node' }));
  }

  assertBaselineBuildCoverage(root, 'node');

  assert.throws(
    () => assertBaselineBuildCoverage(root, 'cloudflare'),
    /baseline envelope target must be cloudflare/,
  );

  fs.rmSync(envelopeOf('verticals/checkout'));
  assert.throws(
    () => assertBaselineBuildCoverage(root, 'node'),
    /MicroVertical checkout without a parseable release envelope/,
  );
});

test('final-envelope verification binds every released surface to real bytes and identity', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = makeRoot(t, 'operational-independence-envelope');
  const fixture = createEnvelopeFixture(root);

  const evidence = readAndVerifyEnvelope(root, 'node');

  assert.deepEqual(evidence.identity, fixture.identity);
  for (const surface of Object.values(evidence.surfaces)) {
    assert.ok(surface.carrierPaths.length > 0);
  }
});

test('final-envelope verification accepts v5 UI-only output with paired UI and SSR carriers', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = makeRoot(t, 'operational-ui-only-envelope');
  const fixture = createEnvelopeFixture(root, { apiEnabled: false });

  const evidence = readAndVerifyEnvelope(root, 'node');

  assert.deepEqual(evidence.identity, fixture.identity);
  assert.ok(evidence.ui);
  assert.deepEqual(evidence.surfaces.uiClient.carrierPaths, [
    'public/client.js',
  ]);
  assert.deepEqual(evidence.surfaces.ssr.carrierPaths, ['server/ssr.js']);
  for (const surfaceName of ['apiBackend', 'backendFederation']) {
    assert.equal(evidence.surfaces[surfaceName].artifactCount, 0);
    assert.deepEqual(evidence.surfaces[surfaceName].carrierPaths, []);
  }
  assert.equal(
    Object.hasOwn(fixture.envelope.surfaces, 'backendFederation'),
    false,
  );
  const artifact = JSON.parse(
    fs.readFileSync(path.join(root, 'ultramodern-build.json'), 'utf8'),
  );
  assert.equal(artifact.surfaces.api.buildMarker, fixture.identity.buildMarker);
});

test('final-envelope verification accepts v5 API-only output without UI metadata', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = makeRoot(t, 'operational-api-only-envelope');
  const fixture = createEnvelopeFixture(root, { uiEnabled: false });

  const evidence = readAndVerifyEnvelope(root, 'node');

  assert.deepEqual(evidence.identity, fixture.identity);
  assert.equal(Object.hasOwn(evidence, 'ui'), false);
  for (const surfaceName of ['uiClient', 'ssr']) {
    assert.equal(evidence.surfaces[surfaceName].artifactCount, 0);
    assert.deepEqual(evidence.surfaces[surfaceName].carrierPaths, []);
  }
  assert.deepEqual(evidence.surfaces.apiBackend.carrierPaths, ['api/index.js']);
  assert.deepEqual(evidence.surfaces.backendFederation.carrierPaths, [
    'backend-mf-manifest.json',
    'backendRemoteEntry.cjs',
  ]);
});

test('final-envelope verification rejects incomplete or inconsistent v5 surface pairs', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  for (const [failure, message] of [
    [
      'missing-ssr',
      'envelope UI/client and SSR surfaces must be declared together.',
    ],
    [
      'missing-ui',
      'envelope UI/client and SSR surfaces must be declared together.',
    ],
    [
      'missing-federation',
      'envelope API/backend and backend federation surfaces must be declared together.',
    ],
    [
      'empty-api',
      'envelope API/backend and backend federation surfaces must be declared together.',
    ],
    ['empty-release', 'envelope must declare a UI or API/backend surface.'],
  ]) {
    const root = makeRoot(t, `operational-invalid-surfaces-${failure}`);
    const fixture = createEnvelopeFixture(root);
    if (failure === 'missing-ssr') fixture.envelope.surfaces.ssr = [];
    if (failure === 'missing-ui') fixture.envelope.surfaces.uiClient = [];
    if (failure === 'missing-federation')
      delete fixture.envelope.surfaces.backendFederation;
    if (failure === 'empty-api') fixture.envelope.surfaces.apiBackend = [];
    if (failure === 'empty-release') {
      fixture.envelope.surfaces = { uiClient: [], ssr: [], apiBackend: [] };
      delete fixture.envelope.ui;
    }
    reseal(fixture.envelopePath, fixture.envelope);

    assert.throws(
      () => readAndVerifyEnvelope(root, 'node'),
      { message },
      failure,
    );
  }
});

test('final-envelope verification rejects carriers declared for absent executable surfaces', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  for (const surfaceName of ['apiBackend', 'backendFederation']) {
    const root = makeRoot(t, `operational-undeclared-carrier-${surfaceName}`);
    const fixture = createEnvelopeFixture(root, { apiEnabled: false });
    const carrierPath = path.join(
      root,
      'release/microvertical-release-identity-carriers.json',
    );
    const carriers = JSON.parse(fs.readFileSync(carrierPath, 'utf8'));
    carriers.carriers.find(
      carrier => carrier.logicalPath === 'public/client.js',
    ).surfaces = [surfaceName, 'uiClient'];
    const bytes = Buffer.from(`${JSON.stringify(carriers, null, 2)}\n`);
    fs.writeFileSync(carrierPath, bytes);
    const artifact = fixture.envelope.artifacts.find(
      item =>
        item.logicalPath ===
        'release/microvertical-release-identity-carriers.json',
    );
    artifact.byteLength = bytes.byteLength;
    artifact.sha256 = digest(bytes);
    reseal(fixture.envelopePath, fixture.envelope);

    assert.throws(
      () => readAndVerifyEnvelope(root, 'node'),
      new RegExp(
        `${surfaceName} carrier metadata does not exactly cover its executable release artifacts`,
      ),
    );
  }
});

test('final-envelope verification rejects prior identity carrier metadata even when all hashes are resealed', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = makeRoot(t, 'operational-independence-prior-carriers');
  const fixture = createEnvelopeFixture(root);
  const priorIdentity = createIdentity('b'.repeat(40), 'fedcba9876543210');
  const carrierPath = path.join(
    root,
    'release/microvertical-release-identity-carriers.json',
  );
  const carriers = JSON.parse(fs.readFileSync(carrierPath, 'utf8'));
  carriers.identity = priorIdentity;
  const carrierBytes = Buffer.from(`${JSON.stringify(carriers, null, 2)}\n`);
  fs.writeFileSync(carrierPath, carrierBytes);
  const envelope = JSON.parse(fs.readFileSync(fixture.envelopePath, 'utf8'));
  envelope.identity = priorIdentity;
  envelope.ui.rendererIdentity.buildId = priorIdentity.buildMarker;
  const buildArtifactPath = path.join(root, 'ultramodern-build.json');
  const buildArtifact = JSON.parse(fs.readFileSync(buildArtifactPath, 'utf8'));
  for (const marker of [
    buildArtifact.deliveryUnit,
    buildArtifact.surfaces.api,
    buildArtifact.surfaces.ui,
  ]) {
    marker.build = priorIdentity.buildMarker;
    marker.buildMarker = priorIdentity.buildMarker;
    marker.sourceRevision = priorIdentity.sourceRevision;
  }
  buildArtifact.surfaces.ui.rendererIdentity.buildId =
    priorIdentity.buildMarker;
  const buildArtifactBytes = Buffer.from(JSON.stringify(buildArtifact));
  fs.writeFileSync(buildArtifactPath, buildArtifactBytes);
  const boundBuildArtifact = envelope.artifacts.find(
    artifact => artifact.logicalPath === 'ultramodern-build.json',
  );
  boundBuildArtifact.byteLength = buildArtifactBytes.byteLength;
  boundBuildArtifact.sha256 = digest(buildArtifactBytes);
  const carrierArtifact = envelope.artifacts.find(
    artifact =>
      artifact.logicalPath ===
      'release/microvertical-release-identity-carriers.json',
  );
  carrierArtifact.byteLength = carrierBytes.byteLength;
  carrierArtifact.sha256 = digest(carrierBytes);
  reseal(fixture.envelopePath, envelope);

  assert.throws(
    () =>
      readAndVerifyEnvelope(root, 'node', {
        forbiddenIdentity: priorIdentity,
      }),
    /carrier metadata retains the prior release identity/,
  );
});

test('final-envelope verification rejects a different immutable renderer profile even when all hashes are resealed', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  for (const [component, field] of [
    ['compiler', 'version'],
    ['hydration', 'version'],
    ['router', 'version'],
    ['router', 'coreVersion'],
  ]) {
    const root = makeRoot(t, `operational-renderer-${component}-${field}`);
    const fixture = createEnvelopeFixture(root);
    const buildArtifactPath = path.join(root, 'ultramodern-build.json');
    const buildArtifact = JSON.parse(
      fs.readFileSync(buildArtifactPath, 'utf8'),
    );
    buildArtifact.surfaces.ui.rendererProfile[component][field] = '99.0.0';
    const bytes = Buffer.from(JSON.stringify(buildArtifact));
    fs.writeFileSync(buildArtifactPath, bytes);
    const boundArtifact = fixture.envelope.artifacts.find(
      artifact => artifact.logicalPath === 'ultramodern-build.json',
    );
    boundArtifact.byteLength = bytes.byteLength;
    boundArtifact.sha256 = digest(bytes);
    reseal(fixture.envelopePath, fixture.envelope);

    assert.throws(
      () => readAndVerifyEnvelope(root, 'node'),
      /renderer evidence must match/u,
      `${component}.${field} must match the promoted renderer profile`,
    );
  }
});

test('final-envelope verification requires the immutable build artifact to be bound in the release envelope', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = makeRoot(t, 'operational-renderer-unbound-artifact');
  const fixture = createEnvelopeFixture(root);
  fixture.envelope.artifacts = fixture.envelope.artifacts.filter(
    artifact => artifact.logicalPath !== 'ultramodern-build.json',
  );
  reseal(fixture.envelopePath, fixture.envelope);

  assert.throws(
    () => readAndVerifyEnvelope(root, 'node'),
    /must bind an immutable build artifact/u,
  );
});

test('final-envelope verification rejects stale artifact bytes and forged payloads', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const staleRoot = makeRoot(t, 'operational-independence-stale');
  const forgedRoot = makeRoot(t, 'operational-independence-forged');
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
    /carrier metadata does not match the release envelope identity/,
  );
});

test('final-envelope verification rejects a fresh decoy beside a stale compiled surface artifact', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  const root = makeRoot(t, 'operational-independence-mixed-surface');
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
  reseal(fixture.envelopePath, envelope);

  assert.throws(
    () => readAndVerifyEnvelope(root, 'node'),
    /uiClient carrier metadata does not exactly cover its executable release artifacts/,
  );
});

test('final-envelope verification rejects hostile symbolic-link targets and metadata', async t => {
  const { readAndVerifyEnvelope } = await loadProof();
  for (const [failure, expected] of [
    ['outside-root', /outside artifactRoot/],
    ['private-release', /private release metadata/],
    ['ancestor', /ancestor directory/],
    ['target-kind', /targetKind/],
  ]) {
    const root = makeRoot(t, `operational-independence-${failure}`);
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
          ? makeRoot(t, 'operational-independence-external')
          : failure === 'private-release'
            ? path.join(root, 'release')
            : path.join(root, 'node_modules');
      const linkTarget = path.relative(path.dirname(aliasPath), target);
      fs.symlinkSync(linkTarget, aliasPath, 'dir');
      aliasArtifact.linkTarget = linkTarget;
      aliasArtifact.targetLogicalPath =
        failure === 'private-release' ? 'release' : 'node_modules';
    }
    reseal(fixture.envelopePath, envelope);

    assert.throws(() => readAndVerifyEnvelope(root, 'node'), expected);
  }
});

function gitIn(cwd, args) {
  return require('node:child_process')
    .execFileSync(
      'git',
      [
        '-c',
        'user.name=Proof',
        '-c',
        'user.email=proof@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    .trim();
}

function writeFile(root, logicalPath, contents) {
  const filePath = path.join(root, logicalPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

test('operational proof fails when the sibling differs from its C0 build snapshot', async t => {
  const { captureOperationalBaseline, proveOperationalTarget } =
    await loadProof();
  const root = fs.realpathSync(makeRoot(t, 'operational-sibling-snapshot'));
  writeFile(
    root,
    'topology/reference-topology.json',
    JSON.stringify({
      shell: { id: 'shell', kind: 'shell', path: 'apps/shell' },
      verticals: [
        { id: 'catalog', kind: 'vertical', path: 'verticals/catalog' },
        { id: 'checkout', kind: 'vertical', path: 'verticals/checkout' },
      ],
    }),
  );
  writeFile(
    root,
    'topology/local-overlays/development.json',
    JSON.stringify({ ports: { shell: 3000, catalog: 3001, checkout: 3002 } }),
  );
  for (const [appPath, name] of [
    ['apps/shell', '@fixture/shell'],
    ['verticals/catalog', '@fixture/catalog'],
    ['verticals/checkout', '@fixture/checkout'],
  ]) {
    writeFile(root, `${appPath}/package.json`, JSON.stringify({ name }));
  }
  writeFile(root, '.gitignore', '.output/\n');
  gitIn(root, ['init', '--quiet']);
  gitIn(root, ['add', '--all']);
  gitIn(root, ['commit', '--quiet', '-m', 'C0']);
  const c0 = gitIn(root, ['rev-parse', 'HEAD']);

  const outputOf = appPath => path.join(root, appPath, '.output');
  writeFile(root, 'apps/shell/.output/index.js', 'served');
  createEnvelopeFixture(outputOf('verticals/catalog'), {
    appId: 'catalog',
    identity: createIdentity(c0, '1111111111111111'),
  });
  createEnvelopeFixture(outputOf('verticals/checkout'), {
    appId: 'checkout',
    identity: createIdentity(c0, '2222222222222222'),
  });
  const ids = { shell: 'shell', changed: 'catalog', sibling: 'checkout' };
  const baseline = captureOperationalBaseline({
    workspace: root,
    target: 'node',
    ids,
  });

  // A sibling rebuilt after the snapshot: valid envelope, different bytes.
  fs.rmSync(outputOf('verticals/checkout'), { recursive: true });
  createEnvelopeFixture(outputOf('verticals/checkout'), {
    appId: 'checkout',
    identity: createIdentity(c0, '3333333333333333'),
  });

  writeFile(root, 'verticals/catalog/api.ts', 'export const title = "C1";');
  gitIn(root, ['add', '--all']);
  gitIn(root, ['commit', '--quiet', '-m', 'C1']);
  const c1 = gitIn(root, ['rev-parse', 'HEAD']);
  gitIn(root, ['switch', '--quiet', '--detach', c0]);

  const builds = [];
  await assert.rejects(
    proveOperationalTarget({
      baseline,
      changedRef: c1,
      expectedApiValue: 'C1 API',
      expectedUiValue: 'C1 UI',
      run: (command, args) => {
        builds.push([command, ...args].join(' '));
        createEnvelopeFixture(outputOf('verticals/catalog'), {
          appId: 'catalog',
          identity: createIdentity(c1, '4444444444444444'),
        });
      },
    }),
    /node checkout final output bytes changed unexpectedly/,
  );
  assert.deepEqual(builds, ['pnpm --filter @fixture/catalog run build']);
  assert.equal(gitIn(root, ['rev-parse', 'HEAD']), c0);
});
