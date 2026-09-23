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
function createEnvelopeFixture(root) {
  const identity = createIdentity('a'.repeat(40), '0123456789abcdef');
  const runtimes = {
    'public/client.js': 'browser',
    'server/ssr.js': 'nodejs',
    'api/index.js': 'nodejs',
    'backend-mf-manifest.json': 'module-federation-manifest',
    'backendRemoteEntry.cjs': 'nodejs',
    'node_modules/@bleedingdev/runtime/package.json': 'nodejs-deployment',
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
  };
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
    schemaVersion: 3,
    kind: 'ultramodern-target-microvertical-release-envelope',
    target: 'node',
    identity,
    artifacts,
    surfaces: {
      uiClient: ['public/client.js'],
      ssr: ['server/ssr.js'],
      apiBackend: ['api/index.js'],
      backendFederation: {
        manifest: 'backend-mf-manifest.json',
        container: 'backendRemoteEntry.cjs',
      },
    },
  };
  const envelopePath = path.join(
    root,
    'release/microvertical-release-envelope.json',
  );
  reseal(envelopePath, envelope);
  return { envelope, envelopePath, identity };
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
