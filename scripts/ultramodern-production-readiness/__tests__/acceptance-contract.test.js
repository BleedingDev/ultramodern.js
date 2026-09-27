const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeEmptyReleaseAgePolicy(root) {
  const policyPath = path.join(root, 'release-age-policy.json');
  fs.writeFileSync(
    policyPath,
    JSON.stringify({
      schema: 'bleedingdev.ultramodern.release-age-exceptions',
      schemaVersion: 2,
      entries: [],
    }),
  );
  return policyPath;
}

test('acceptance topology binds app manifests and overlay without compact metadata', async t => {
  const {
    readWorkspaceAcceptanceArtifacts,
    assertTopologyAcceptance,
    assertModuleFederationAcceptance,
    assertApiAcceptance,
  } = await import('../published-create-proof/acceptance-assertions.mjs');
  const root = tempRoot('acceptance-canonical-topology-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  write('apps/shell/package.json', { name: '@fixture/shell' });
  write('verticals/inventory/package.json', { name: '@fixture/inventory' });
  write('topology/reference-topology.json', {
    shell: {
      id: 'shell',
      kind: 'shell',
      path: 'apps/shell',
      package: '@fixture/shell',
      verticalRefs: ['inventory'],
      moduleFederation: { sharedContractVersion: 'mf-v1' },
    },
    verticals: [
      {
        id: 'inventory',
        kind: 'vertical',
        path: 'verticals/inventory',
        package: '@fixture/inventory',
        moduleFederation: {
          name: 'inventoryRemote',
          manifestUrl: 'http://localhost:4101/mf-manifest.json',
          exposes: ['./Route'],
          sharedContractVersion: 'mf-v1',
        },
        api: {
          bff: { prefix: '/inventory-api' },
          readiness: { endpoint: '/inventory/readiness' },
        },
        backendFederation: {
          versionBoundary: {
            api: { readiness: '/inventory-api/inventory/readiness' },
          },
        },
      },
    ],
  });
  write('topology/local-overlays/development.json', {
    ports: { shell: 4100, inventory: 4101 },
  });
  const artifacts = readWorkspaceAcceptanceArtifacts(root);
  assert.equal(artifacts.apps[1].package, '@fixture/inventory');
  assert.equal(
    assertTopologyAcceptance(artifacts, ['inventory']).appVerticalCount,
    1,
  );
  assert.equal(
    assertModuleFederationAcceptance(artifacts, ['inventory']).remoteCount,
    1,
  );
  assert.deepEqual(
    assertApiAcceptance(artifacts, ['inventory']).readinessRoutes,
    [{ appId: 'inventory', route: '/inventory-api/inventory/readiness' }],
  );
  assert.equal(
    fs.existsSync(path.join(root, '.modernjs/ultramodern.json')),
    false,
  );
  write('verticals/inventory/package.json', { name: '@foreign/inventory' });
  assert.throws(
    () => readWorkspaceAcceptanceArtifacts(root),
    /package identity/u,
  );
});

test('workspace check requires the installed backend proof command', async t => {
  const { assertWorkspaceCheckContract } = await import(
    '../published-create-proof/acceptance-assertions.mjs'
  );
  const root = tempRoot('acceptance-installed-proof-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = {
    scripts: {
      check:
        'pnpm format:check && pnpm lint && pnpm typecheck && pnpm api:check:files && pnpm contract:check',
      'node:proof': 'ultramodern-create ultramodern backend-federation-proof',
    },
  };
  const file = path.join(root, 'package.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.equal(assertWorkspaceCheckContract(root).requiredCommands.length, 5);
  manifest.scripts['node:proof'] =
    'node scripts/proof-node-backend-federation.mjs';
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(
    () => assertWorkspaceCheckContract(root),
    /already-built live outputs/u,
  );
});

function operationalEvidence(options) {
  const baselineIdentity = {
    buildMarker: 'baseline-marker',
    releaseVersion: '0.1.0',
    sourceRevision: options.baselineRef,
    unitId: 'acceptance/inventory',
  };
  const changedIdentity = {
    ...baselineIdentity,
    buildMarker: 'changed-marker',
    sourceRevision: options.changedRef,
  };
  const unchanged = digest => ({
    byteIdentical: true,
    envelopeIdentical: true,
    treeDigest: digest,
  });
  const comparison = target => ({
    target,
    changed: {
      changed: true,
      afterIdentity: changedIdentity,
      afterTreeDigest: `${target}-changed-tree`,
      beforeIdentity: baselineIdentity,
      beforeTreeDigest: `${target}-baseline-tree`,
      surfaces: Object.fromEntries(
        ['uiClient', 'ssr', 'apiBackend', 'backendFederation'].map(s => [
          s,
          {
            afterDigest: `${target}-${s}-changed`,
            beforeDigest: `${target}-${s}-baseline`,
            changed: true,
          },
        ]),
      ),
    },
    shell: unchanged(`${target}-shell-tree`),
    sibling: unchanged(`${target}-finance-tree`),
  });
  const servedBehavior = platform => ({
    appId: options.changedId,
    baseUrls: {
      app: `http://127.0.0.1/${platform}/inventory`,
      shell: `http://127.0.0.1/${platform}/shell`,
    },
    identity: {
      build: changedIdentity.buildMarker,
      buildMarker: changedIdentity.buildMarker,
      sourceRevision: changedIdentity.sourceRevision,
      unitId: changedIdentity.unitId,
      version: changedIdentity.releaseVersion,
    },
    platform,
    result: 'pass',
    routes: { api: '/inventory-api/inventory', ssr: '/en', ui: '/en' },
    responses: {
      api: {
        bodySha256: '1'.repeat(64),
        contentType: 'application/json',
        status: 200,
        value: options.expectedApiValue,
      },
      ssr: {
        bodySha256: '2'.repeat(64),
        buildMarker: changedIdentity.buildMarker,
        contentType: 'text/html',
        status: 200,
      },
      // A hardcoded `value` here must not pass as observed UI output.
      ui: {
        bodySha256: '3'.repeat(64),
        boundaryId: 'verticalInventory',
        contentType: 'text/html',
        expose: './Widget',
        status: 200,
        value: options.expectedUiValue,
        visiblyRendered: true,
      },
    },
  });
  return {
    schemaVersion: 1,
    kind: 'ultramodern-operational-independence-proof',
    result: 'pass',
    commits: {
      baseline: options.baselineRef,
      changed: options.changedRef,
      changedPaths: [
        'verticals/inventory/api/index.ts',
        'verticals/inventory/locales/en/inventory.json',
      ],
      ownerPath: 'verticals/inventory',
    },
    apps: {
      shell: { id: options.shellId },
      changed: { id: options.changedId },
      sibling: { id: options.siblingId },
    },
    targets: {
      node: {
        comparison: comparison('node'),
        servedBehavior: servedBehavior('node'),
      },
      cloudflare: {
        comparison: comparison('cloudflare'),
        servedBehavior: servedBehavior('workerd'),
      },
    },
    crossTarget: { equal: true, identity: changedIdentity },
  };
}

// Guards a release published on fabricated runtime proof: acceptance must
// reject evidence whose served responses are absent, whose identity does not
// match the commit under test, or whose body was hardcoded instead of observed
// from the changed MicroVertical.
test('operational acceptance rejects missing, forged, and hardcoded served behavior', async () => {
  const { createOperationalIndependenceResultDetails } = await import(
    '../published-create-proof/acceptance-contract.mjs'
  );
  const baselineRevision = 'a'.repeat(40);
  const changedRevision = 'b'.repeat(40);
  const options = {
    baselineRef: baselineRevision,
    changedId: 'inventory',
    changedRef: changedRevision,
    expectedApiValue: 'Inventory C1 operational proof response',
    expectedUiValue:
      'C1 operational independence: inventory UI and localization moved together.',
    shellId: 'shell-super-app',
    siblingId: 'finance',
  };
  const create = evidence =>
    createOperationalIndependenceResultDetails({
      applicationSourceRevision: baselineRevision,
      changedRevision,
      evidence,
      evidencePath: path.resolve('/tmp/operational-evidence.json'),
      expectedApiValue: options.expectedApiValue,
      expectedChangedPaths: [
        'verticals/inventory/api/index.ts',
        'verticals/inventory/locales/en/inventory.json',
      ],
      expectedUiValue: options.expectedUiValue,
      mode: 'source',
    });

  assert.equal(
    create(operationalEvidence(options)).changedRevision,
    changedRevision,
  );

  const missing = operationalEvidence(options);
  delete missing.targets.node.servedBehavior;
  assert.throws(
    () => create(missing),
    /node served behavior is missing, degraded, skipped, or non-passing/u,
  );

  const forged = operationalEvidence(options);
  forged.targets.cloudflare.servedBehavior.identity.buildMarker = 'forged';
  assert.throws(
    () => create(forged),
    /cloudflare served behavior identity does not match the changed C1 identity/u,
  );

  const hardcoded = operationalEvidence(options);
  hardcoded.targets.node.servedBehavior.responses.ui.value =
    'hardcoded UI value';
  assert.throws(
    () => create(hardcoded),
    /node served behavior did not observe the exact C1 API and UI mutations/u,
  );
});

// Guards consumers installing a framework build whose Module Federation
// runtime can float: a range specifier must fail the release binding instead
// of shipping a host and remotes that resolve different runtimes.
test('artifact binding rejects non-exact Module Federation provenance', async () => {
  const { createReleaseArtifactBinding } = await import(
    '../published-create-proof/acceptance-contract.mjs'
  );
  const release = {
    source: { commit: 'a'.repeat(40), repository: 'BleedingDev/modern.js' },
    release: { tag: 'latest', version: '3.5.0-ultramodern.50' },
    packages: [
      {
        targetName: '@bleedingdev/modern-js-plugin-bff',
        version: '3.5.0-ultramodern.50',
        integrity: 'sha512-YWNjZXB0YW5jZQ==',
        packageJson: {
          dependencies: { '@module-federation/runtime': '^2.8.0' },
        },
      },
    ],
  };
  assert.throws(
    () => createReleaseArtifactBinding(release),
    /must use one exact Module Federation version/,
  );
});

// Guards publishing a cohort whose registry bytes are not the bytes that were
// verified: consumers would install a tarball nobody proved.
test('registry cohort verification fails closed when downloaded bytes differ', async () => {
  const { verifyRegistryCohort } = await import(
    '../published-create-proof/registry-cohort.mjs'
  );
  const root = tempRoot('acceptance-registry-cohort-');
  const pkg = {
    integrity: 'sha512-Y2FuZGlkYXRl',
    sha256: 'b'.repeat(64),
    shasum: 'c'.repeat(40),
    sourceName: '@modern-js/runtime',
    targetName: '@bleedingdev/modern-js-runtime',
    version: '3.5.0-ultramodern.50',
  };
  try {
    await assert.rejects(
      verifyRegistryCohort({
        release: { packages: [pkg] },
        registryUrl: 'https://registry.npmjs.org/',
        workDir: root,
        async runImpl(_command, args) {
          const destination = args[args.indexOf('--pack-destination') + 1];
          fs.writeFileSync(path.join(destination, 'stale.tgz'), 'stale');
          return JSON.stringify([{ filename: 'stale.tgz' }]);
        },
      }),
      /Registry tarball byte mismatch/,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

// Guards a published release whose lockfile resolves the framework cohort from
// a stale revision or a third-party registry: the consumer install would pull
// packages this release never produced.
test('cohort resolution provenance rejects stale revisions and foreign tarball origins', async () => {
  const { assertCohortResolutionProvenance } = await import(
    '../published-create-proof/acceptance-profile.mjs'
  );
  const root = tempRoot('acceptance-cohort-provenance-');
  const release = {
    packages: [
      {
        targetName: '@bleedingdev/modern-js-runtime',
        version: '3.5.0-ultramodern.50',
        integrity: 'sha512-Y2FuZGlkYXRl',
      },
    ],
    release: { version: '3.5.0-ultramodern.50' },
    sidecars: {
      packages: [
        {
          name: '@bleedingdev/mf-bridge-react',
          version: '1.0.0',
          integrity: 'sha512-c2lkZWNhcg==',
        },
      ],
    },
    targetScope: 'bleedingdev',
  };
  const registryUrl = 'http://127.0.0.1:4879/';
  const writeLock = packages =>
    fs.writeFileSync(
      path.join(root, 'pnpm-lock.yaml'),
      JSON.stringify({ lockfileVersion: '9.0', packages }),
    );
  const parseJsonLock = filePath =>
    JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const provenance = () =>
    assertCohortResolutionProvenance(root, release, registryUrl, parseJsonLock);
  try {
    writeLock({
      '@bleedingdev/modern-js-runtime@3.5.0-ultramodern.49': {
        resolution: { integrity: 'sha512-Y2FuZGlkYXRl' },
      },
    });
    assert.throws(provenance, /is not the release revision/);

    writeLock({
      '@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50': {
        resolution: {
          integrity: 'sha512-Y2FuZGlkYXRl',
          tarball: 'https://registry.evil.test/runtime.tgz',
        },
      },
    });
    assert.throws(provenance, /is not the release registry/);

    writeLock({
      '@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50': {
        resolution: { integrity: 'sha512-Y2FuZGlkYXRl' },
      },
      '@bleedingdev/mf-bridge-react@1.0.0': {
        resolution: { integrity: 'sha512-c2lkZWNhcg==' },
      },
    });
    assert.equal(provenance().cohortPackageCount, 1);
    writeLock({
      '@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50': {
        resolution: { integrity: 'sha512-Y2FuZGlkYXRl' },
      },
      '@bleedingdev/mf-bridge-react@1.0.1': {
        resolution: { integrity: 'sha512-c2lkZWNhcg==' },
      },
    });
    assert.throws(
      provenance,
      /Sidecar package .* is not the release revision/u,
    );
    writeLock({
      '@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50': {
        resolution: { integrity: 'sha512-Y2FuZGlkYXRl' },
      },
      '@bleedingdev/unknown@1.0.0': {
        resolution: { integrity: 'sha512-c2lkZWNhcg==' },
      },
    });
    assert.throws(provenance, /outside the authenticated cohort and sidecars/u);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

// Guards shipping a dependency younger than the release-age gate with no live
// human approval: an expired exception must block the publish.
test('release-age audit rejects a fresh dependency whose approval has expired', async () => {
  const { auditReleaseAgePolicy } = await import(
    '../published-create-proof/release-age-audit.mjs'
  );
  const root = tempRoot('release-age-policy-');
  const external = {
    name: '@effect/tsgo',
    version: '0.36.2',
    integrity: 'sha512-ZXh0ZXJuYWw=',
    publishedAt: '2026-09-10T00:30:00.000Z',
  };
  const firstParty = {
    name: '@bleedingdev/modern-js-ultramodern-create',
    version: '3.5.0-ultramodern.103',
    integrity: 'sha512-Zmlyc3QtcGFydHk=',
    publishedAt: '2026-08-10T08:00:00.000Z',
  };
  const locator = item => `${item.name}@${item.version}`;
  const closure = [external, firstParty];
  const policyPath = path.join(root, 'release-age-policy.json');
  const writeJson = (name, value) =>
    fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  writeJson('pnpm-workspace.yaml', {
    minimumReleaseAge: 1440,
    minimumReleaseAgeExclude: [locator(firstParty)],
    minimumReleaseAgeIgnoreMissingTime: false,
    minimumReleaseAgeStrict: true,
    trustPolicy: 'no-downgrade',
    trustPolicyIgnoreAfter: 1440,
  });
  writeJson('pnpm-lock.yaml', {
    lockfileVersion: '9.0',
    importers: {
      '.': {
        dependencies: Object.fromEntries(
          closure.map(item => [
            item.name,
            { specifier: item.version, version: item.version },
          ]),
        ),
      },
    },
    packages: Object.fromEntries(
      closure.map(item => [
        locator(item),
        { resolution: { integrity: item.integrity } },
      ]),
    ),
    snapshots: Object.fromEntries(closure.map(item => [locator(item), {}])),
  });
  writeJson('release-age-policy.json', {
    schema: 'bleedingdev.ultramodern.release-age-exceptions',
    schemaVersion: 2,
    entries: [
      {
        approvedBy: 'Release reviewer <reviewer@example.test>',
        evidence: {
          sha256: 'a'.repeat(64),
          uri: `urn:sha256:${'a'.repeat(64)}`,
        },
        // Reviewed, but the exception lapsed before this publish.
        expiresAt: '2026-09-09T23:59:59.000Z',
        integrity: external.integrity,
        package: external.name,
        reviewedAt: '2026-08-10T14:36:54.394Z',
        version: external.version,
      },
    ],
  });
  const registry = new Map(closure.map(item => [item.name, item]));
  try {
    await assert.rejects(
      auditReleaseAgePolicy({
        commandExclusions: [locator(firstParty)],
        fetchImpl: async url => {
          const item = registry.get(
            decodeURIComponent(new URL(url).pathname.slice(1)),
          );
          return new Response(
            JSON.stringify({
              time: { [item.version]: item.publishedAt },
              versions: {
                [item.version]: { dist: { integrity: item.integrity } },
              },
            }),
            { status: 200 },
          );
        },
        now: new Date('2026-09-10T01:00:00.000Z'),
        parseYamlImpl: JSON.parse,
        policyPath,
        projectDir: root,
        registryUrl: 'https://registry.example.test/',
        release: {
          cohortDigest: 'b'.repeat(64),
          manifestSha256: 'c'.repeat(64),
          release: { version: firstParty.version },
          packages: [
            {
              integrity: firstParty.integrity,
              sourceName: '@modern-js/ultramodern-create',
              targetName: firstParty.name,
              version: firstParty.version,
            },
          ],
          source: {
            commit: 'd'.repeat(40),
            repository: 'BleedingDev/ultramodern.js',
          },
        },
        verifyYamlTool: false,
      }),
      // Names the package, its publish time and the wait until it matures.
      /@effect\/tsgo@0\.36\.2 published 2026-09-10T00:30:00\.000Z, mature at 2026-09-11T00:30:00\.000Z \(wait 23\.5h\)/u,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

for (const { mode, registryUrl } of [
  { mode: 'source', registryUrl: 'http://127.0.0.1:4873/' },
  { mode: 'published', registryUrl: 'https://registry.npmjs.org/' },
]) {
  test(`${mode} release-age audit binds fresh sidecars to verified manifest integrity`, async t => {
    const { auditReleaseAgePolicy, releaseAgeExemptions } = await import(
      '../published-create-proof/release-age-audit.mjs'
    );
    const root = tempRoot(`release-age-${mode}-sidecar-`);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const version = '3.9.0-ultramodern.13';
    const firstParty = {
      targetName: '@bleedingdev/modern-js-runtime',
      sourceName: '@modern-js/runtime',
      version,
      integrity: 'sha512-Zmlyc3QtcGFydHk=',
    };
    const sidecar = {
      name: '@bleedingdev/mf-bridge-react',
      version: '1.0.0',
      integrity: 'sha512-c2lkZWNhcg==',
    };
    const release = {
      cohortDigest: 'a'.repeat(64),
      manifestSha256: 'b'.repeat(64),
      packages: [firstParty],
      release: { version },
      sidecars: { packages: [sidecar] },
      source: {
        commit: 'c'.repeat(40),
        repository: 'BleedingDev/ultramodern.js',
      },
      targetScope: 'bleedingdev',
    };
    fs.writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      JSON.stringify({
        minimumReleaseAge: 1440,
        minimumReleaseAgeExclude: [`${firstParty.targetName}@${version}`],
        minimumReleaseAgeIgnoreMissingTime: false,
        minimumReleaseAgeStrict: true,
        trustPolicy: 'no-downgrade',
        trustPolicyIgnoreAfter: 1440,
      }),
    );
    const policyPath = writeEmptyReleaseAgePolicy(root);
    const sidecarKey = `${sidecar.name}@${sidecar.version}`;
    fs.writeFileSync(
      path.join(root, 'pnpm-lock.yaml'),
      JSON.stringify({
        lockfileVersion: '9.0',
        importers: {
          '.': {
            dependencies: {
              [sidecar.name]: {
                specifier: sidecar.version,
                version: sidecar.version,
              },
            },
          },
        },
        packages: {
          [sidecarKey]: { resolution: { integrity: sidecar.integrity } },
        },
        snapshots: { [sidecarKey]: {} },
      }),
    );
    const urls = [];
    const fetchImpl = async url => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({
          time: { [sidecar.version]: '2026-09-23T07:41:30.000Z' },
          versions: {
            [sidecar.version]: { dist: { integrity: 'sha512-c2lkZWNhcg==' } },
          },
        }),
        { status: 200 },
      );
    };
    const options = {
      commandExclusions: releaseAgeExemptions(release, {
        policyPath,
        now: new Date('2026-09-23T08:00:00.000Z'),
      }),
      fetchImpl,
      now: new Date('2026-09-23T08:00:00.000Z'),
      parseYamlImpl: JSON.parse,
      policyPath,
      projectDir: root,
      registryUrl,
      release,
      verifyYamlTool: false,
    };
    const audit = await auditReleaseAgePolicy(options);
    assert.equal(
      audit.approvals.find(item => item.package === sidecar.name)?.authority,
      'strict-release-manifest-sidecar',
    );
    assert.ok(
      urls.some(
        url => url.startsWith(registryUrl) && url.includes('mf-bridge-react'),
      ),
    );
    sidecar.integrity = 'sha512-Zm9yZ2Vk';
    await assert.rejects(
      auditReleaseAgePolicy(options),
      /registry integrity differs from authenticated release manifest/u,
    );
  });
}

// Replays the 3.9.0-ultramodern.13 edge (publish run 36137116871): the
// release reused sidecars published under 24h earlier. The source lane
// exempted them and passed; both published lanes did not and failed with
// ERR_PNPM_NO_MATURE_MATCHING_VERSION after the cohort was already public.
test('a lane that drops the fresh .13 sidecars fails the audit before install, naming them', async t => {
  const { auditReleaseAgePolicy, releaseAgeExemptions } = await import(
    '../published-create-proof/release-age-audit.mjs'
  );
  const root = tempRoot('release-age-13-replay-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = '3.9.0-ultramodern.13';
  const sidecars = [
    ['@bleedingdev/effect', '4.0.0-rc.117', '2026-09-25T11:12:17.532Z'],
    ['@bleedingdev/mf-bridge-react', '2.9.1', '2026-09-25T11:28:45.731Z'],
    ['@bleedingdev/mf-enhanced', '2.9.1', '2026-09-25T12:19:54.880Z'],
    ['@bleedingdev/mf-modern-js-v3', '2.9.1', '2026-09-25T12:37:57.875Z'],
    ['@bleedingdev/mf-node', '2.7.51', '2026-09-25T12:27:16.233Z'],
  ].map(([name, sidecarVersion, publishedAt], index) => ({
    name,
    version: sidecarVersion,
    publishedAt,
    integrity: `sha512-${Buffer.from(`sidecar-${index}`).toString('base64')}`,
  }));
  const release = {
    cohortDigest: 'a'.repeat(64),
    manifestSha256: 'b'.repeat(64),
    packages: [
      {
        targetName: '@bleedingdev/modern-js-runtime',
        sourceName: '@modern-js/runtime',
        version,
        integrity: 'sha512-Zmlyc3QtcGFydHk=',
      },
    ],
    release: { version },
    sidecars: {
      packages: sidecars.map(({ name, version: v, integrity }) => ({
        name,
        version: v,
        integrity,
      })),
    },
    source: {
      commit: 'c'.repeat(40),
      repository: 'BleedingDev/ultramodern.js',
    },
    targetScope: 'bleedingdev',
  };
  const key = item => `${item.name}@${item.version}`;
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    JSON.stringify({
      minimumReleaseAge: 1440,
      minimumReleaseAgeExclude: [`@bleedingdev/modern-js-runtime@${version}`],
      minimumReleaseAgeIgnoreMissingTime: false,
      minimumReleaseAgeStrict: true,
      trustPolicy: 'no-downgrade',
      trustPolicyIgnoreAfter: 1440,
    }),
  );
  fs.writeFileSync(
    path.join(root, 'pnpm-lock.yaml'),
    JSON.stringify({
      lockfileVersion: '9.0',
      importers: {
        '.': {
          dependencies: Object.fromEntries(
            sidecars.map(item => [
              item.name,
              { specifier: item.version, version: item.version },
            ]),
          ),
        },
      },
      packages: Object.fromEntries(
        sidecars.map(item => [
          key(item),
          { resolution: { integrity: item.integrity } },
        ]),
      ),
      snapshots: Object.fromEntries(sidecars.map(item => [key(item), {}])),
    }),
  );
  const byName = new Map(sidecars.map(item => [item.name, item]));
  const policyPath = writeEmptyReleaseAgePolicy(root);
  // The moment published ERP-10 acceptance resolved the cohort.
  const now = new Date('2026-09-25T13:23:48.867Z');
  const options = {
    fetchImpl: async url => {
      const item = byName.get(
        decodeURIComponent(new URL(url).pathname.slice(1)),
      );
      return new Response(
        JSON.stringify({
          time: { [item.version]: item.publishedAt },
          versions: { [item.version]: { dist: { integrity: item.integrity } } },
        }),
        { status: 200 },
      );
    },
    now,
    parseYamlImpl: JSON.parse,
    policyPath,
    projectDir: root,
    registryUrl: 'https://registry.npmjs.org/',
    release,
    verifyYamlTool: false,
  };
  const exemptions = releaseAgeExemptions(release, { policyPath, now });
  const audit = await auditReleaseAgePolicy({
    ...options,
    commandExclusions: exemptions,
  });
  assert.equal(audit.approvals.length, sidecars.length);

  const cohortOnly = exemptions.filter(selector =>
    selector.startsWith('@bleedingdev/modern-js-'),
  );
  await assert.rejects(
    auditReleaseAgePolicy({ ...options, commandExclusions: cohortOnly }),
    error =>
      error.message.includes('every lane must pass that exact set') &&
      sidecars.every(item => error.message.includes(key(item))),
  );
});

// A workspace created on the day its cohort is published can only install if
// ultramodern-create exempts exactly that cohort; a missing list is the
// pre-fix generator and a wider list would silently weaken the 24h gate.
test('release-age audit requires the generated workspace to exempt exactly its cohort', async t => {
  const { auditReleaseAgePolicy } = await import(
    '../published-create-proof/release-age-audit.mjs'
  );
  const root = tempRoot('release-age-cohort-exclude-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = '3.9.0-ultramodern.17';
  const release = {
    packages: ['runtime', 'app-tools'].map(name => ({
      sourceName: `@modern-js/${name}`,
      targetName: `@bleedingdev/modern-js-${name}`,
      version,
    })),
    release: { version },
    targetScope: 'bleedingdev',
  };
  const audit = minimumReleaseAgeExclude => {
    fs.writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      JSON.stringify({
        minimumReleaseAge: 1440,
        minimumReleaseAgeExclude,
        minimumReleaseAgeIgnoreMissingTime: false,
        minimumReleaseAgeStrict: true,
        trustPolicy: 'no-downgrade',
        trustPolicyIgnoreAfter: 1440,
      }),
    );
    return auditReleaseAgePolicy({
      commandExclusions: [],
      parseYamlImpl: JSON.parse,
      projectDir: root,
      registryUrl: 'https://registry.npmjs.org/',
      release,
      verifyYamlTool: false,
    });
  };
  const cohort = [
    `@bleedingdev/modern-js-app-tools@${version}`,
    `@bleedingdev/modern-js-runtime@${version}`,
  ];
  for (const persisted of [
    undefined,
    cohort.slice(1),
    [...cohort, '@bleedingdev/mf-runtime@2.9.1'],
  ]) {
    await assert.rejects(
      audit(persisted),
      /minimumReleaseAgeExclude must list exactly the release cohort/u,
    );
  }
  // The exact cohort passes the workspace check and reaches the lockfile.
  await assert.rejects(audit(cohort), /Generated pnpm lockfile/u);
});
