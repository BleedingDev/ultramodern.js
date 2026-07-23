const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

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

test('acceptance executes final Node outputs before Cloudflare replaces .output', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../published-create-proof/acceptance-profile.mjs'),
    'utf8',
  );
  const build = source.indexOf("recordAcceptanceResult(receipt, 'build'");
  const eagerNode = source.indexOf("runtimeReports.set(\n        'node'");
  const cloudflare = source.indexOf(
    "recordAcceptanceResult(receipt, 'cloudflare-build'",
  );
  const nodeBackendArtifacts = source.indexOf(
    "recordAcceptanceResult(receipt, 'backend'",
  );

  assert.ok(build >= 0 && build < eagerNode);
  assert.ok(eagerNode < cloudflare);
  assert.ok(
    eagerNode < nodeBackendArtifacts && nodeBackendArtifacts < cloudflare,
    'all path-based Node backend evidence must be captured before Cloudflare replaces .output',
  );
  assert.match(
    source.slice(eagerNode, cloudflare),
    /runtimeAcceptanceInvocation\(mode, 'node'\)/u,
  );
  assert.match(
    source.slice(eagerNode, cloudflare),
    /runtimeAcceptanceInvocation\(mode, 'node'\)[\s\S]*packageManagerEnv/u,
    'the nested runtime proof must inherit the exact package-manager environment',
  );

  const bootstrap = fs.readFileSync(
    path.join(__dirname, '../browser-smoke/bootstrap.mjs'),
    'utf8',
  );
  assert.match(
    bootstrap,
    /path\.join\(\s*projectDir,\s*target\.app\.path,\s*'\.output'/u,
  );
  assert.match(bootstrap, /PORT: String\(target\.port\)/u);
  assert.match(bootstrap, /spawn\(process\.execPath, \['index\.js'\]/u);
  assert.match(bootstrap, /cwd: nodeDeployDirectory/u);
  assert.doesNotMatch(
    bootstrap,
    /\['--filter', target\.app\.package, 'run', 'serve'\]/u,
  );
});

test('the immutable ERP contract independently requires every Node and workerd runtime dimension', async () => {
  const {
    requiredAcceptanceResultIds,
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
    baseUrl: `http://127.0.0.1/${platform}`,
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
      widget: '/en/_mf/fragment/widget',
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
      widget: {
        bodySha256: '3'.repeat(64),
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

test('shared source and published profiles commit only inventory and invoke the same post-runtime proof', async t => {
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
          "const item = { title: 'Wire a real inventory source here' };\n",
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
          packageManagerEnv: {},
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
        assert.match(
          fs.readFileSync(apiPath, 'utf8'),
          /Inventory C1 operational proof response/u,
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
  hardcoded.targets.node.servedBehavior.responses.widget.value =
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
    assert.throws(
      () =>
        verifyRegistryCohort({
          release,
          registryUrl: 'https://registry.npmjs.org/',
          workDir: root,
          runImpl() {
            throw new Error('E404 exact version is unavailable');
          },
        }),
      /E404 exact version is unavailable/,
    );

    assert.throws(
      () =>
        verifyRegistryCohort({
          release,
          registryUrl: 'https://registry.npmjs.org/',
          workDir: root,
          runImpl(command, args) {
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
