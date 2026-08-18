const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

async function loadContract() {
  return import('../published-create-proof/acceptance-contract.mjs');
}

async function loadAcceptanceAssertions() {
  return import('../published-create-proof/acceptance-assertions.mjs');
}

function releaseFixture() {
  const version = '3.5.0-ultramodern.50';
  return {
    source: {
      commit: 'a'.repeat(40),
      repository: 'BleedingDev/modern.js',
    },
    release: { tag: 'latest', version },
    packages: [
      {
        targetName: '@bleedingdev/modern-js-plugin-bff',
        version,
        integrity: 'sha512-YWNjZXB0YW5jZQ==',
        packageJson: {
          dependencies: {
            '@module-federation/runtime': '2.8.0',
          },
        },
      },
    ],
  };
}

function profileFixture() {
  const verticals = Array.from(
    { length: 10 },
    (_, index) => `vertical-${index + 1}`,
  );
  return {
    createPackage: undefined,
    deployCloudflare: false,
    projectName: 'acceptance',
    scaleProfile: 'erp-10',
    selectedProfile: { id: 'erp-10', verticalCount: 10 },
    verticalCount: 10,
    verticals,
  };
}

function runtimeReport({
  applicationSourceRevision = 'b'.repeat(40),
  artifactBinding,
  mode = 'source',
  platform = 'node',
  release,
  verticals,
}) {
  const evidence = Object.fromEntries(
    [
      'ssr',
      'browser-mf',
      'api',
      'backend',
      'backend-driven-ui',
      'failure-isolation',
      'release-identity',
    ].map(dimension => [
      dimension,
      {
        artifactMode: mode,
        assertions: [{ status: 'pass', type: dimension }],
        platform,
        status: 'pass',
        verticalIds: [...verticals],
      },
    ]),
  );
  evidence['release-identity'].apps = verticals.map(appId => {
    const identity = {
      buildMarker: `marker-${appId}`,
      moduleFederation: artifactBinding.moduleFederation,
      releaseVersion: '0.1.0',
      sourceRevision: applicationSourceRevision,
    };
    return {
      appId,
      surfaces: {
        api: { ...identity },
        backend: { ...identity },
        frontend: { ...identity },
        ssr: { ...identity },
      },
    };
  });
  return {
    artifactMode: mode,
    evidence,
    platform,
    results: [],
    shellRuntime: platform,
    skipped: [],
    status: 'pass',
    targetRuntimes: Object.fromEntries(
      verticals.map(appId => [appId, platform]),
    ),
  };
}

test('browser smoke executes the final Node deployment entry with its bound environment', async t => {
  const { startServer } = await import('../browser-smoke/bootstrap.mjs');
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'acceptance-node-output-'),
  );
  const outputDirectory = path.join(root, 'apps/shell/.output');
  const artifactDirectory = path.join(root, 'artifacts');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, 'index.js'),
    `const http = require('node:http');
http.createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({
    cwd: process.cwd(),
    marker: process.env.ACCEPTANCE_MARKER,
    port: process.env.PORT,
  }));
}).listen(Number(process.env.PORT), '127.0.0.1');
`,
  );

  const port = await new Promise((resolve, reject) => {
    const server = require('node:net').createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => {
        if (error) {
          reject(error);
        } else {
          resolve(address.port);
        }
      });
    });
  });
  const target = {
    app: { id: 'shell', path: 'apps/shell' },
    baseUrl: `http://127.0.0.1:${port}`,
    port,
  };
  const server = startServer(target, {
    artifactDir: artifactDirectory,
    processEnv: { ACCEPTANCE_MARKER: 'final-node-output' },
    projectDir: root,
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(root, { force: true, recursive: true });
  });

  let response;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      response = await fetch(target.baseUrl);
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    cwd: fs.realpathSync(outputDirectory),
    marker: 'final-node-output',
    port: String(port),
  });
});

test('the immutable ERP contract independently requires every Node and workerd runtime dimension', async () => {
  const {
    requiredAcceptanceResultIds,
    requiredAcceptanceResultIdsForMode,
    runtimeAcceptanceDimensions,
    runtimeAcceptancePlatforms,
  } = await loadContract();

  assert.equal(requiredAcceptanceResultIds.includes('browser-runtime'), false);
  for (const platform of runtimeAcceptancePlatforms) {
    for (const dimension of runtimeAcceptanceDimensions) {
      assert.equal(
        requiredAcceptanceResultIds.includes(`${platform}-${dimension}`),
        true,
      );
    }
  }
  assert.equal(
    requiredAcceptanceResultIds.at(-1),
    'operational-independence',
    'operational independence must run only after the complete runtime matrix',
  );
  assert.deepEqual(
    [...requiredAcceptanceResultIdsForMode('source')],
    [...requiredAcceptanceResultIds],
    'source lane must require the full contract including operational independence',
  );
  assert.deepEqual(
    [...requiredAcceptanceResultIdsForMode('published')],
    requiredAcceptanceResultIds.slice(0, -1),
    'published lane must require the full contract except source-only operational independence',
  );
  assert.throws(
    () => requiredAcceptanceResultIdsForMode('canary'),
    /Unknown acceptance mode/u,
  );
});

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    stdio: options.stdio === 'inherit' ? 'ignore' : 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout?.trim() ?? '';
}

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
  const comparison = target => ({
    target,
    changed: {
      changed: true,
      afterIdentity: changedIdentity,
      afterTreeDigest: `${target}-changed-tree`,
      beforeIdentity: baselineIdentity,
      beforeTreeDigest: `${target}-baseline-tree`,
      surfaces: Object.fromEntries(
        ['uiClient', 'ssr', 'apiBackend', 'backendFederation'].map(surface => [
          surface,
          {
            afterDigest: `${target}-${surface}-changed`,
            beforeDigest: `${target}-${surface}-baseline`,
            changed: true,
          },
        ]),
      ),
    },
    shell: {
      byteIdentical: true,
      envelopeIdentical: true,
      treeDigest: `${target}-shell-tree`,
    },
    sibling: {
      byteIdentical: true,
      envelopeIdentical: true,
      treeDigest: `${target}-finance-tree`,
    },
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
    routes: {
      api: '/inventory-api/inventory',
      ssr: '/en',
      ui: '/en',
    },
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
    evidenceDigest: 'e'.repeat(64),
  };
}

test('shared source and published profiles commit only inventory, execute its C1 API, and invoke the same post-runtime proof', async t => {
  const { runOperationalIndependenceAcceptance } = await import(
    '../published-create-proof/acceptance-profile.mjs'
  );

  for (const mode of ['source', 'published']) {
    await t.test(mode, async () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), `operational-profile-${mode}-`),
      );
      try {
        const localePath = path.join(
          root,
          'verticals/inventory/locales/en/inventory.json',
        );
        const apiPath = path.join(root, 'verticals/inventory/api/index.ts');
        fs.mkdirSync(path.dirname(localePath), { recursive: true });
        fs.mkdirSync(path.dirname(apiPath), { recursive: true });
        fs.writeFileSync(
          localePath,
          `${JSON.stringify({
            inventory: {
              widgetBody: 'Owns a vertical route surface.',
            },
          })}\n`,
        );
        fs.writeFileSync(
          apiPath,
          `export const inventoryItems = [
  {
    title /* generator formatting is not an acceptance contract */:
      'Wire a real inventory source here',
    marker: 'generated-inventory',
    id: 'starter-inventory',
  },
];

export function listInventory() {
  return inventoryItems;
}
`,
        );
        runCommand('git', ['init', '--quiet'], { cwd: root });
        runCommand('git', ['config', 'user.name', 'Acceptance Test'], {
          cwd: root,
        });
        runCommand('git', ['config', 'user.email', 'acceptance@example.test'], {
          cwd: root,
        });
        runCommand('git', ['add', '-A'], { cwd: root });
        runCommand(
          'git',
          [
            '-c',
            'commit.gpgsign=false',
            '-c',
            'core.hooksPath=/dev/null',
            'commit',
            '--quiet',
            '--no-verify',
            '-m',
            'baseline',
          ],
          { cwd: root },
        );
        const baseline = runCommand('git', ['rev-parse', 'HEAD'], {
          cwd: root,
        });
        const calls = [];
        const runImpl = (command, args, options = {}) => {
          calls.push([command, [...args]]);
          return runCommand(command, args, options);
        };
        let invocation;
        const runOperationalIndependenceImpl = async options => {
          invocation = options;
          assert.equal(
            runCommand('git', ['rev-parse', 'HEAD'], { cwd: root }),
            options.changedRef,
            'the runner must be invoked only after C1 is committed',
          );
          assert.equal(
            runCommand(
              'git',
              ['status', '--porcelain=v1', '--untracked-files=all'],
              { cwd: root },
            ),
            '',
          );
          const api = await import(
            `${pathToFileURL(apiPath).href}?revision=${options.changedRef}`
          );
          assert.equal(
            api.listInventory()[0].title,
            options.expectedApiValue,
            'C1 must execute the changed inventory API response',
          );
          const evidence = operationalEvidence(options);
          fs.writeFileSync(options.out, `${JSON.stringify(evidence)}\n`);
          return evidence;
        };
        const outPath = path.join(root, '..', `${mode}-receipt.json`);
        const details = await runOperationalIndependenceAcceptance({
          applicationSourceRevision: baseline,
          ephemeralWorkDir: root,
          mode,
          outPath,
          packageManagerEnv: {
            PATH: process.env.PATH,
            npm_config_registry: 'http://registry.example.test',
          },
          projectDir: root,
          runImpl,
          runOperationalIndependenceImpl,
        });

        assert.deepEqual(invocation, {
          baselineRef: baseline,
          changedId: 'inventory',
          changedRef: details.changedRevision,
          expectedApiValue: details.mutations.apiResponse.value,
          expectedUiValue: details.mutations.uiLocalization.value,
          out: path.join(
            root,
            '..',
            `${mode}-receipt.operational-independence.json`,
          ),
          packageManagerEnv: {
            PATH: process.env.PATH,
            npm_config_registry: 'http://registry.example.test',
          },
          shellId: 'shell-super-app',
          siblingId: 'finance',
          workspace: root,
        });
        assert.equal(details.artifactMode, mode);
        assert.deepEqual(details.changedPaths, [
          'verticals/inventory/api/index.ts',
          'verticals/inventory/locales/en/inventory.json',
        ]);
        assert.equal(
          JSON.parse(fs.readFileSync(localePath, 'utf8')).inventory.widgetBody,
          details.mutations.uiLocalization.value,
        );
        assert.equal(
          runCommand('git', ['rev-parse', 'HEAD^'], { cwd: root }),
          baseline,
        );
        const commitCall = calls.find(
          ([command, args]) =>
            command === 'git' &&
            args.join(' ').includes('rotate inventory operational identity'),
        );
        assert.ok(commitCall);
        assert.equal(commitCall[1].includes('core.hooksPath=/dev/null'), true);
        assert.equal(commitCall[1].includes('commit.gpgsign=false'), true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(
          path.join(
            root,
            '..',
            `${mode}-receipt.operational-independence.json`,
          ),
          { force: true },
        );
      }
    });
  }
});

test('operational acceptance rejects missing, forged, and hardcoded served behavior', async () => {
  const { createOperationalIndependenceResultDetails } = await loadContract();
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
      evidenceFileSha256: 'f'.repeat(64),
      evidencePath: path.resolve('/tmp/operational-evidence.json'),
      expectedApiValue: options.expectedApiValue,
      expectedChangedPaths: [
        'verticals/inventory/api/index.ts',
        'verticals/inventory/locales/en/inventory.json',
      ],
      expectedUiValue: options.expectedUiValue,
      mode: 'source',
    });

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

test('source packs and published npm cohorts use the same runtime matrix contract with honest artifact mode', async () => {
  const { runtimeAcceptanceInvocation } = await loadContract();

  assert.deepEqual(runtimeAcceptanceInvocation('source', 'node'), {
    artifactMode: 'source',
    matrixId: 'node-full-stack',
    mode: 'source',
    platform: 'node',
    shellRuntime: 'node',
  });
  assert.deepEqual(runtimeAcceptanceInvocation('published', 'workerd'), {
    artifactMode: 'published',
    matrixId: 'workerd-full-stack',
    mode: 'published',
    platform: 'workerd',
    shellRuntime: 'workerd',
  });
});

test('the static workspace check excludes live Node proof while runtime acceptance keeps a read-only proof command', async () => {
  const { assertWorkspaceCheckContract, readWorkspaceAcceptanceArtifacts } =
    await loadAcceptanceAssertions();
  const projectDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-check-contract-'),
  );
  const staticCheck =
    'pnpm format:check && pnpm lint && pnpm typecheck && pnpm api:check && pnpm contract:check';

  try {
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        scripts: {
          check: staticCheck,
          'node:proof': 'node ./scripts/proof-node-backend-federation.mts',
        },
      }),
    );
    assert.equal(assertWorkspaceCheckContract(projectDir).command, staticCheck);
    fs.mkdirSync(path.join(projectDir, 'topology'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.modernjs'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'topology/reference-topology.json'),
      JSON.stringify({ verticals: [] }),
    );
    fs.writeFileSync(
      path.join(projectDir, '.modernjs/ultramodern.json'),
      JSON.stringify({ topology: { apps: [] } }),
    );
    const artifacts = readWorkspaceAcceptanceArtifacts(projectDir);
    assert.equal(artifacts.projectDir, projectDir);
    assert.equal(Object.hasOwn(artifacts, 'backendProof'), false);

    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        scripts: {
          check: `${staticCheck} && pnpm node:proof`,
          'node:proof':
            'pnpm node:backend-federation:generate && node ./scripts/proof-node-backend-federation.mts',
        },
      }),
    );
    assert.throws(
      () => assertWorkspaceCheckContract(projectDir),
      /static gate|without regenerating/u,
    );
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('the ERP profile fails closed on reduced vertical or deploy variants', async () => {
  const { assertReleaseAcceptanceProfile } = await loadContract();
  const profile = profileFixture();

  assert.equal(assertReleaseAcceptanceProfile(profile), profile);
  assert.throws(
    () =>
      assertReleaseAcceptanceProfile({
        ...profile,
        verticals: profile.verticals.slice(0, 9),
      }),
    /exactly 10 verticals/,
  );
  assert.throws(
    () =>
      assertReleaseAcceptanceProfile({
        ...profile,
        deployCloudflare: true,
      }),
    /deployment is outside/,
  );
});

test('runtime dimensions reject missing, skipped, and artifact-mode-mismatched evidence', async () => {
  const { assertRuntimeAcceptanceDimension, createReleaseArtifactBinding } =
    await loadContract();
  const release = releaseFixture();
  const verticals = profileFixture().verticals;
  const artifactBinding = createReleaseArtifactBinding(release);
  const report = runtimeReport({ artifactBinding, release, verticals });
  const options = {
    artifactBinding,
    dimension: 'api',
    mode: 'source',
    platform: 'node',
    release,
    verticals,
  };

  assert.equal(
    assertRuntimeAcceptanceDimension(report, options).dimension,
    'api',
  );
  report.targetRuntimes[verticals[0]] = 'workerd';
  assert.throws(
    () => assertRuntimeAcceptanceDimension(report, options),
    /targetRuntimes must prove every ERP-10 MicroVertical ran on node/,
  );
  report.targetRuntimes[verticals[0]] = 'node';
  delete report.evidence.api;
  assert.throws(
    () => assertRuntimeAcceptanceDimension(report, options),
    /api evidence is missing/,
  );
  report.evidence.api = {
    artifactMode: 'source',
    assertions: [{ status: 'pass' }],
    platform: 'node',
    status: 'skipped',
    verticalIds: [...verticals],
  };
  assert.throws(
    () => assertRuntimeAcceptanceDimension(report, options),
    /status must be pass/,
  );
  report.evidence.api.status = 'pass';
  report.artifactMode = 'published';
  assert.throws(
    () => assertRuntimeAcceptanceDimension(report, options),
    /artifactMode must be source/,
  );
});

test('release identity requires one atomic frontend, SSR, API, and backend identity per MicroVertical', async () => {
  const { assertRuntimeAcceptanceDimension, createReleaseArtifactBinding } =
    await loadContract();
  const release = releaseFixture();
  const verticals = profileFixture().verticals;
  const artifactBinding = createReleaseArtifactBinding(release);
  const report = runtimeReport({ artifactBinding, release, verticals });
  const options = {
    artifactBinding,
    dimension: 'release-identity',
    mode: 'source',
    platform: 'node',
    release,
    verticals,
  };

  assert.equal(
    assertRuntimeAcceptanceDimension(report, options).apps.length,
    verticals.length,
  );
  assert.notEqual(
    report.evidence['release-identity'].apps[0].surfaces.api.sourceRevision,
    release.source.commit,
    'application source identity must not masquerade as framework package provenance',
  );
  report.evidence['release-identity'].apps[0].surfaces.api.buildMarker =
    'stale-api';
  assert.throws(
    () => assertRuntimeAcceptanceDimension(report, options),
    /do not share one atomic release identity/,
  );
});

test('release identity binds the generated application snapshot independently from framework provenance', async () => {
  const { assertRuntimeAcceptanceDimension, createReleaseArtifactBinding } =
    await loadContract();
  const release = releaseFixture();
  const verticals = profileFixture().verticals;
  const artifactBinding = createReleaseArtifactBinding(release);
  const applicationSourceRevision = 'b'.repeat(40);
  const report = runtimeReport({
    applicationSourceRevision,
    artifactBinding,
    release,
    verticals,
  });
  const options = {
    applicationSourceRevision,
    artifactBinding,
    dimension: 'release-identity',
    mode: 'source',
    platform: 'node',
    release,
    verticals,
  };

  assert.equal(
    assertRuntimeAcceptanceDimension(report, options).apps[0].sourceRevision,
    applicationSourceRevision,
  );
  report.evidence['release-identity'].apps[0].surfaces.frontend.sourceRevision =
    release.source.commit;
  assert.throws(
    () => assertRuntimeAcceptanceDimension(report, options),
    /application sourceRevision must be/,
  );
});

test('runtime identity binds each MicroVertical delivery version across Node and workerd independently of framework version', async () => {
  const {
    assertRuntimeAcceptanceDimension,
    createReleaseArtifactBinding,
    runtimeIdentityBinding,
  } = await loadContract();
  const release = releaseFixture();
  const verticals = profileFixture().verticals;
  const artifactBinding = createReleaseArtifactBinding(release);
  const node = assertRuntimeAcceptanceDimension(
    runtimeReport({ artifactBinding, release, verticals }),
    {
      artifactBinding,
      dimension: 'release-identity',
      mode: 'source',
      platform: 'node',
      release,
      verticals,
    },
  );
  const workerd = structuredClone(node);

  assert.equal(
    runtimeIdentityBinding(node, workerd).node[0].releaseVersion,
    '0.1.0',
  );
  workerd.apps[0].releaseVersion = '0.2.0';
  assert.throws(
    () => runtimeIdentityBinding(node, workerd),
    /Node and workerd release identities differ/,
  );
});

test('artifact binding rejects unavailable or non-exact Module Federation provenance', async () => {
  const { createReleaseArtifactBinding } = await loadContract();
  const release = releaseFixture();
  const binding = createReleaseArtifactBinding(release);

  assert.deepEqual(binding.packages, [
    {
      integrity: 'sha512-YWNjZXB0YW5jZQ==',
      targetName: '@bleedingdev/modern-js-plugin-bff',
      version: release.release.version,
    },
  ]);
  assert.deepEqual(binding.moduleFederation, [
    {
      packageName: '@module-federation/runtime',
      version: '2.8.0',
    },
  ]);

  release.packages[0].packageJson.dependencies['@module-federation/runtime'] =
    '^2.8.0';
  assert.throws(
    () => createReleaseArtifactBinding(release),
    /must use one exact Module Federation version/,
  );
});

test('exact registry cohort verification fails closed on unavailable or stale package bytes', async () => {
  const { verifyRegistryCohort } = await import(
    '../published-create-proof/registry-cohort.mjs'
  );
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'acceptance-registry-cohort-'),
  );
  const release = {
    packages: [
      {
        integrity: 'sha512-Y2FuZGlkYXRl',
        sha256: 'b'.repeat(64),
        shasum: 'c'.repeat(40),
        sourceName: '@modern-js/runtime',
        targetName: '@bleedingdev/modern-js-runtime',
        version: '3.5.0-ultramodern.50',
      },
    ],
  };
  try {
    await assert.rejects(
      verifyRegistryCohort({
        release,
        registryUrl: 'https://registry.npmjs.org/',
        workDir: root,
        async runImpl() {
          throw new Error('E404 exact version is unavailable');
        },
      }),
      /E404 exact version is unavailable/,
    );

    await assert.rejects(
      verifyRegistryCohort({
        release,
        registryUrl: 'https://registry.npmjs.org/',
        workDir: root,
        async runImpl(command, args) {
          assert.equal(command, 'npm');
          assert.equal(
            args[1],
            '@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50',
          );
          const destination = args[args.indexOf('--pack-destination') + 1];
          fs.writeFileSync(path.join(destination, 'stale.tgz'), 'stale');
          return JSON.stringify([{ filename: 'stale.tgz' }]);
        },
      }),
      /downloaded sha256 mismatch/,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('registry cohort verification settles every dispatched lane and rejects with the lowest-index failure in release order', async () => {
  const { verifyRegistryCohort } = await import(
    '../published-create-proof/registry-cohort.mjs'
  );
  const { computeTarballDigests } = await import(
    '../../ultramodern-publish/lib/source-create-proof/release-manifest.mjs'
  );
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'acceptance-registry-cohort-pool-'),
  );
  const failingIndexes = new Set([3, 9]);
  const started = new Set();
  const settled = new Set();
  try {
    const packages = Array.from({ length: 12 }, (_, index) => {
      const tarballPath = path.join(root, `seed-${index}.tgz`);
      fs.writeFileSync(tarballPath, `cohort-tarball-${index}`);
      const digests = computeTarballDigests(tarballPath);
      return {
        integrity: digests.integrity,
        sha256: digests.sha256,
        shasum: digests.shasum,
        sourceName: `@modern-js/pkg-${index}`,
        targetName: `@bleedingdev/modern-js-pkg-${index}`,
        version: '3.5.0-ultramodern.50',
      };
    });
    await assert.rejects(
      verifyRegistryCohort({
        release: { packages },
        registryUrl: 'https://registry.npmjs.org/',
        workDir: root,
        async runImpl(command, args) {
          const specifier = args[1];
          const index = Number(
            /pkg-(\d+)@/u.exec(specifier)?.[1] ?? Number.NaN,
          );
          started.add(index);
          try {
            // Failing lane 9 resolves before failing lane 3 so the
            // deterministic lowest-index selection is actually exercised.
            await new Promise(resolve => setTimeout(resolve, (12 - index) * 2));
            if (failingIndexes.has(index)) {
              throw new Error(`E404 pkg-${index} exact version is unavailable`);
            }
            if (args[0] === 'pack') {
              const destination = args[args.indexOf('--pack-destination') + 1];
              const filename = `pkg-${index}.tgz`;
              fs.copyFileSync(
                path.join(root, `seed-${index}.tgz`),
                path.join(destination, filename),
              );
              return JSON.stringify([{ filename }]);
            }
            return JSON.stringify({
              integrity: packages[index].integrity,
              shasum: packages[index].shasum,
            });
          } finally {
            settled.add(index);
          }
        },
      }),
      /E404 pkg-3 exact version is unavailable/,
    );
    // Every package lane was dispatched and settled before rejection: no npm
    // child may outlive the throw (the caller removes workDir in a finally).
    assert.equal(started.size, packages.length);
    assert.equal(settled.size, packages.length);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('registry cohort verification preserves release package order under shuffled lane completion', async () => {
  const { verifyRegistryCohort } = await import(
    '../published-create-proof/registry-cohort.mjs'
  );
  const { computeTarballDigests } = await import(
    '../../ultramodern-publish/lib/source-create-proof/release-manifest.mjs'
  );
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'acceptance-registry-cohort-order-'),
  );
  try {
    const packages = Array.from({ length: 10 }, (_, index) => {
      const tarballPath = path.join(root, `seed-${index}.tgz`);
      fs.writeFileSync(tarballPath, `cohort-tarball-${index}`);
      const digests = computeTarballDigests(tarballPath);
      return {
        integrity: digests.integrity,
        sha256: digests.sha256,
        shasum: digests.shasum,
        sourceName: `@modern-js/pkg-${index}`,
        targetName: `@bleedingdev/modern-js-pkg-${index}`,
        version: '3.5.0-ultramodern.50',
      };
    });
    const result = await verifyRegistryCohort({
      release: { packages },
      registryUrl: 'https://registry.npmjs.org/',
      workDir: root,
      async runImpl(command, args) {
        const specifier = args[1];
        const index = Number(/pkg-(\d+)@/u.exec(specifier)?.[1] ?? Number.NaN);
        // Reverse-order completion: index 9 finishes first, index 0 last.
        await new Promise(resolve => setTimeout(resolve, (10 - index) * 2));
        if (args[0] === 'pack') {
          const destination = args[args.indexOf('--pack-destination') + 1];
          const filename = `pkg-${index}.tgz`;
          fs.copyFileSync(
            path.join(root, `seed-${index}.tgz`),
            path.join(destination, filename),
          );
          return JSON.stringify([{ filename }]);
        }
        return JSON.stringify({
          integrity: packages[index].integrity,
          shasum: packages[index].shasum,
        });
      },
    });
    assert.equal(result.packageCount, packages.length);
    assert.deepEqual(
      result.packages.map(entry => entry.targetName),
      packages.map(entry => entry.targetName),
    );
    assert.deepEqual(
      result.packages.map(entry => entry.sha256),
      packages.map(entry => entry.sha256),
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('independent release-age audit retries transient registry transport failures', async () => {
  const { fetchRegistryMetadata } = await import(
    '../published-create-proof/release-age-audit.mjs'
  );
  const version = '1.0.0';
  const integrity = 'sha512-YWNjZXB0YW5jZQ==';
  let attempts = 0;
  const metadata = await fetchRegistryMetadata(
    [
      {
        integrity,
        name: 'transient-registry-package',
        path: ['importer:.', `transient-registry-package@${version}`],
        version,
      },
    ],
    {
      concurrency: 1,
      async fetchImpl() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('transient socket reset');
        }
        return new Response(
          JSON.stringify({
            time: { [version]: '2026-07-01T00:00:00.000Z' },
            versions: { [version]: { dist: { integrity } } },
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        );
      },
      now: new Date('2026-07-10T12:00:00.000Z'),
      registryUrlFor: () => 'https://registry.example.test/',
    },
  );
  assert.equal(attempts, 2);
  assert.equal(metadata[0].integrity, integrity);
});

test('cohort resolution provenance proof fails closed on stale versions, missing integrity, foreign or leaking tarball origins', async () => {
  const { assertCohortResolutionProvenance } = await import(
    '../published-create-proof/acceptance-profile.mjs'
  );
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'acceptance-cohort-provenance-'),
  );
  const release = {
    release: { version: '3.5.0-ultramodern.50' },
    targetScope: 'bleedingdev',
  };
  const registryUrl = 'http://127.0.0.1:4879/';
  // Pinned-parser output shape, injected so the unit test never spawns the
  // real `pnpm dlx` YAML CLI (matching every other parseYamlFile test here).
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
    // Real scope-routed shape: pnpm derives cohort tarball URLs from the
    // @scope registry mapping and omits resolution.tarball, so the pass path
    // is exact-revision keys (peer suffixes included) with pinned integrity.
    writeLock({
      '@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50': {
        resolution: { integrity: 'sha512-Y2FuZGlkYXRl' },
      },
      '@bleedingdev/modern-js-app-tools@3.5.0-ultramodern.50(typescript@7.0.2)':
        {
          resolution: { integrity: 'sha512-YXBwLXRvb2xz' },
        },
      'external-package@1.0.0': {
        resolution: { integrity: 'sha512-ZXh0ZXJuYWw=' },
      },
    });
    assert.deepEqual(provenance(), {
      cohortPackageCount: 2,
      registryOrigin: 'http://127.0.0.1:4879',
    });

    // A stale cohort revision means the scoped registry did not serve this
    // release: the pinned revision exists nowhere else before publish.
    writeLock({
      '@bleedingdev/modern-js-runtime@3.5.0-ultramodern.49': {
        resolution: { integrity: 'sha512-Y2FuZGlkYXRl' },
      },
    });
    assert.throws(provenance, /is not the release revision/);

    writeLock({
      '@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50': {
        resolution: {},
      },
    });
    assert.throws(provenance, /without a pinned integrity hash/);

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
      'external-package@1.0.0': {
        resolution: {
          integrity: 'sha512-ZXh0ZXJuYWw=',
          tarball:
            'http://127.0.0.1:4879/external-package/-/external-package-1.0.0.tgz',
        },
      },
    });
    assert.throws(provenance, /was served by the ephemeral release registry/);

    writeLock({});
    assert.throws(provenance, /found no @bleedingdev\/\* packages/);

    assert.throws(
      () =>
        assertCohortResolutionProvenance(
          root,
          { targetScope: 'bleedingdev' },
          registryUrl,
          parseJsonLock,
        ),
      /requires the strict release manifest version/,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('release-age exclusions use locale-independent canonical ordering', () => {
  const auditModuleUrl = pathToFileURL(
    path.resolve(__dirname, '../published-create-proof/release-age-audit.mjs'),
  ).href;
  const program = `
    const { validateExactExclusions } = await import(${JSON.stringify(auditModuleUrl)});
    validateExactExclusions(
      ['a@1.0.0-I', 'a@1.0.0-i'],
      'Generated minimumReleaseAgeExclude',
    );
  `;

  for (const locale of ['en_US.UTF-8', 'tr_TR.UTF-8']) {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', program],
      {
        encoding: 'utf8',
        env: { ...process.env, LANG: locale, LC_ALL: locale },
      },
    );
    assert.equal(
      result.status,
      0,
      `${locale} rejected code-unit-sorted exclusions: ${result.stderr}`,
    );
  }
});

test('reviewed release-age exceptions authorize exact third-party exclusions', async () => {
  const { auditReleaseAgePolicy } = await import(
    '../published-create-proof/release-age-audit.mjs'
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-age-policy-'));
  const external = {
    name: '@effect/tsgo',
    version: '0.36.2',
    integrity: 'sha512-ZXh0ZXJuYWw=',
    publishedAt: '2026-08-10T07:00:57.951Z',
  };
  const firstParty = {
    name: '@bleedingdev/modern-js-create',
    version: '3.5.0-ultramodern.103',
    integrity: 'sha512-Zmlyc3QtcGFydHk=',
    publishedAt: '2026-08-10T08:00:00.000Z',
  };
  const policyPath = path.join(root, 'release-age-policy.json');
  const workspacePath = path.join(root, 'pnpm-workspace.yaml');
  const lockPath = path.join(root, 'pnpm-lock.yaml');
  const locator = item => `${item.name}@${item.version}`;
  const lock = {
    lockfileVersion: '9.0',
    importers: {
      '.': {
        dependencies: {
          [external.name]: {
            specifier: external.version,
            version: external.version,
          },
          [firstParty.name]: {
            specifier: firstParty.version,
            version: firstParty.version,
          },
        },
      },
    },
    packages: Object.fromEntries(
      [external, firstParty].map(item => [
        locator(item),
        { resolution: { integrity: item.integrity } },
      ]),
    ),
    snapshots: Object.fromEntries(
      [external, firstParty].map(item => [locator(item), {}]),
    ),
  };
  const workspace = {
    minimumReleaseAge: 1440,
    minimumReleaseAgeExclude: [locator(external), locator(firstParty)].sort(),
    minimumReleaseAgeIgnoreMissingTime: false,
    minimumReleaseAgeStrict: true,
    trustPolicy: 'no-downgrade',
    trustPolicyIgnoreAfter: 1440,
  };
  const policy = {
    schema: 'bleedingdev.ultramodern.release-age-exceptions',
    schemaVersion: 2,
    entries: [
      {
        approvedBy: 'Release reviewer <reviewer@example.test>',
        evidence: {
          sha256: 'a'.repeat(64),
          uri: `urn:sha256:${'a'.repeat(64)}`,
        },
        expiresAt: '2026-09-09T23:59:59.000Z',
        integrity: external.integrity,
        package: external.name,
        reviewedAt: '2026-08-10T14:36:54.394Z',
        version: external.version,
      },
    ],
  };
  fs.writeFileSync(workspacePath, JSON.stringify(workspace));
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  fs.writeFileSync(policyPath, JSON.stringify(policy));

  try {
    let registry = new Map(
      [external, firstParty].map(item => [item.name, item]),
    );
    const auditAt = now =>
      auditReleaseAgePolicy({
        fetchImpl: async url => {
          const packageName = decodeURIComponent(
            new URL(url).pathname.slice(1),
          );
          const item = registry.get(packageName);
          assert.ok(item, `unexpected registry request for ${packageName}`);
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
        now,
        parseYamlImpl: JSON.parse,
        policyPath,
        projectDir: root,
        registryUrl: 'https://registry.example.test/',
        release: {
          cohortDigest: 'b'.repeat(64),
          manifestSha256: 'c'.repeat(64),
          packages: [
            {
              integrity: firstParty.integrity,
              sourceName: '@modern-js/create',
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
      });

    const result = await auditAt(new Date('2026-08-11T01:00:00.000Z'));

    assert.deepEqual(
      result.approvals.map(approval => [
        `${approval.package}@${approval.version}`,
        approval.authority,
      ]),
      [
        [locator(firstParty), 'strict-release-manifest'],
        [locator(external), 'external-release-age-policy'],
      ],
    );
    assert.deepEqual(
      result.exactExclusions,
      workspace.minimumReleaseAgeExclude,
    );

    const delayed = await auditAt(new Date('2026-09-10T01:00:00.000Z'));
    assert.deepEqual(delayed.approvals, []);
    assert.deepEqual(
      delayed.exactExclusions,
      workspace.minimumReleaseAgeExclude,
    );

    registry = new Map([
      [external.name, { ...external, publishedAt: '2026-09-10T00:30:00.000Z' }],
      [firstParty.name, firstParty],
    ]);
    await assert.rejects(
      auditAt(new Date('2026-09-10T01:00:00.000Z')),
      /without an exact, unexpired approval/u,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('release-age audit parses lockfiles by path with the pinned parser', async () => {
  const { parseYamlFile, YAML_INTEGRITY, YAML_SPECIFIER, YAML_VERSION } =
    await import('../published-create-proof/release-age-audit.mjs');
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'release-age-yaml-file-parser-'),
  );
  const lockPath = path.join(root, 'pnpm-lock.yaml');
  fs.writeFileSync(lockPath, "lockfileVersion: '9.0'\n");
  const calls = [];

  try {
    const parsed = parseYamlFile(lockPath, (...args) => {
      calls.push(args);
      return {
        error: undefined,
        status: 0,
        stderr: '',
        stdout: '{"lockfileVersion":"9.0"}\n',
      };
    });

    assert.deepEqual(parsed, { lockfileVersion: '9.0' });
    assert.equal(YAML_SPECIFIER, 'js-yaml@5.2.2');
    assert.equal(YAML_VERSION, '5.2.2');
    assert.equal(
      YAML_INTEGRITY,
      'sha512-dayzUzKkJ1MkuUtZglSebU43utNXH0OWQByK9rKOOuYIO8M5TV1y+n8ALMdG0rdzBnfNkOmZEqrURepb0ejqBw==',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'pnpm');
    assert.deepEqual(calls[0][1], ['dlx', YAML_SPECIFIER, lockPath]);
    assert.equal(Object.hasOwn(calls[0][2], 'input'), false);
    assert.deepEqual(calls[0][2].stdio, ['ignore', 'pipe', 'pipe']);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
