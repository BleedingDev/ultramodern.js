const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function loadSmoke() {
  return import('../run-browser-smoke.mjs');
}

async function loadAcceptanceAssertions() {
  return import('../published-create-proof/acceptance-assertions.mjs');
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-browser-smoke-'));
}

function createNodeBackendProofResult() {
  const manifestUrl = 'http://localhost:3021/backend-mf-manifest.json';
  const containerEntry = 'http://localhost:3021/backendRemoteEntry.cjs';
  const envelopeDigest = 'a'.repeat(64);

  return {
    appId: 'inventory',
    containerEntry,
    manifestUrl,
    remoteName: 'verticalInventoryBackend',
    runtimeEntry: containerEntry,
    releaseEnvelope: {
      path: 'verticals/inventory/.output/release/microvertical-release-envelope.json',
      envelopeDigest,
      target: 'node',
    },
    liveArtifacts: {
      manifest: {
        url: manifestUrl,
        logicalPath: 'backend-mf-manifest.json',
        statusCode: 200,
        byteLength: 1024,
        sha256: 'b'.repeat(64),
        status: 'pass',
      },
      container: {
        url: containerEntry,
        logicalPath: 'backendRemoteEntry.cjs',
        statusCode: 200,
        byteLength: 2048,
        sha256: 'c'.repeat(64),
        status: 'pass',
      },
    },
    liveApi: {
      method: 'GET',
      route: '/inventory-api/inventory/readiness',
      url: 'http://localhost:3021/inventory-api/inventory/readiness',
      statusCode: 200,
      marker: {
        unitId: 'inventory',
        buildMarker: 'build-inventory',
        sourceRevision: 'd'.repeat(40),
        releaseVersion: '1.0.0',
      },
      envelopeDigest,
      apiBackendArtifacts: [
        {
          logicalPath: 'api/index.js',
          runtime: 'node',
          byteLength: 4096,
          sha256: 'd'.repeat(64),
        },
        {
          logicalPath: 'shared/runtime.js',
          runtime: 'node',
          byteLength: 2048,
          sha256: 'e'.repeat(64),
        },
      ],
      status: 'pass',
    },
    versionBoundary: {
      packageName: '@acme/inventory',
      version: '1.0.0',
      buildVersion: 'build-inventory',
      unitId: 'inventory',
      sourceRevision: 'd'.repeat(40),
    },
    smokeChecks: [
      {
        method: 'GET',
        route: '/inventory-api/inventory/readiness',
        statusCode: 200,
        assertions: [{ status: 'pass' }],
        status: 'pass',
      },
    ],
    status: 'pass',
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function releaseBuildMarker(unitId, generationBuildMarker, sourceRevision) {
  return crypto
    .createHash('sha256')
    .update(
      `ultramodern-delivery-unit-release-build-marker:v1:${unitId}:${generationBuildMarker}:${sourceRevision}`,
    )
    .digest('hex')
    .slice(0, 16);
}

function commitFixture(root) {
  fs.writeFileSync(path.join(root, '.gitignore'), '**/.output/\n.codex/\n');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'proof@example.invalid'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Proof'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

test('release acceptance requires the browser shell to run in workerd', async () => {
  const { assertBrowserRuntimeAcceptance } = await loadAcceptanceAssertions();

  assert.throws(
    () =>
      assertBrowserRuntimeAcceptance(
        {
          results: [],
          shellRuntime: 'node',
          skipped: [],
          status: 'pass',
        },
        [],
      ),
    /browser shell runtime must be workerd/i,
  );
});

test('release acceptance requires localized router navigation evidence from every vertical', async () => {
  const { assertBrowserRuntimeAcceptance } = await loadAcceptanceAssertions();
  const requiredBrowserAssertions = [
    { status: 'pass', type: 'browser-screenshot' },
    { status: 'pass', type: 'mf-manifest' },
    { status: 'pass', type: 'no-js-screenshot' },
    { status: 'pass', type: 'stylesheet-evidence' },
  ];
  const report = {
    results: [
      {
        appId: 'shell-super-app',
        assertions: [
          ...requiredBrowserAssertions,
          {
            declaredRemoteIds: ['inventory'],
            matchedRemoteBoundaries: [{ remoteId: 'inventory' }],
            status: 'pass',
            type: 'shell-composition-boundary',
          },
          {
            declaredRemoteIds: ['inventory'],
            matchedRemoteBoundaries: [{ remoteId: 'inventory' }],
            status: 'pass',
            type: 'no-js-shell-composition-boundary',
          },
        ],
        status: 'pass',
      },
      {
        appId: 'inventory',
        assertions: [
          ...requiredBrowserAssertions,
          { status: 'pass', type: 'effect-readiness' },
        ],
        status: 'pass',
      },
    ],
    shellRuntime: 'workerd',
    skipped: [],
    status: 'pass',
  };

  assert.throws(
    () => assertBrowserRuntimeAcceptance(report, ['inventory']),
    /inventory browser\/runtime proof lacks required localized-router-navigation evidence/u,
  );

  report.results[1].assertions.push({
    status: 'pass',
    type: 'localized-router-navigation',
  });
  assert.throws(
    () => assertBrowserRuntimeAcceptance(report, ['inventory']),
    /inventory browser\/runtime localized-router-navigation evidence is incomplete/u,
  );
  report.results[1].assertions.pop();
  report.results[1].assertions.push({
    documentContinuityPreserved: true,
    source: {
      htmlLang: 'en',
      navigationLabel: 'Language',
      pathname: '/en',
      text: 'Czech',
    },
    status: 'pass',
    target: {
      htmlLang: 'cs',
      navigationLabel: 'Jazyk',
      pathname: '/cs',
      text: 'Čeština',
    },
    type: 'localized-router-navigation',
  });
  const localizedNavigation = report.results[1].assertions.at(-1);
  localizedNavigation.documentContinuityPreserved = false;
  assert.throws(
    () => assertBrowserRuntimeAcceptance(report, ['inventory']),
    /inventory browser\/runtime localized-router-navigation evidence is incomplete/u,
  );
  localizedNavigation.documentContinuityPreserved = true;
  localizedNavigation.target.navigationLabel =
    localizedNavigation.source.navigationLabel;
  assert.throws(
    () => assertBrowserRuntimeAcceptance(report, ['inventory']),
    /inventory browser\/runtime localized-router-navigation evidence is incomplete/u,
  );
  localizedNavigation.target.navigationLabel = 'Jazyk';
  assert.doesNotThrow(() =>
    assertBrowserRuntimeAcceptance(report, ['inventory']),
  );
});

function response(status, body, headers = {}) {
  return {
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

function createFetch(routes) {
  return async url => {
    const pathname = new URL(url).pathname;
    const route = routes[pathname];
    if (!route) {
      return response(404, 'not found');
    }
    return response(route.status ?? 200, route.body);
  };
}

function createContract() {
  return {
    apps: [
      {
        id: 'shell-super-app',
        kind: 'shell',
        package: '@demo/shell-super-app',
        config: {
          source: {
            siteUrl: {
              defaultLocalhostPort: 3020,
              envFallbackOrder: [
                'MODERN_PUBLIC_SITE_URL',
                'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
                'SHELL_SUPER_APP_PORT',
              ],
            },
          },
          output: {
            assetPrefix: {
              envFallbackOrder: ['MODERN_ASSET_PREFIX'],
              default: '/',
            },
          },
        },
        deploy: {
          cloudflare: {
            publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
            routes: {
              locale: '/locales/en/shell.json',
              mfManifest: '/mf-manifest.json',
              ssr: '/en',
            },
          },
        },
        i18n: {
          namespace: 'shell',
        },
        marker: {
          build: 'build-shell',
        },
        moduleFederation: {
          remotes: [],
          verticalRefs: [],
        },
        styling: {
          federation: {
            rootSelector: '[data-app-id="shell-super-app"]',
          },
        },
      },
    ],
  };
}

function createCompactConfig() {
  return {
    workspace: {
      packageScope: '@demo',
    },
    topology: {
      apps: [
        {
          id: 'shell-super-app',
          kind: 'shell',
          package: '@demo/shell-super-app',
          packageSuffix: 'shell-super-app',
          path: 'apps/shell-super-app',
          port: 3020,
          portEnv: 'SHELL_SUPER_APP_PORT',
          deliveryUnit: {
            buildMarker: '6fa0ccad57ed2cba',
            unitId: '@demo/shell-super-app',
            version: '0.1.0',
          },
          deploy: {
            cloudflare: {
              distributedSsrProofRoutes: ['/en', '/en/products/tractor-1'],
            },
          },
          moduleFederation: {
            remotes: [
              {
                id: 'inventory',
                alias: 'inventory',
                name: 'verticalInventory',
                manifestEnv: 'VERTICAL_INVENTORY_MF_MANIFEST',
                manifestUrl: 'http://localhost:3021/mf-manifest.json',
              },
            ],
            verticalRefs: ['inventory'],
          },
        },
        {
          id: 'inventory',
          kind: 'vertical',
          package: '@demo/inventory',
          packageSuffix: 'inventory',
          path: 'verticals/inventory',
          domain: 'inventory',
          port: 3021,
          portEnv: 'VERTICAL_INVENTORY_PORT',
          deliveryUnit: {
            buildMarker: '254adf7dcb9e1da2',
            unitId: '@demo/inventory',
            version: '0.1.0',
          },
          moduleFederation: {
            exposes: ['./Route'],
            name: 'verticalInventory',
          },
          api: {
            stem: 'inventory',
            prefix: '/inventory-api',
          },
        },
      ],
    },
  };
}

function html({ appId = 'shell-super-app', marker = 'build-shell' } = {}) {
  return `<html><body><div data-app-id="${appId}"><p data-testid="ultramodern-ui-marker" data-build-marker="${marker}">marker</p></div></body></html>`;
}

function successRoutes() {
  return {
    '/en': {
      body: html(),
    },
    '/locales/en/shell.json': {
      body: JSON.stringify({ shell: { title: 'Shell' } }),
    },
    '/mf-manifest.json': {
      body: JSON.stringify({ metaData: { name: 'shellSuperApp' } }),
    },
  };
}

test('creates local and public smoke targets from the generated contract', async () => {
  const { createSmokeTargets } = await loadSmoke();
  const contract = createContract();

  assert.deepEqual(
    createSmokeTargets(contract).targets.map(target => target.baseUrl),
    ['http://localhost:3020'],
  );
  assert.deepEqual(
    createSmokeTargets(contract, {
      env: { SHELL_SUPER_APP_PORT: '3120' },
    }).targets.map(target => [target.baseUrl, target.port]),
    [['http://localhost:3120', 3120]],
  );
  assert.deepEqual(
    createSmokeTargets(contract, {
      mode: 'public',
      publicUrls: {
        'shell-super-app': 'https://shell.example.test/',
      },
    }).targets.map(target => target.baseUrl),
    ['https://shell.example.test'],
  );
});

test('validates public Cloudflare browser targets with workerd semantics', async () => {
  const { runUltramodernBrowserSmoke } = await loadSmoke();
  const root = tempRoot();
  let observedRuntime;

  try {
    await runUltramodernBrowserSmoke({
      artifactDir: root,
      browserProvider: {
        chromium: {
          async launch() {
            return { async close() {} };
          },
        },
      },
      contract: createContract(),
      fetchImpl: createFetch(successRoutes()),
      generatedAt: '2026-07-01T00:00:00.000Z',
      mode: 'public',
      out: path.join(root, 'summary.json'),
      projectDir: root,
      publicUrls: {
        'shell-super-app': 'https://shell.example.test',
      },
      requirePublicUrls: true,
      async validateBrowserTargetImpl(_target, _browser, options) {
        observedRuntime = options.runtime;
        return [];
      },
    });

    assert.equal(observedRuntime, 'workerd');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('creates smoke targets from the compact UltraModern config', async () => {
  const { createSmokeTargets, orderTargetsForLocalStartup } = await loadSmoke();
  const config = createCompactConfig();
  const { targets } = createSmokeTargets(config);

  assert.deepEqual(
    targets.map(target => [target.app.id, target.baseUrl, target.portEnv]),
    [
      ['shell-super-app', 'http://localhost:3020', 'SHELL_SUPER_APP_PORT'],
      ['inventory', 'http://localhost:3021', 'VERTICAL_INVENTORY_PORT'],
    ],
  );
  assert.equal(targets[0].routes.locale, '/locales/en/shell.json');
  assert.equal(targets[0].routes.distributedSsr, '/en/products/tractor-1');
  assert.equal(targets[0].routes.ssr, '/en');
  assert.equal(targets[1].routes.locale, '/locales/en/inventory.json');
  assert.equal(
    targets[1].routes.effectReadiness,
    '/inventory-api/inventory/readiness',
  );
  assert.equal(
    targets[0].app.styling.federation.rootSelector,
    '[data-app-id="shell-super-app"]',
  );
  assert.equal(targets[0].app.marker.build, '6fa0ccad57ed2cba');
  assert.throws(
    () =>
      createSmokeTargets({
        ...config,
        topology: {
          apps: [{ ...config.topology.apps[1], kind: 'verticall' }],
        },
      }),
    /kind must be exactly "shell" or "vertical"/,
  );

  const ordered = orderTargetsForLocalStartup(targets);
  assert.deepEqual(
    ordered.remotes.map(target => target.app.id),
    ['inventory'],
  );
  assert.deepEqual(
    ordered.shells.map(target => target.app.id),
    ['shell-super-app'],
  );
});

test('reads compact config before the retired generated contract path', async () => {
  const { readSmokeContract } = await loadSmoke();
  const root = tempRoot();
  fs.mkdirSync(path.join(root, '.modernjs'));
  fs.writeFileSync(
    path.join(root, '.modernjs/ultramodern.json'),
    JSON.stringify(createCompactConfig()),
  );

  const { contract, contractPath } = readSmokeContract(root);

  assert.equal(contractPath, path.join(root, '.modernjs/ultramodern.json'));
  assert.deepEqual(
    contract.apps.map(app => app.id),
    ['shell-super-app', 'inventory'],
  );
  assert.deepEqual(contract.apps[1].deliveryUnit, {
    buildMarker: '254adf7dcb9e1da2',
    unitId: '@demo/inventory',
    version: '0.1.0',
  });
});

test('parses browser smoke CLI options with stable validation behavior', async () => {
  const { parseArgs, runUltramodernBrowserSmoke } = await loadSmoke();
  const parsed = parseArgs([
    '--project-dir',
    '.',
    '--artifact-dir',
    '.modern/browser-artifacts',
    '--out',
    '.modern/browser-summary.json',
    '--mode',
    'public',
    '--artifact-mode',
    'published',
    '--platform',
    'workerd',
    '--shell-runtime',
    'workerd',
    '--public-url',
    'shell-super-app=https://shell.example.test/',
    '--require-public-urls',
    '--timeout-ms',
    '30000',
  ]);

  assert.equal(path.isAbsolute(parsed.projectDir), true);
  assert.equal(path.isAbsolute(parsed.artifactDir), true);
  assert.equal(path.isAbsolute(parsed.out), true);
  assert.equal(parsed.mode, 'public');
  assert.equal(parsed.artifactMode, 'published');
  assert.equal(parsed.platform, 'workerd');
  assert.equal(parsed.shellRuntime, 'workerd');
  assert.equal(
    parsed.publicUrls['shell-super-app'],
    'https://shell.example.test/',
  );
  assert.equal(parsed.requirePublicUrls, true);
  assert.equal(parsed.timeoutMs, 30_000);

  assert.throws(
    () => parseArgs(['--project-dir=.']),
    /^Error: Unknown argument: --project-dir=.$/,
  );
  assert.throws(
    () => parseArgs(['--project-dir', '.', '--artifact-mode', 'source']),
    /--artifact-mode and --platform must be provided together/,
  );
  assert.throws(
    () => parseArgs(['--project-dir', '.', '--platform', 'node']),
    /--artifact-mode and --platform must be provided together/,
  );
  await assert.rejects(
    () =>
      runUltramodernBrowserSmoke({
        artifactMode: 'source',
        projectDir: '.',
      }),
    /artifactMode and platform must be provided together/,
  );
});

test('orders local smoke startup so remotes are ready before shell', async () => {
  const { createSmokeTargets, orderTargetsForLocalStartup } = await loadSmoke();
  const contract = createContract();
  contract.apps.push({
    ...contract.apps[0],
    id: 'inventory',
    kind: 'vertical',
    package: '@demo/inventory',
  });
  contract.apps[0].moduleFederation.verticalRefs = ['inventory'];

  const { targets } = createSmokeTargets(contract);
  const ordered = orderTargetsForLocalStartup(targets);

  assert.deepEqual(
    ordered.remotes.map(target => target.app.id),
    ['inventory'],
  );
  assert.deepEqual(
    ordered.shells.map(target => target.app.id),
    ['shell-super-app'],
  );
  assert.deepEqual(
    ordered.validation.map(target => target.app.id),
    ['inventory', 'shell-super-app'],
  );
});

test('orders remote consumers after their remote producers are ready', async () => {
  const { createSmokeTargets, orderTargetsForLocalStartup } = await loadSmoke();
  const contract = createContract();
  contract.apps.push(
    {
      ...contract.apps[0],
      id: 'decide',
      kind: 'vertical',
      package: '@demo/decide',
      moduleFederation: {
        remotes: [{ id: 'explore' }, { id: 'checkout' }],
      },
    },
    {
      ...contract.apps[0],
      id: 'explore',
      kind: 'vertical',
      package: '@demo/explore',
    },
    {
      ...contract.apps[0],
      id: 'checkout',
      kind: 'vertical',
      package: '@demo/checkout',
    },
  );

  const { targets } = createSmokeTargets(contract);
  const ordered = orderTargetsForLocalStartup(targets);

  assert.deepEqual(
    ordered.remoteLayers.map(layer => layer.map(target => target.app.id)),
    [['explore', 'checkout'], ['decide']],
  );
  assert.deepEqual(
    ordered.validation.map(target => target.app.id),
    ['explore', 'checkout', 'decide', 'shell-super-app'],
  );
});

test('waits for remote manifest JSON readiness', async () => {
  const { createSmokeTargets, waitForTarget } = await loadSmoke();
  const [target] = createSmokeTargets(createContract()).targets;
  const calls = [];
  let manifestAttempts = 0;

  await waitForTarget(target, {
    fetchImpl: async url => {
      const pathname = new URL(url).pathname;
      calls.push(pathname);
      if (pathname === '/mf-manifest.json') {
        manifestAttempts += 1;
        return response(
          200,
          manifestAttempts === 1
            ? '<html>not ready</html>'
            : JSON.stringify({ metaData: { name: 'shellSuperApp' } }),
        );
      }
      return response(200, html());
    },
    requireManifest: true,
    retryDelayMs: 0,
    timeoutMs: 1_000,
  });

  assert.deepEqual(calls, ['/en', '/mf-manifest.json', '/mf-manifest.json']);
});

test('does not accept SSR readiness from a foreign build marker', async () => {
  const { createSmokeTargets, waitForTarget } = await loadSmoke();
  const [target] = createSmokeTargets(createContract()).targets;
  let attempts = 0;

  await waitForTarget(target, {
    fetchImpl: async () => {
      attempts += 1;
      return response(
        200,
        html({
          marker: attempts === 1 ? 'foreign-build' : 'build-shell',
        }),
      );
    },
    retryDelayMs: 0,
    timeoutMs: 1_000,
  });

  assert.equal(attempts, 2);
});

test('fails readiness when required MF manifest never becomes valid JSON', async () => {
  const { createSmokeTargets, waitForTarget } = await loadSmoke();
  const [target] = createSmokeTargets(createContract()).targets;

  await assert.rejects(
    () =>
      waitForTarget(target, {
        fetchImpl: async url => {
          const pathname = new URL(url).pathname;
          return response(
            200,
            pathname === '/mf-manifest.json'
              ? '<html>not ready</html>'
              : html(),
          );
        },
        requireManifest: true,
        retryDelayMs: 1,
        timeoutMs: 5,
      }),
    /did not publish a ready MF manifest/,
  );
});

test('fails readiness immediately when the owned serve process exits', async () => {
  const { createSmokeTargets, waitForTarget } = await loadSmoke();
  const [target] = createSmokeTargets(createContract()).targets;
  const root = tempRoot();
  const logPath = path.join(root, 'shell-serve.log');
  fs.writeFileSync(
    logPath,
    `${'discard-me\n'.repeat(2_000)}NPM_TOKEN=do-not-copy-me\nError: Cannot find module '@modern-js/prod-server'\n`,
  );

  try {
    await assert.rejects(
      () =>
        waitForTarget(target, {
          fetchImpl: async () => new Promise(() => {}),
          retryDelayMs: 1,
          serverExit: Promise.resolve({ exitCode: 1, signal: null }),
          serverLogPath: logPath,
          timeoutMs: 1_000,
        }),
      error => {
        assert.match(error.message, /serve process exited before readiness/);
        assert.match(
          error.message,
          /Cannot find module '@modern-js\/prod-server'/,
        );
        assert.match(error.message, new RegExp(logPath.replaceAll('/', '\\/')));
        assert.doesNotMatch(error.message, /do-not-copy-me/);
        assert.match(error.message, /NPM_TOKEN=\[REDACTED\]/);
        assert.equal(error.details.exitCode, 1);
        assert.equal(error.details.logPath, logPath);
        assert.ok(error.details.logTail.length <= 8_192);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('includes bounded redacted child output when the workerd proof exits before publishing URLs', async () => {
  const { startWorkerdProof } = await import('../browser-smoke/bootstrap.mjs');
  const root = tempRoot();
  const artifactDir = path.join(root, 'artifacts');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      scripts: {
        'cloudflare:ssr-proof': `node -e "process.stderr.write('NPM_TOKEN=do-not-copy-me\\\\nError: workerd bootstrap exploded\\\\n'); process.exit(23)"`,
      },
    })}\n`,
  );

  try {
    await assert.rejects(
      () =>
        startWorkerdProof({
          artifactDir,
          projectDir: root,
          timeoutMs: 2_000,
        }),
      error => {
        const logPath = path.join(artifactDir, 'shell-workerd-proof.log');
        assert.match(
          error.message,
          /workerd SSR proof exited before publishing a browser URL/u,
        );
        assert.match(error.message, /Error: workerd bootstrap exploded/u);
        assert.match(error.message, /NPM_TOKEN=\[REDACTED\]/u);
        assert.doesNotMatch(error.message, /do-not-copy-me/u);
        assert.equal(error.details.exitCode, 23);
        assert.equal(error.details.logPath, logPath);
        assert.match(error.details.logTail, /workerd bootstrap exploded/u);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('waits for both generated workerd URL lines when target URLs arrive first', async () => {
  const { startWorkerdProof } = await import('../browser-smoke/bootstrap.mjs');
  const root = tempRoot();
  const artifactDir = path.join(root, 'artifacts');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      scripts: {
        'cloudflare:ssr-proof': `node -e "process.stdout.write('WORKERD_TARGET_URLS={\\\\\\"shell-super-app\\\\\\":\\\\\\"http://127.0.0.1:3020\\\\\\"}\\\\n'); setTimeout(() => process.stdout.write('WORKERD_URL=http://127.0.0.1:3020\\\\n'), 25); setInterval(() => {}, 1000)"`,
      },
    })}\n`,
  );

  let proof;
  try {
    proof = await startWorkerdProof({
      artifactDir,
      projectDir: root,
      requireTargetUrls: true,
      timeoutMs: 2_000,
    });
    assert.equal(proof.baseUrl, 'http://127.0.0.1:3020');
    assert.deepEqual(proof.targetUrls, {
      'shell-super-app': 'http://127.0.0.1:3020',
    });
  } finally {
    await proof?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('waits for both generated workerd URL lines when shell URL arrives first', async () => {
  const { startWorkerdProof } = await import('../browser-smoke/bootstrap.mjs');
  const root = tempRoot();
  const artifactDir = path.join(root, 'artifacts');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      scripts: {
        'cloudflare:ssr-proof': `node -e "process.stdout.write('WORKERD_URL=http://127.0.0.1:3020\\\\n'); setTimeout(() => process.stdout.write('WORKERD_TARGET_URLS={\\\\\\"shell-super-app\\\\\\":\\\\\\"http://127.0.0.1:3020\\\\\\"}\\\\n'), 25); setInterval(() => {}, 1000)"`,
      },
    })}\n`,
  );

  let proof;
  try {
    proof = await startWorkerdProof({
      artifactDir,
      projectDir: root,
      requireTargetUrls: true,
      timeoutMs: 2_000,
    });
    assert.equal(proof.baseUrl, 'http://127.0.0.1:3020');
    assert.deepEqual(proof.targetUrls, {
      'shell-super-app': 'http://127.0.0.1:3020',
    });
  } finally {
    await proof?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('includes the owned serve log when HTTP readiness times out', async () => {
  const { createSmokeTargets, waitForTarget } = await loadSmoke();
  const [target] = createSmokeTargets(createContract()).targets;
  const root = tempRoot();
  const logPath = path.join(root, 'shell-serve.log');
  fs.writeFileSync(
    logPath,
    'NPM_TOKEN=do-not-copy-me\nError: remote manifest remained unavailable\n',
  );

  try {
    await assert.rejects(
      () =>
        waitForTarget(target, {
          fetchImpl: async () => response(503, 'not ready'),
          retryDelayMs: 1,
          serverExit: new Promise(() => {}),
          serverLogPath: logPath,
          timeoutMs: 5,
        }),
      error => {
        assert.match(error.message, /did not become reachable/);
        assert.match(error.message, /cause: HTTP 503/);
        assert.match(error.message, /remote manifest remained unavailable/);
        assert.match(error.message, /NPM_TOKEN=\[REDACTED\]/);
        assert.doesNotMatch(error.message, /do-not-copy-me/);
        assert.equal(error.details.cause, 'HTTP 503');
        assert.equal(error.details.logPath, logPath);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects stale matching HTTP readiness when the owned process exits during startup', async () => {
  const { createSmokeTargets, waitForTarget } = await loadSmoke();
  const [target] = createSmokeTargets(createContract()).targets;
  const root = tempRoot();
  const logPath = path.join(root, 'shell-serve.log');
  fs.writeFileSync(
    logPath,
    'Error: listen EADDRINUSE: address already in use :::3020\n',
  );

  try {
    await assert.rejects(
      () =>
        waitForTarget(target, {
          fetchImpl: async () => response(200, html()),
          retryDelayMs: 0,
          serverExit: new Promise(resolve =>
            setTimeout(() => resolve({ exitCode: 1, signal: null }), 5),
          ),
          serverLogPath: logPath,
          timeoutMs: 1_000,
        }),
      error => {
        assert.match(error.message, /serve process exited before readiness/);
        assert.match(error.message, /EADDRINUSE/);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects occupied local smoke ports before startup', async () => {
  const { assertLocalPortsAvailable } = await loadSmoke();
  const server = net.createServer();
  await new Promise(resolve =>
    server.listen({ host: '127.0.0.1', port: 0 }, resolve),
  );
  const { port } = server.address();

  try {
    await assert.rejects(
      () =>
        assertLocalPortsAvailable([
          {
            app: { id: 'shell-super-app' },
            baseUrl: `http://localhost:${port}`,
            port,
          },
        ]),
      /local smoke port .* is already in use/,
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('rejects an IPv6 wildcard listener before local smoke startup', async t => {
  const { assertLocalPortsAvailable } = await loadSmoke();
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '::', ipv6Only: true, port: 0 }, resolve);
    });
  } catch (error) {
    server.close();
    t.skip(
      `IPv6 wildcard listeners are unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  const { port } = server.address();

  try {
    await assert.rejects(
      () =>
        assertLocalPortsAvailable([
          {
            app: { id: 'shell-super-app' },
            baseUrl: `http://localhost:${port}`,
            port,
          },
        ]),
      /local smoke port .* is already in use/,
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('starts shell only after local remotes publish MF manifests', async () => {
  const { runUltramodernBrowserSmoke } = await loadSmoke();
  const root = tempRoot();
  const contract = createContract();
  contract.apps[0].moduleFederation.verticalRefs = ['inventory'];
  contract.apps.push({
    ...contract.apps[0],
    id: 'inventory',
    kind: 'vertical',
    package: '@demo/inventory',
    config: {
      source: {
        siteUrl: {
          defaultLocalhostPort: 3021,
          envFallbackOrder: ['VERTICAL_INVENTORY_PORT'],
        },
      },
    },
  });

  const events = [];
  const browser = createFakeBrowser({ boundaryIds: ['inventory'] });

  try {
    await runUltramodernBrowserSmoke({
      artifactDir: root,
      browserProvider: {
        chromium: {
          async launch() {
            return browser;
          },
        },
      },
      contract,
      fetchImpl: async url => {
        const parsed = new URL(url);
        events.push(`fetch:${parsed.port}:${parsed.pathname}`);
        if (parsed.pathname === '/locales/en/shell.json') {
          return response(200, JSON.stringify({ shell: { title: 'Shell' } }));
        }
        if (parsed.pathname === '/mf-manifest.json') {
          return response(200, JSON.stringify({ metaData: { name: 'app' } }));
        }
        return response(200, html());
      },
      generatedAt: '2026-07-01T00:00:00.000Z',
      mode: 'local',
      out: path.join(root, 'summary.json'),
      preflightLocalPortsImpl(targets) {
        events.push(
          `preflight:${targets.map(target => target.app.id).join(',')}`,
        );
      },
      projectDir: root,
      retryDelayMs: 0,
      startServerImpl(target) {
        events.push(`start:${target.app.id}`);
        return {
          async stop() {},
        };
      },
      timeoutMs: 1_000,
    });

    assert.deepEqual(events.slice(0, 5), [
      'preflight:inventory,shell-super-app',
      'start:inventory',
      'fetch:3021:/en',
      'fetch:3021:/mf-manifest.json',
      'start:shell-super-app',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uses the generated workerd proof as the local shell browser target', async () => {
  const { runUltramodernBrowserSmoke } = await loadSmoke();
  const root = tempRoot();
  const contract = createContract();
  contract.apps[0].moduleFederation.verticalRefs = ['inventory'];
  contract.apps.push({
    ...contract.apps[0],
    id: 'inventory',
    kind: 'vertical',
    package: '@demo/inventory',
    config: {
      source: {
        siteUrl: {
          defaultLocalhostPort: 3021,
          envFallbackOrder: ['VERTICAL_INVENTORY_PORT'],
        },
      },
    },
  });
  const events = [];
  const preflightIds = [];
  let workerdProofOptions;
  const browser = createFakeBrowser({ boundaryIds: ['inventory'] });

  try {
    const report = await runUltramodernBrowserSmoke({
      artifactDir: root,
      browserProvider: {
        chromium: {
          async launch() {
            return browser;
          },
        },
      },
      contract,
      fetchImpl: async url => {
        const parsed = new URL(url);
        events.push(`fetch:${parsed.port}:${parsed.pathname}`);
        if (parsed.pathname === '/locales/en/shell.json') {
          return response(200, JSON.stringify({ shell: { title: 'Shell' } }));
        }
        if (parsed.pathname === '/mf-manifest.json') {
          return response(200, JSON.stringify({ metaData: { name: 'app' } }));
        }
        return response(200, html());
      },
      generatedAt: '2026-07-01T00:00:00.000Z',
      mode: 'local',
      out: path.join(root, 'summary.json'),
      preflightLocalPortsImpl(targets) {
        preflightIds.push(...targets.map(target => target.app.id));
      },
      projectDir: root,
      retryDelayMs: 0,
      shellRuntime: 'workerd',
      startServerImpl(target) {
        events.push(`start:${target.app.id}`);
        return { async stop() {} };
      },
      startWorkerdProofImpl(options) {
        workerdProofOptions = options;
        events.push('start:workerd');
        return {
          baseUrl: 'http://127.0.0.1:3999',
          targetUrls: {
            inventory: 'http://127.0.0.1:3021',
            'shell-super-app': 'http://127.0.0.1:3999',
          },
          async stop() {},
        };
      },
      timeoutMs: 1_000,
    });

    assert.equal(report.shellRuntime, 'workerd');
    assert.equal(
      report.results.find(result => result.appId === 'shell-super-app').baseUrl,
      'http://127.0.0.1:3999',
    );
    assert.equal(events.includes('start:shell-super-app'), false);
    assert.equal(events.includes('start:workerd'), true);
    assert.equal(workerdProofOptions.requireTargetUrls, true);
    assert.deepEqual(preflightIds, ['inventory', 'shell-super-app']);
    assert.equal(events.includes('start:inventory'), false);
    assert.deepEqual(report.targetRuntimes, {
      inventory: 'workerd',
      'shell-super-app': 'workerd',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('passes route, marker, manifest, and locale HTTP assertions', async () => {
  const { createSmokeTargets, validateHttpTarget } = await loadSmoke();
  const [target] = createSmokeTargets(createContract()).targets;

  const assertions = await validateHttpTarget(target, {
    fetchImpl: createFetch(successRoutes()),
  });

  assert.equal(
    assertions.every(item => item.status === 'pass'),
    true,
  );
  assert.equal(
    assertions.some(item => item.type === 'mf-manifest'),
    true,
  );
});

test('executes configured backend JSON smoke checks against the selected runtime target', async () => {
  const { createSmokeTargets, validateHttpTarget } = await loadSmoke();
  const contract = createContract();
  contract.apps[0].deploy.cloudflare.jsonSmokeChecks = [
    {
      body: { sku: 'TRACTOR-1' },
      expect: { 'item.sku': 'TRACTOR-1' },
      id: 'backend-domain-command',
      method: 'POST',
      route: '/shell-api/command',
    },
  ];
  const [target] = createSmokeTargets(contract).targets;
  let observed;
  const assertions = await validateHttpTarget(target, {
    async fetchImpl(url, init = {}) {
      const pathname = new URL(url).pathname;
      if (pathname === '/shell-api/command') {
        observed = {
          body: init.body,
          contentType: init.headers['content-type'],
          method: init.method,
        };
        return response(200, JSON.stringify({ item: { sku: 'TRACTOR-1' } }));
      }
      return createFetch(successRoutes())(url);
    },
  });

  assert.deepEqual(observed, {
    body: '{"sku":"TRACTOR-1"}',
    contentType: 'application/json',
    method: 'POST',
  });
  assert.equal(
    assertions.find(assertion => assertion.type === 'backend-json-smoke')
      ?.status,
    'pass',
  );
});

test('can omit Cloudflare service-binding JSON checks from Node HTTP validation', async () => {
  const { createSmokeTargets, validateHttpTarget } = await loadSmoke();
  const contract = createContract();
  contract.apps[0].deploy.cloudflare.jsonSmokeChecks = [
    {
      expect: { sku: 'TRACTOR-1' },
      id: 'cloudflare-service-binding-domain-query',
      route: '/inventory-api/inventory/TRACTOR-1',
    },
  ];
  const [target] = createSmokeTargets(contract).targets;
  const requestedPaths = [];
  const assertions = await validateHttpTarget(target, {
    async fetchImpl(url) {
      requestedPaths.push(new URL(url).pathname);
      return createFetch(successRoutes())(url);
    },
    includeCloudflareJsonSmokeChecks: false,
  });

  assert.equal(
    requestedPaths.includes('/inventory-api/inventory/TRACTOR-1'),
    false,
  );
  assert.equal(
    assertions.some(assertion => assertion.type === 'backend-json-smoke'),
    false,
  );
});

test('proves backend-driven UI from a successful API response and rendered item title', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const target = createSmokeTargets(createCompactConfig()).targets.find(
    candidate => candidate.app.id === 'inventory',
  );
  const apiResponseUrl =
    'http://localhost:3021/inventory-api/inventory?limit=1';

  try {
    const assertions = await validateBrowserTarget(
      target,
      createFakeBrowser({
        apiResponseJson: {
          items: [
            {
              title: 'Inventory item from Effect API',
            },
          ],
        },
        apiResponseUrl,
        apiStatus: 'Inventory item from Effect API',
        markerValue: target.app.marker.build,
      }),
      { artifactDir: root },
    );

    assert.deepEqual(
      assertions.find(assertion => assertion.type === 'backend-driven-ui'),
      {
        apiResponse: {
          body: {
            items: [
              {
                title: 'Inventory item from Effect API',
              },
            ],
          },
          expectedValue: 'Inventory item from Effect API',
          status: 200,
          url: apiResponseUrl,
        },
        expectedValue: 'Inventory item from Effect API',
        renderedValue: 'Inventory item from Effect API',
        status: 'pass',
        type: 'backend-driven-ui',
      },
    );
    assert.equal(
      fs.existsSync(path.join(root, 'inventory/backend-driven-ui.json')),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extracts the rendered title from REST and RPC API response JSON', async () => {
  const { extractBackendDrivenTitle } = await import(
    '../browser-smoke/browser-validate.mjs'
  );

  assert.equal(
    extractBackendDrivenTitle({
      items: [{ title: 'REST backend value' }],
    }),
    'REST backend value',
  );
  assert.equal(
    extractBackendDrivenTitle([
      17,
      {
        _tag: 'Success',
        value: {
          items: [{ title: 'RPC backend value' }],
        },
      },
    ]),
    'RPC backend value',
  );
  assert.equal(extractBackendDrivenTitle({ items: [] }), undefined);
});

test('rejects a hardcoded backend-driven UI value that differs from the API response', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const target = createSmokeTargets(createCompactConfig()).targets.find(
    candidate => candidate.app.id === 'inventory',
  );

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            apiResponseJson: {
              items: [{ title: 'Actual backend item' }],
            },
            apiResponseUrl:
              'http://localhost:3021/inventory-api/inventory?limit=1',
            apiStatus: 'Hardcoded UI item',
            markerValue: target.app.marker.build,
          }),
          { artifactDir: root },
        ),
      /did not render the exact backend-provided item title/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('strict runtime evidence fails closed when executed results omit required dimensions', async () => {
  const { assertStrictRuntimeEvidence } = await loadSmoke();
  const { createRuntimeEvidence } = await import(
    '../browser-smoke/runtime-evidence.mjs'
  );
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      dependencies: {
        '@module-federation/bridge-react': '2.8.0',
        '@module-federation/modern-js-v3': '2.8.0',
        '@module-federation/runtime': '2.8.0',
      },
    }),
  );
  const contract = createContract();
  contract.apps.push({
    ...contract.apps[0],
    id: 'inventory',
    kind: 'vertical',
    path: 'verticals/inventory',
  });
  const pass = type => ({ status: 'pass', type });
  const results = [
    {
      appId: 'shell-super-app',
      assertions: [
        pass('ssr-route'),
        pass('mf-manifest'),
        pass('shell-mf-network-evidence'),
      ],
    },
    {
      appId: 'inventory',
      assertions: [
        pass('ssr-route'),
        pass('mf-manifest'),
        pass('effect-readiness'),
        pass('backend-json-smoke'),
        pass('backend-federation-network'),
      ],
    },
  ];

  try {
    const evidence = createRuntimeEvidence({
      artifactMode: 'source',
      contract,
      platform: 'node',
      projectDir: root,
      results,
    });

    assert.equal(evidence.ssr.status, 'pass');
    assert.equal(evidence['browser-mf'].status, 'pass');
    assert.equal(evidence.api.status, 'pass');
    assert.equal(evidence.backend.status, 'pass');
    assert.equal(evidence['backend-driven-ui'].status, 'fail');
    assert.equal(evidence['failure-isolation'].status, 'fail');
    assert.equal(evidence['release-identity'].status, 'fail');
    assert.deepEqual(evidence.ssr.verticalIds, ['inventory']);
    assert.equal(evidence.ssr.artifactMode, 'source');
    assert.equal(evidence.ssr.platform, 'node');
    assert.throws(
      () => assertStrictRuntimeEvidence(evidence),
      /Strict runtime evidence failed: backend-driven-ui, failure-isolation, release-identity/,
      'the standalone strict runner must not report pass when embedded evidence failed',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Node backend evidence accepts only network-loaded federation with executed smoke checks', async () => {
  const { runNodeBackendFederationProof } = await import(
    '../browser-smoke/backend-evidence.mjs'
  );
  const root = tempRoot();
  const reportPath = path.join(
    root,
    '.codex/reports/node-backend-federation-proof/proof.json',
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const report = {
    schemaVersion: 1,
    status: 'pass',
    target: 'dist',
    results: [createNodeBackendProofResult()],
  };
  fs.writeFileSync(reportPath, JSON.stringify(report));

  try {
    let proofEnvironment;
    const [assertion] = runNodeBackendFederationProof({
      artifactDir: path.join(root, 'artifacts'),
      projectDir: root,
      spawnSyncImpl(_command, _args, options) {
        proofEnvironment = options.env;
        return { status: 0, stderr: '', stdout: 'proof passed' };
      },
    });
    assert.equal(assertion.status, 'pass');
    assert.equal(assertion.type, 'backend-federation-network');
    assert.equal(
      proofEnvironment.ULTRAMODERN_NODE_PROOF_SERVER_MODE,
      'existing',
      'the integrated browser harness must remain the only owner of its live Node server processes',
    );

    report.results[0].runtimeEntry =
      'file:///tmp/inventory/backendRemoteEntry.cjs';
    fs.writeFileSync(reportPath, JSON.stringify(report));
    const [fileAssertion] = runNodeBackendFederationProof({
      artifactDir: path.join(root, 'artifacts'),
      projectDir: root,
      spawnSyncImpl() {
        return { status: 0, stderr: '', stdout: 'proof passed' };
      },
    });
    assert.equal(fileAssertion.status, 'fail');

    report.results[0] = {
      appId: 'inventory',
      containerEntry: 'http://localhost:3021/backendRemoteEntry.cjs',
      manifestUrl: 'http://localhost:3021/backend-mf-manifest.json',
      remoteName: 'verticalInventoryBackend',
      runtimeEntry: 'http://localhost:3021/backendRemoteEntry.cjs',
      smokeChecks: [{ status: 'pass' }],
      status: 'pass',
    };
    fs.writeFileSync(reportPath, JSON.stringify(report));
    const [forgedAssertion] = runNodeBackendFederationProof({
      artifactDir: path.join(root, 'artifacts'),
      projectDir: root,
      spawnSyncImpl() {
        return { status: 0, stderr: '', stdout: 'proof passed' };
      },
    });
    assert.equal(forgedAssertion.status, 'fail');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('canonical backend proof shape contract rejects missing live correlation while executed-envelope verification owns digest recomputation', async () => {
  const { validateNodeBackendFederationProofResult } = await import(
    '../browser-smoke/backend-proof-contract.mjs'
  );
  const valid = createNodeBackendProofResult();
  assert.equal(validateNodeBackendFederationProofResult(valid).ok, true);

  const forged = structuredClone(valid);
  delete forged.releaseEnvelope;
  delete forged.liveArtifacts;
  delete forged.liveApi;
  const validation = validateNodeBackendFederationProofResult(forged);
  assert.equal(validation.ok, false);
  assert.match(
    validation.failures.join('\n'),
    /release envelope|live artifact|live API/i,
  );

  const wrongOrigin = createNodeBackendProofResult();
  wrongOrigin.liveApi.url =
    'https://forged.example/inventory-api/inventory/readiness';
  assert.equal(validateNodeBackendFederationProofResult(wrongOrigin).ok, false);

  const traversingEnvelope = createNodeBackendProofResult();
  traversingEnvelope.releaseEnvelope.path =
    '../release/microvertical-release-envelope.json';
  assert.equal(
    validateNodeBackendFederationProofResult(traversingEnvelope).ok,
    false,
  );

  for (const [label, mutate] of [
    [
      'container origin',
      result => {
        result.containerEntry = 'https://forged.example/backendRemoteEntry.cjs';
        result.runtimeEntry = result.containerEntry;
        result.liveArtifacts.container.url = result.containerEntry;
      },
    ],
    [
      'runtime origin',
      result => {
        result.runtimeEntry = 'https://forged.example/backendRemoteEntry.cjs';
      },
    ],
  ]) {
    const crossOrigin = createNodeBackendProofResult();
    mutate(crossOrigin);
    assert.equal(
      validateNodeBackendFederationProofResult(crossOrigin).ok,
      false,
      `${label} must match the manifest and API origin`,
    );
  }

  for (const logicalPath of [
    '/api/index.js',
    String.raw`api\index.js`,
    'shared/config.json',
    'private/runtime.js',
    '',
    '.',
    'api/./index.js',
    'api/../index.js',
    'api/nested/../../outside.js',
  ]) {
    const unsafeArtifactPath = createNodeBackendProofResult();
    unsafeArtifactPath.liveApi.apiBackendArtifacts[0].logicalPath = logicalPath;
    assert.equal(
      validateNodeBackendFederationProofResult(unsafeArtifactPath).ok,
      false,
      `unsafe API artifact path must fail: ${JSON.stringify(logicalPath)}`,
    );
  }

  const malformedDigest = createNodeBackendProofResult();
  malformedDigest.releaseEnvelope.envelopeDigest = 'not-a-sha256';
  malformedDigest.liveApi.envelopeDigest = 'not-a-sha256';
  assert.equal(
    validateNodeBackendFederationProofResult(malformedDigest).ok,
    false,
    'the shape contract must require a SHA-256 reference even though runtime-evidence recomputes it from executed bytes',
  );
});

test('workerd failure isolation injects a real binding outage and proves recovery', async () => {
  const { validateFailureIsolation } = await import(
    '../browser-smoke/failure-isolation.mjs'
  );
  const targets = [
    {
      app: { id: 'inventory', kind: 'vertical' },
      baseUrl: 'http://inventory.test',
      routes: { effectReadiness: '/inventory-api/inventory/readiness' },
    },
    {
      app: { id: 'checkout', kind: 'vertical' },
      baseUrl: 'http://checkout.test',
      routes: { effectReadiness: '/checkout-api/checkout/readiness' },
    },
    {
      app: { id: 'shell', kind: 'shell' },
      baseUrl: 'http://shell.test',
      routes: { distributedSsr: '/en/products/tractor-1', ssr: '/en' },
    },
  ];
  let failedAppId;
  const assertions = await validateFailureIsolation({
    async fetchImpl(url, init = {}) {
      const parsed = new URL(url);
      if (
        parsed.hostname === 'shell.test' &&
        parsed.pathname === '/_ultramodern-proof/service-binding-fault'
      ) {
        const command = JSON.parse(init.body);
        failedAppId = command.failed ? command.appId : undefined;
        return response(200, JSON.stringify({ failed: command.failed }));
      }
      if (
        parsed.hostname === 'shell.test' &&
        parsed.pathname === '/en/products/tractor-1'
      ) {
        const tag = appId =>
          `<div data-modern-distributed-ssr-boundary="${appId}::./Route" data-modern-distributed-ssr-status="${
            appId === failedAppId ? 'degraded' : 'ready'
          }"></div>`;
        return response(200, `${tag('inventory')}${tag('checkout')}`);
      }
      return response(200, JSON.stringify({ status: 'ready' }));
    },
    options: {},
    platform: 'workerd',
    servers: [],
    serversByAppId: new Map(),
    targets,
  });

  assert.equal(assertions.length, 2);
  assert.equal(
    assertions.every(assertion => assertion.status === 'pass'),
    true,
  );
  assert.deepEqual(
    assertions.map(assertion => assertion.appId),
    ['inventory', 'checkout'],
  );
});

test('Node failure isolation stops each real remote process and proves restart recovery', async () => {
  const { validateFailureIsolation } = await import(
    '../browser-smoke/failure-isolation.mjs'
  );
  const targets = [
    {
      app: { id: 'inventory', kind: 'vertical' },
      baseUrl: 'http://inventory.test',
      routes: {
        effectReadiness: '/inventory-api/inventory/readiness',
        mfManifest: '/mf-manifest.json',
        ssr: '/en',
      },
    },
    {
      app: { id: 'checkout', kind: 'vertical' },
      baseUrl: 'http://checkout.test',
      routes: {
        effectReadiness: '/checkout-api/checkout/readiness',
        mfManifest: '/mf-manifest.json',
        ssr: '/en',
      },
    },
    {
      app: { id: 'shell', kind: 'shell' },
      baseUrl: 'http://shell.test',
      routes: { mfManifest: '/mf-manifest.json', ssr: '/en' },
    },
  ];
  const available = new Map([
    ['inventory.test', true],
    ['checkout.test', true],
    ['shell.test', true],
  ]);
  const createServer = target => ({
    exited: new Promise(() => {}),
    logPath: `/tmp/${target.app.id}.log`,
    async stop() {
      available.set(new URL(target.baseUrl).hostname, false);
    },
  });
  const serversByAppId = new Map(
    targets
      .filter(target => target.app.kind === 'vertical')
      .map(target => [target.app.id, createServer(target)]),
  );
  const servers = [...serversByAppId.values()];

  const assertions = await validateFailureIsolation({
    async fetchImpl(url) {
      const parsed = new URL(url);
      if (!available.get(parsed.hostname)) {
        throw new Error(`connect ECONNREFUSED ${parsed.hostname}`);
      }
      return response(
        200,
        parsed.pathname === '/mf-manifest.json'
          ? JSON.stringify({ pluginVersion: '2.8.0' })
          : html(),
      );
    },
    options: { retryDelayMs: 0, timeoutMs: 1_000 },
    platform: 'node',
    servers,
    serversByAppId,
    startServerImpl(target) {
      available.set(new URL(target.baseUrl).hostname, true);
      return createServer(target);
    },
    targets,
  });

  assert.equal(assertions.length, 2);
  assert.equal(
    assertions.every(assertion => assertion.status === 'pass'),
    true,
  );
});

test('release identity evidence verifies the target envelope and its SHA-bound MF manifest', async () => {
  const {
    bindContractToExpectedReleaseIdentities,
    bindContractToReleaseIdentity,
    createRuntimeEvidence,
  } = await import('../browser-smoke/runtime-evidence.mjs');
  const { createBuildMarker, normalizeSmokeContract } = await import(
    '../browser-smoke/contract.mjs'
  );
  const root = tempRoot();
  const appRoot = path.join(root, 'verticals/inventory/.output');
  fs.mkdirSync(path.join(appRoot, 'release'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'verticals/inventory/package.json'),
    JSON.stringify({
      dependencies: {
        '@module-federation/runtime': '2.8.0',
      },
      version: '0.1.0',
    }),
  );
  fs.mkdirSync(path.join(root, 'apps/shell-super-app'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'apps/shell-super-app/package.json'),
    JSON.stringify({ version: '0.1.0' }),
  );
  const artifactBytes = {
    'backend-mf-manifest.json': Buffer.from(
      JSON.stringify({ pluginVersion: '2.8.0' }),
    ),
    'backendRemoteEntry.cjs': Buffer.from('backend'),
    'bundles/ssr.js': Buffer.from('ssr'),
    'mf-manifest.json': Buffer.from(
      JSON.stringify({
        pluginVersion: '2.8.0',
        shared: [
          {
            name: '@module-federation/runtime',
            version: '2.8.0',
          },
        ],
      }),
    ),
    'node_modules/@bleedingdev/runtime/package.json': Buffer.from(
      JSON.stringify({
        name: '@bleedingdev/runtime',
        version: '1.0.0',
      }),
    ),
  };
  for (const [logicalPath, bytes] of Object.entries(artifactBytes)) {
    const artifactPath = path.join(appRoot, logicalPath);
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, bytes);
  }
  const aliasPath = path.join(appRoot, 'node_modules/@modern-js/runtime');
  const aliasTarget = path.join(appRoot, 'node_modules/@bleedingdev/runtime');
  fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
  fs.symlinkSync(
    path.relative(path.dirname(aliasPath), aliasTarget),
    aliasPath,
    'dir',
  );
  const fileArtifacts = Object.entries(artifactBytes).map(
    ([logicalPath, bytes]) => ({
      byteLength: bytes.byteLength,
      kind: 'file',
      logicalPath,
      runtime:
        logicalPath === 'mf-manifest.json'
          ? 'browser'
          : logicalPath === 'bundles/ssr.js' ||
              logicalPath === 'backendRemoteEntry.cjs'
            ? 'nodejs'
            : logicalPath.startsWith('node_modules/')
              ? 'nodejs-deployment'
              : 'module-federation-manifest',
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }),
  );
  const scope = 'proof';
  const inventoryApp = {
    domain: 'inventory',
    id: 'inventory-web',
    kind: 'vertical',
    packageSuffix: 'inventory',
  };
  const shellApp = {
    id: 'shell-super-app',
    kind: 'shell',
    packageSuffix: 'shell-super-app',
  };
  const inventoryGenerationMarker = createBuildMarker(scope, inventoryApp);
  const shellGenerationMarker = createBuildMarker(scope, shellApp);
  const inventoryUnitId = `${scope}/inventory`;
  const shellUnitId = `${scope}/shell-super-app`;
  const sourceRevision = commitFixture(root);
  const inventoryReleaseMarker = releaseBuildMarker(
    inventoryUnitId,
    inventoryGenerationMarker,
    sourceRevision,
  );
  const shellReleaseMarker = releaseBuildMarker(
    shellUnitId,
    shellGenerationMarker,
    sourceRevision,
  );
  const payload = {
    artifacts: [
      ...fileArtifacts,
      {
        kind: 'symbolic-link',
        linkTarget: path.relative(path.dirname(aliasPath), aliasTarget),
        logicalPath: 'node_modules/@modern-js/runtime',
        runtime: 'nodejs-deployment',
        targetKind: 'directory',
        targetLogicalPath: 'node_modules/@bleedingdev/runtime',
      },
    ].sort((left, right) => left.logicalPath.localeCompare(right.logicalPath)),
    identity: {
      buildMarker: inventoryReleaseMarker,
      releaseVersion: '0.1.0',
      sourceRevision,
      unitId: inventoryUnitId,
    },
    kind: 'ultramodern-target-microvertical-release-envelope',
    schemaVersion: 3,
    surfaces: {
      apiBackend: ['backendRemoteEntry.cjs'],
      backendFederation: {
        container: 'backendRemoteEntry.cjs',
        manifest: 'backend-mf-manifest.json',
      },
      ssr: ['bundles/ssr.js'],
      uiClient: ['mf-manifest.json'],
    },
    target: 'node',
  };
  const envelopePath = path.join(
    appRoot,
    'release/microvertical-release-envelope.json',
  );
  const writeEnvelope = candidatePayload => {
    fs.writeFileSync(
      envelopePath,
      JSON.stringify({
        ...candidatePayload,
        envelopeDigest: crypto
          .createHash('sha256')
          .update(canonicalJson(candidatePayload))
          .digest('hex'),
      }),
    );
  };
  writeEnvelope(payload);
  const contract = normalizeSmokeContract({
    workspace: { packageScope: scope },
    topology: {
      apps: [
        {
          ...shellApp,
          deliveryUnit: {
            buildMarker: shellGenerationMarker,
            unitId: shellUnitId,
            version: '0.1.0',
          },
          path: 'apps/shell-super-app',
          port: 3010,
        },
        {
          ...inventoryApp,
          deliveryUnit: {
            buildMarker: inventoryGenerationMarker,
            unitId: inventoryUnitId,
            version: '0.1.0',
          },
          path: 'verticals/inventory',
          port: 3021,
        },
      ],
    },
  });
  const sourceContractSnapshot = structuredClone(contract);

  try {
    const releaseContract = bindContractToReleaseIdentity({
      contract,
      platform: 'node',
      projectDir: root,
    });
    assert.equal(
      releaseContract.apps.find(app => app.id === 'inventory-web').marker.build,
      inventoryReleaseMarker,
      'strict runtime validation must compare live responses with the final release envelope marker',
    );
    assert.equal(
      releaseContract.apps.find(app => app.id === 'shell-super-app').marker
        .build,
      shellReleaseMarker,
      'strict shell validation must derive the promoted marker without requiring a MicroVertical envelope',
    );
    assert.deepEqual(
      contract,
      sourceContractSnapshot,
      'binding the release identity must not mutate any generated source contract field',
    );
    const independentShellRevision = 'b'.repeat(40);
    const mixedRevisionContract = bindContractToExpectedReleaseIdentities({
      contract,
      expectedSourceRevisions: {
        'inventory-web': sourceRevision,
        'shell-super-app': independentShellRevision,
      },
      platform: 'node',
      projectDir: root,
    });
    assert.equal(
      mixedRevisionContract.apps.find(app => app.id === 'inventory-web').marker
        .build,
      inventoryReleaseMarker,
      'an unchanged MicroVertical must bind to its executed C0 envelope',
    );
    assert.equal(
      mixedRevisionContract.apps.find(app => app.id === 'shell-super-app')
        .marker.build,
      releaseBuildMarker(
        shellUnitId,
        shellGenerationMarker,
        independentShellRevision,
      ),
      'independently deployed apps must bind against their own expected source revision',
    );
    const shellContract = {
      ...contract,
      apps: contract.apps.filter(app => app.kind === 'shell'),
    };
    const shellWorkerManifestPath = path.join(
      root,
      'apps/shell-super-app/.output/server/modern-worker-manifest.json',
    );
    fs.mkdirSync(path.dirname(shellWorkerManifestPath), { recursive: true });
    const shellStamp = {
      buildMarker: shellReleaseMarker,
      sourceRevision,
      surfaces: {
        api: {
          buildMarker: shellReleaseMarker,
          sourceRevision,
          surface: 'api',
          unitId: shellUnitId,
        },
        ui: {
          buildMarker: shellReleaseMarker,
          sourceRevision,
          surface: 'ui',
          unitId: shellUnitId,
        },
      },
      unitId: shellUnitId,
    };
    const shellWorkerManifest = { deliveryUnit: shellStamp };
    fs.writeFileSync(
      shellWorkerManifestPath,
      JSON.stringify(shellWorkerManifest),
    );
    const shellWranglerPath = path.join(
      root,
      'apps/shell-super-app/.output/wrangler.json',
    );
    fs.writeFileSync(
      shellWranglerPath,
      JSON.stringify({ main: 'server/index.mjs' }),
    );
    const shellWorkerEntryPath = path.join(
      root,
      'apps/shell-super-app/.output/server/index.mjs',
    );
    const shellWorkerEntry = `const MODERN_WORKER_MANIFEST = ${JSON.stringify(
      shellWorkerManifest,
      null,
      2,
    )};`;
    fs.writeFileSync(shellWorkerEntryPath, shellWorkerEntry);
    assert.equal(
      bindContractToReleaseIdentity({
        contract: shellContract,
        platform: 'workerd',
        projectDir: root,
      }).apps[0].marker.build,
      shellReleaseMarker,
    );
    fs.writeFileSync(
      shellWorkerManifestPath,
      JSON.stringify({
        deliveryUnit: { ...shellStamp, unitId: `${scope}/wrong-shell` },
      }),
    );
    assert.throws(
      () =>
        bindContractToReleaseIdentity({
          contract: shellContract,
          platform: 'workerd',
          projectDir: root,
        }),
      /worker manifest deliveryUnit\.unitId differs/,
    );
    fs.writeFileSync(
      shellWorkerManifestPath,
      JSON.stringify(shellWorkerManifest),
    );
    fs.writeFileSync(
      shellWorkerEntryPath,
      'const MODERN_WORKER_MANIFEST = {};',
    );
    assert.throws(
      () =>
        bindContractToReleaseIdentity({
          contract: shellContract,
          platform: 'workerd',
          projectDir: root,
        }),
      /executed Cloudflare worker entry does not embed its verified worker manifest/,
    );
    fs.writeFileSync(shellWorkerEntryPath, shellWorkerEntry);

    const wrongVersionShell = structuredClone(shellContract);
    wrongVersionShell.apps[0].deliveryUnit.version = '0.2.0';
    assert.throws(
      () =>
        bindContractToReleaseIdentity({
          contract: wrongVersionShell,
          platform: 'node',
          projectDir: root,
        }),
      /differs from its package version/,
    );

    const inventoryContractApp = contract.apps.find(
      app => app.id === 'inventory-web',
    );
    const identitylessInventory = { ...inventoryContractApp };
    delete identitylessInventory.deliveryUnit;
    assert.throws(
      () =>
        bindContractToReleaseIdentity({
          contract: { ...contract, apps: [identitylessInventory] },
          platform: 'node',
          projectDir: root,
        }),
      /strict release binding requires deliveryUnit/,
    );
    const wrongUnitShell = structuredClone(shellContract);
    wrongUnitShell.apps[0].deliveryUnit.unitId = `${scope}/wrong-shell`;
    assert.throws(
      () =>
        bindContractToReleaseIdentity({
          contract: wrongUnitShell,
          platform: 'node',
          projectDir: root,
        }),
      /deliveryUnit\.unitId must be canonical proof\/shell-super-app/,
    );
    const { runUltramodernBrowserSmoke } = await loadSmoke();
    await assert.rejects(
      () =>
        runUltramodernBrowserSmoke({
          artifactMode: 'source',
          contract: {
            apps: [],
            workspace: { packageScope: scope },
          },
          mode: 'local',
          platform: 'node',
          projectDir: root,
        }),
      /Strict release smoke requires one executable target for every contract app/,
      'strict smoke must not convert an empty topology into a successful skipped run',
    );
    await assert.rejects(
      () =>
        runUltramodernBrowserSmoke({
          artifactMode: 'source',
          contract,
          mode: 'local',
          platform: 'workerd',
          projectDir: root,
          shellRuntime: 'node',
        }),
      /shellRuntime to match platform/,
    );
    const dirtyPath = path.join(root, 'dirty-source.txt');
    fs.writeFileSync(dirtyPath, 'dirty');
    assert.throws(
      () =>
        bindContractToReleaseIdentity({
          contract,
          platform: 'node',
          projectDir: root,
        }),
      /clean promotable Git application snapshot/,
      'strict release binding must not silently fall back to generation markers for dirty source',
    );
    fs.rmSync(dirtyPath);

    writeEnvelope({
      ...payload,
      identity: {
        ...payload.identity,
        unitId: `${scope}/orders`,
      },
    });
    assert.throws(
      () =>
        bindContractToReleaseIdentity({
          contract,
          platform: 'node',
          projectDir: root,
        }),
      /release envelope unit proof\/orders differs from its configured delivery unit proof\/inventory/,
      'a validly re-digested envelope from another delivery unit must not become the expected live marker',
    );
    writeEnvelope(payload);

    const evidence = createRuntimeEvidence({
      artifactMode: 'published',
      contract,
      platform: 'node',
      projectDir: root,
      results: [],
    });

    assert.equal(evidence['release-identity'].status, 'pass');
    const expectedIdentity = {
      buildMarker: inventoryReleaseMarker,
      moduleFederation: [
        {
          packageName: '@module-federation/runtime',
          version: '2.8.0',
        },
      ],
      releaseVersion: '0.1.0',
      sourceRevision,
    };
    assert.deepEqual(evidence['release-identity'].apps[0].surfaces, {
      api: expectedIdentity,
      backend: expectedIdentity,
      frontend: expectedIdentity,
      ssr: expectedIdentity,
    });

    const byteIdenticalTarget = path.join(
      appRoot,
      'node_modules/@bleedingdev/runtime-copy',
    );
    fs.cpSync(aliasTarget, byteIdenticalTarget, { recursive: true });
    fs.rmSync(aliasPath);
    fs.symlinkSync(
      path.relative(path.dirname(aliasPath), byteIdenticalTarget),
      aliasPath,
      'dir',
    );
    const reboundAliasEvidence = createRuntimeEvidence({
      artifactMode: 'published',
      contract,
      platform: 'node',
      projectDir: root,
      results: [],
    });
    assert.equal(reboundAliasEvidence['release-identity'].status, 'fail');
    assert.match(
      reboundAliasEvidence['release-identity'].assertions[0].reason,
      /linkTarget|targetLogicalPath/,
    );
    fs.rmSync(aliasPath);
    fs.symlinkSync(
      path.relative(path.dirname(aliasPath), aliasTarget),
      aliasPath,
      'dir',
    );

    fs.writeFileSync(
      path.join(root, 'verticals/inventory/package.json'),
      JSON.stringify({
        dependencies: {
          '@module-federation/runtime': '2.8.0',
        },
        version: '0.2.0',
      }),
    );
    const packageVersionDrift = createRuntimeEvidence({
      artifactMode: 'published',
      contract,
      platform: 'node',
      projectDir: root,
      results: [],
    });
    assert.equal(packageVersionDrift['release-identity'].status, 'fail');
    assert.match(
      packageVersionDrift['release-identity'].assertions[0].reason,
      /differs from its package version/,
    );
    fs.writeFileSync(
      path.join(root, 'verticals/inventory/package.json'),
      JSON.stringify({
        dependencies: {
          '@module-federation/runtime': '2.8.0',
        },
        version: '0.1.0',
      }),
    );

    writeEnvelope({ ...payload, untrusted: true });
    const unknownFieldEvidence = createRuntimeEvidence({
      artifactMode: 'published',
      contract,
      platform: 'node',
      projectDir: root,
      results: [],
    });
    assert.equal(unknownFieldEvidence['release-identity'].status, 'fail');
    assert.match(
      unknownFieldEvidence['release-identity'].assertions[0].reason,
      /invalid fields/,
    );

    writeEnvelope({
      ...payload,
      artifacts: [
        { ...payload.artifacts[0], logicalPath: '../outside.js' },
        ...payload.artifacts.slice(1),
      ],
    });
    const traversalEvidence = createRuntimeEvidence({
      artifactMode: 'published',
      contract,
      platform: 'node',
      projectDir: root,
      results: [],
    });
    assert.equal(traversalEvidence['release-identity'].status, 'fail');
    assert.match(
      traversalEvidence['release-identity'].assertions[0].reason,
      /normalized relative POSIX path/,
    );

    writeEnvelope(payload);
    const outsideManifest = path.join(root, 'outside-mf-manifest.json');
    fs.writeFileSync(outsideManifest, artifactBytes['mf-manifest.json']);
    fs.rmSync(path.join(appRoot, 'mf-manifest.json'));
    fs.symlinkSync(outsideManifest, path.join(appRoot, 'mf-manifest.json'));
    const symlinkEscapeEvidence = createRuntimeEvidence({
      artifactMode: 'published',
      contract,
      platform: 'node',
      projectDir: root,
      results: [],
    });
    assert.equal(symlinkEscapeEvidence['release-identity'].status, 'fail');
    assert.match(
      symlinkEscapeEvidence['release-identity'].assertions[0].reason,
      /escapes target root|non-symlink regular file/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release identity reads only the artifact root executed by workerd', async () => {
  const { createRuntimeEvidence } = await import(
    '../browser-smoke/runtime-evidence.mjs'
  );
  const root = tempRoot();
  const appRoot = path.join(root, 'verticals/inventory');
  fs.mkdirSync(appRoot, { recursive: true });
  fs.writeFileSync(
    path.join(appRoot, 'package.json'),
    JSON.stringify({
      dependencies: {
        '@module-federation/runtime': '2.8.0',
      },
      version: '0.1.0',
    }),
  );
  const artifactBytes = {
    'public/backend-mf-manifest.json': Buffer.from(
      JSON.stringify({ pluginVersion: '2.8.0' }),
    ),
    'public/backendRemoteEntry.cjs': Buffer.from('backend container'),
    'public/mf-manifest.json': Buffer.from(
      JSON.stringify({ pluginVersion: '2.8.0' }),
    ),
    'node_modules/@bleedingdev/runtime/package.json': Buffer.from(
      JSON.stringify({
        name: '@bleedingdev/runtime',
        version: '1.0.0',
      }),
    ),
    'server/index.mjs': Buffer.from('worker main'),
    'worker/__modern_bff_effect.js': Buffer.from('effect api'),
    'worker/index.js': Buffer.from('worker ssr'),
  };
  const aliasLogicalPath = 'node_modules/@modern-js/runtime';
  const aliasTargetLogicalPath = 'node_modules/@bleedingdev/runtime';
  const aliasLinkTarget = path.posix.relative(
    path.posix.dirname(aliasLogicalPath),
    aliasTargetLogicalPath,
  );
  const generationBuildMarker = 'generation-inventory';
  const sourceRevision = 'a'.repeat(40);
  const unitId = 'inventory';
  const payload = {
    artifacts: [
      ...Object.entries(artifactBytes).map(([logicalPath, bytes]) => ({
        byteLength: bytes.byteLength,
        kind: 'file',
        logicalPath,
        runtime:
          logicalPath === 'public/mf-manifest.json'
            ? 'browser'
            : logicalPath === 'public/backend-mf-manifest.json'
              ? 'module-federation-manifest'
              : logicalPath === 'public/backendRemoteEntry.cjs'
                ? 'commonjs-module'
                : logicalPath === 'worker/__modern_bff_effect.js'
                  ? 'workerd-effect'
                  : logicalPath.startsWith('node_modules/')
                    ? 'cloudflare-deployment'
                    : 'workerd',
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      })),
      {
        kind: 'symbolic-link',
        linkTarget: aliasLinkTarget,
        logicalPath: aliasLogicalPath,
        runtime: 'cloudflare-deployment',
        targetKind: 'directory',
        targetLogicalPath: aliasTargetLogicalPath,
      },
    ].sort((left, right) => left.logicalPath.localeCompare(right.logicalPath)),
    identity: {
      buildMarker: releaseBuildMarker(
        unitId,
        generationBuildMarker,
        sourceRevision,
      ),
      releaseVersion: '0.1.0',
      sourceRevision,
      unitId,
    },
    kind: 'ultramodern-target-microvertical-release-envelope',
    schemaVersion: 3,
    surfaces: {
      apiBackend: ['worker/__modern_bff_effect.js'],
      backendFederation: {
        container: 'public/backendRemoteEntry.cjs',
        manifest: 'public/backend-mf-manifest.json',
      },
      ssr: ['server/index.mjs', 'worker/index.js'],
      uiClient: ['public/mf-manifest.json'],
    },
    target: 'cloudflare',
  };
  const envelope = candidatePayload => ({
    ...candidatePayload,
    envelopeDigest: crypto
      .createHash('sha256')
      .update(canonicalJson(candidatePayload))
      .digest('hex'),
  });
  const writeArtifactRoot = outputRoot => {
    for (const [logicalPath, bytes] of Object.entries(artifactBytes)) {
      const artifactPath = path.join(outputRoot, logicalPath);
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      fs.writeFileSync(artifactPath, bytes);
    }
    const aliasPath = path.join(outputRoot, aliasLogicalPath);
    fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
    fs.symlinkSync(aliasLinkTarget, aliasPath, 'dir');
    fs.mkdirSync(path.join(outputRoot, 'release'), { recursive: true });
    fs.writeFileSync(
      path.join(outputRoot, 'release/microvertical-release-envelope.json'),
      JSON.stringify(envelope(payload)),
    );
  };
  const contract = {
    apps: [
      {
        deploy: {
          cloudflare: {
            jsonSmokeChecks: [
              {
                id: 'inventory-readiness-smoke',
                route: '/inventory-api/inventory/readiness',
              },
            ],
          },
        },
        deliveryUnit: {
          buildMarker: generationBuildMarker,
          unitId,
          version: '0.1.0',
        },
        id: 'inventory',
        kind: 'vertical',
        path: 'verticals/inventory',
      },
    ],
  };
  const releaseEvidence = () =>
    createRuntimeEvidence({
      artifactMode: 'source',
      contract,
      platform: 'workerd',
      projectDir: root,
      results: [],
    })['release-identity'];

  try {
    writeArtifactRoot(path.join(appRoot, 'dist-cloudflare'));

    const missingExecutedStage = releaseEvidence();
    assert.equal(missingExecutedStage.status, 'fail');
    assert.match(
      missingExecutedStage.assertions[0].reason,
      /missing.*release envelope in executed artifact root/,
    );

    const executedRoot = path.join(appRoot, '.output');
    writeArtifactRoot(executedRoot);
    const wrongTarget = { ...payload, target: 'node' };
    fs.writeFileSync(
      path.join(executedRoot, 'release/microvertical-release-envelope.json'),
      JSON.stringify(envelope(wrongTarget)),
    );
    const wrongExecutedStage = releaseEvidence();
    assert.equal(wrongExecutedStage.status, 'fail');
    assert.match(
      wrongExecutedStage.assertions[0].reason,
      /executed artifact root contains node release envelope instead of cloudflare/,
    );

    fs.writeFileSync(
      path.join(executedRoot, 'release/microvertical-release-envelope.json'),
      JSON.stringify(envelope(payload)),
    );
    fs.writeFileSync(
      path.join(executedRoot, 'public/mf-manifest.json'),
      'drifted executed bytes',
    );
    const driftedExecutedStage = releaseEvidence();
    assert.equal(driftedExecutedStage.status, 'fail');
    assert.match(
      driftedExecutedStage.assertions[0].reason,
      /release envelope artifact mismatch for public\/mf-manifest\.json/,
    );

    fs.writeFileSync(
      path.join(executedRoot, 'public/mf-manifest.json'),
      artifactBytes['public/mf-manifest.json'],
    );
    const responseBytes = Buffer.from(
      JSON.stringify({
        marker: {
          appId: 'inventory',
          build: payload.identity.buildMarker,
          version: '0.1.0',
        },
        status: 'ready',
      }),
    );
    const response = {
      bodyBase64: responseBytes.toString('base64'),
      byteLength: responseBytes.byteLength,
      releaseMarker: {
        appId: 'inventory',
        build: payload.identity.buildMarker,
        version: '0.1.0',
      },
      sha256: crypto.createHash('sha256').update(responseBytes).digest('hex'),
      status: 200,
    };
    const envelopeDigest = envelope(payload).envelopeDigest;
    const reportPath = path.join(
      root,
      '.codex/reports/cloudflare-workerd-ssr/composition-proof.json',
    );
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const report = {
      apiProofs: [
        {
          appId: 'inventory',
          binding: 'INVENTORY',
          bindingTarget: {
            appId: 'inventory',
            envelopeDigest,
            worker: 'inventory-worker',
          },
          direct: response,
          id: 'inventory-readiness-smoke',
          method: 'GET',
          route: '/inventory-api/inventory/readiness',
          throughShell: response,
        },
      ],
      executions: [
        {
          appId: 'inventory',
          envelopeDigest,
          identity: payload.identity,
          main: 'server/index.mjs',
          modules: [
            'server/index.mjs',
            'worker/__modern_bff_effect.js',
            'worker/index.js',
          ].map(logicalPath => {
            const artifact = payload.artifacts.find(
              candidate => candidate.logicalPath === logicalPath,
            );
            return { ...artifact, type: 'ESModule' };
          }),
          modulesRoot: 'verticals/inventory/.output',
          worker: 'inventory-worker',
        },
      ],
      runtime: 'workerd',
      schemaVersion: 3,
    };
    fs.writeFileSync(reportPath, JSON.stringify(report));
    const validReleaseEvidence = releaseEvidence();
    assert.equal(
      validReleaseEvidence.status,
      'pass',
      JSON.stringify(validReleaseEvidence),
    );

    const validModules = report.executions[0].modules;
    report.executions[0].modules = [
      ...validModules,
      {
        logicalPath: aliasLogicalPath,
        type: 'ESModule',
      },
    ];
    fs.writeFileSync(reportPath, JSON.stringify(report));
    const symbolicLinkExecution = releaseEvidence();
    assert.equal(symbolicLinkExecution.status, 'fail');
    assert.match(
      symbolicLinkExecution.assertions[0].reason,
      /selected workerd module .* is not envelope-bound/,
    );
    report.executions[0].modules = validModules;

    report.apiProofs[0].route = '/inventory-api/inventory/not-configured';
    fs.writeFileSync(reportPath, JSON.stringify(report));
    const mismatchedSmokeCheck = releaseEvidence();
    assert.equal(mismatchedSmokeCheck.status, 'fail');
    assert.match(
      mismatchedSmokeCheck.assertions[0].reason,
      /do not exactly match configured JSON smoke checks/,
    );

    report.apiProofs[0].route = '/inventory-api/inventory/readiness';
    report.apiProofs[0].bindingTarget.envelopeDigest = 'f'.repeat(64);
    fs.writeFileSync(reportPath, JSON.stringify(report));
    const mismatchedRuntimeIdentity = releaseEvidence();
    assert.equal(mismatchedRuntimeIdentity.status, 'fail');
    assert.match(
      mismatchedRuntimeIdentity.assertions[0].reason,
      /service binding is not tied to its Miniflare worker identity/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when the SSR route is not healthy', async () => {
  const { createSmokeTargets, validateHttpTarget } = await loadSmoke();
  const [target] = createSmokeTargets(createContract()).targets;
  const routes = successRoutes();
  routes['/en'] = {
    body: 'broken',
    status: 500,
  };

  await assert.rejects(
    () => validateHttpTarget(target, { fetchImpl: createFetch(routes) }),
    /SSR route returned HTTP 500/,
  );
});

test('fails when the locale asset is missing', async () => {
  const { createSmokeTargets, validateHttpTarget } = await loadSmoke();
  const [target] = createSmokeTargets(createContract()).targets;
  const routes = successRoutes();
  delete routes['/locales/en/shell.json'];

  await assert.rejects(
    () => validateHttpTarget(target, { fetchImpl: createFetch(routes) }),
    /locale JSON returned HTTP 404/,
  );
});

test('fails when the MF manifest is missing', async () => {
  const { createSmokeTargets, validateHttpTarget } = await loadSmoke();
  const [target] = createSmokeTargets(createContract()).targets;
  const routes = successRoutes();
  delete routes['/mf-manifest.json'];

  await assert.rejects(
    () => validateHttpTarget(target, { fetchImpl: createFetch(routes) }),
    /MF manifest returned HTTP 404/,
  );
});

function createFakeBrowser({
  apiResponseJson = {
    items: [{ title: 'Backend item title' }],
  },
  apiResponseUrl,
  apiStatus = 'Backend item title',
  boundaryIds = [],
  boundaryIdsAfterHydration = [],
  boundaryIdsNoJs = boundaryIds,
  boundaryWaitError = false,
  consoleError = false,
  consoleMessages = [],
  degradedDistributedRemoteIds = [],
  globalOnlyBoundaryIds = [],
  hydrationIdentityPreserved = true,
  hydrationProvenanceBoundaryCount,
  hydrationReadyBoundaryCount,
  localizedDomChanges = true,
  localizedHardReload = false,
  localizedLinkCount,
  localizedNavigation = true,
  localizedNavigationLabelChanges = true,
  localizedNavigationPageError = false,
  localizedNavigationSourceLabel = 'Language',
  markerValue = 'build-shell',
  noJavaScriptStylesheetLinks,
  preFederationHydrationStylesheetLinks,
  rejectReadyBoundarySelector = false,
  stylesheetHrefs,
  stylesheetLinks,
} = {}) {
  const handlers = {};
  const contextOptions = [];
  const resolvedStylesheetHrefs = stylesheetHrefs ?? [
    'http://localhost:3020/static/css/app.css',
  ];
  const defaultStylesheetLink = {
    dataChunk: 'shell',
    dataPrecedence: 'default',
    href: 'http://localhost:3020/static/css/app.css',
    outerHTML:
      '<link rel="stylesheet" href="/static/css/app.css" data-chunk="shell" data-precedence="default">',
    parent: { id: '', tagName: 'head' },
    rawHref: '/static/css/app.css',
  };
  const resolvedStylesheetLinks =
    stylesheetLinks ??
    resolvedStylesheetHrefs.map(href => ({
      ...defaultStylesheetLink,
      href,
      outerHTML: `<link rel="stylesheet" href="${href}">`,
      rawHref: href,
    }));
  const resolvedPreFederationHydrationStylesheetLinks =
    preFederationHydrationStylesheetLinks ?? [defaultStylesheetLink];
  const resolvedNoJavaScriptStylesheetLinks = noJavaScriptStylesheetLinks ?? [
    defaultStylesheetLink,
  ];
  const resolvedLocalizedLinkCount =
    localizedLinkCount ?? (localizedNavigation ? 1 : 0);
  let hydrationSettled = false;
  let javaScriptEnabled = true;
  let routeHandler;
  let identityProbeCalls = 0;
  let currentUrl = 'http://localhost:3020/en';
  let htmlLang = 'en';
  let localizedLinkText = 'Czech';
  let localizedNavigationLabel = localizedNavigationSourceLabel;
  let localizedNavigationDocumentPreserved = true;
  const federationUrls = [
    'http://localhost:3021/mf-manifest.json',
    'http://localhost:3021/remoteEntry.js',
    'http://localhost:3021/static/js/exposed-remote.js',
  ];
  const page = {
    async $$eval(selector, mapper) {
      if (selector !== 'link[rel~="stylesheet"]') {
        return mapper([]);
      }
      const stylesheetLinkRecords = !javaScriptEnabled
        ? resolvedNoJavaScriptStylesheetLinks
        : hydrationSettled
          ? resolvedStylesheetLinks
          : resolvedPreFederationHydrationStylesheetLinks;
      return mapper(
        stylesheetLinkRecords.map(record => ({
          getAttribute(name) {
            if (name === 'rel') {
              return 'stylesheet';
            }
            if (name === 'href') {
              return record.rawHref;
            }
            if (name === 'data-chunk') {
              return record.dataChunk ?? null;
            }
            if (name === 'data-precedence') {
              return record.dataPrecedence ?? null;
            }
            return null;
          },
          href: record.href,
          outerHTML: record.outerHTML,
          parentElement: record.parent
            ? {
                getAttribute() {
                  return null;
                },
                id: record.parent.id ?? '',
                tagName: record.parent.tagName.toUpperCase(),
              }
            : null,
          rel: 'stylesheet',
        })),
      );
    },
    locator(selector) {
      return {
        async click() {
          if (
            localizedNavigation &&
            selector === 'a[href="/cs"], a[href$="/cs"]'
          ) {
            currentUrl = new URL('/cs', currentUrl).toString();
            htmlLang = 'cs';
            if (localizedDomChanges) {
              localizedLinkText = 'Čeština';
            }
            if (localizedNavigationLabelChanges) {
              localizedNavigationLabel = 'Jazyk';
            }
            if (localizedHardReload) {
              localizedNavigationDocumentPreserved = false;
            }
            if (localizedNavigationPageError) {
              handlers.pageerror?.(new Error('localized navigation exploded'));
            }
          }
        },
        async count() {
          if (selector === 'a[href="/cs"], a[href$="/cs"]') {
            return resolvedLocalizedLinkCount;
          }
          if (selector.includes('[data-app-id="')) {
            return 1;
          }
          const renderedBoundaryIds = javaScriptEnabled
            ? hydrationSettled
              ? [...boundaryIds, ...boundaryIdsAfterHydration]
              : boundaryIds
            : boundaryIdsNoJs;
          if (
            selector.includes('[data-modern-distributed-ssr-boundary') &&
            globalOnlyBoundaryIds.some(boundaryId =>
              selector.includes(`[data-modern-boundary-id="${boundaryId}"]`),
            )
          ) {
            return 0;
          }
          if (
            selector.includes('data-modern-distributed-ssr-status="ready"') &&
            degradedDistributedRemoteIds.some(remoteId =>
              selector.includes(
                `[data-modern-distributed-ssr-boundary^="${remoteId}::"]`,
              ),
            )
          ) {
            return 0;
          }
          return renderedBoundaryIds.some(boundaryId =>
            selector.includes(`[data-modern-boundary-id="${boundaryId}"]`),
          )
            ? 1
            : 0;
        },
        first() {
          return this;
        },
        async getAttribute(name) {
          if (selector.startsWith('html') && name === 'lang') {
            return htmlLang;
          }
          if (
            selector === 'nav:has(a[href="/cs"], a[href$="/cs"])' &&
            name === 'aria-label'
          ) {
            return localizedNavigationLabel;
          }
          return name === 'data-build-marker' ? markerValue : null;
        },
        async textContent() {
          if (selector === 'a[href="/cs"], a[href$="/cs"]') {
            return localizedLinkText;
          }
          return selector === '[data-testid="api-status"]' ? apiStatus : '';
        },
        async waitFor() {},
      };
    },
    async evaluate(_callback, operation) {
      if (operation === 'install-localized-navigation-continuity') {
        localizedNavigationDocumentPreserved = true;
        return undefined;
      }
      if (operation === 'read-localized-navigation-continuity') {
        return localizedNavigationDocumentPreserved;
      }
      identityProbeCalls += 1;
      if (identityProbeCalls === 1) {
        return {
          boundaryCount: Math.max(boundaryIds.length, 1),
          nodeCount: Math.max(boundaryIds.length, 1) * 3,
        };
      }
      const identityNodeCount = Math.max(boundaryIds.length, 1) * 3;
      return {
        boundaryCount: Math.max(boundaryIds.length, 1),
        connectedNodeCount: hydrationIdentityPreserved
          ? identityNodeCount
          : identityNodeCount - 1,
        nodeCount: identityNodeCount,
        preserved: hydrationIdentityPreserved,
        provenanceBoundaryCount:
          hydrationProvenanceBoundaryCount ??
          (hydrationIdentityPreserved ? Math.max(boundaryIds.length, 1) : 0),
        readyBoundaryCount:
          hydrationReadyBoundaryCount ??
          (hydrationIdentityPreserved ? Math.max(boundaryIds.length, 1) : 0),
        removedNodeCount: hydrationIdentityPreserved ? 0 : 1,
      };
    },
    on(event, handler) {
      handlers[event] = handler;
    },
    async goto(url, options = {}) {
      currentUrl = url;
      htmlLang = new URL(url).pathname.startsWith('/cs') ? 'cs' : 'en';
      for (const message of consoleMessages) {
        handlers.console?.({
          location: () =>
            message.location ?? { url: 'http://localhost:3020/en' },
          text: () => message.text,
          type: () => message.type,
        });
      }
      if (consoleError) {
        handlers.console?.({
          location: () => ({ url: 'http://localhost:3020/en' }),
          text: () => 'boom',
          type: () => 'error',
        });
      }
      if (
        javaScriptEnabled &&
        options.waitUntil === 'commit' &&
        typeof routeHandler === 'function'
      ) {
        for (const url of federationUrls) {
          void routeHandler({
            async continue() {
              handlers.response?.({
                status: () => 200,
                url: () => url,
              });
            },
            request() {
              return { url: () => url };
            },
          });
        }
      }
    },
    async route(_matcher, handler) {
      routeHandler = handler;
    },
    async screenshot({ path: screenshotPath }) {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      fs.writeFileSync(screenshotPath, 'non-empty-screenshot');
    },
    async waitForLoadState() {
      hydrationSettled = true;
    },
    async waitForFunction() {
      if (boundaryWaitError) {
        throw new Error('browser execution context failed');
      }
    },
    async waitForURL(predicate) {
      const url = new URL(currentUrl);
      const matches =
        typeof predicate === 'function'
          ? predicate(url)
          : String(predicate) === currentUrl;
      if (!matches) {
        throw new Error(`URL did not match: ${currentUrl}`);
      }
    },
    async waitForResponse(predicate) {
      const response = {
        json: async () => apiResponseJson,
        status: () => 200,
        url: () => apiResponseUrl,
      };
      assert.equal(predicate(response), true);
      return response;
    },
    async waitForSelector(selector) {
      if (
        rejectReadyBoundarySelector &&
        selector.includes('data-modern-distributed-ssr-status="ready"')
      ) {
        throw new Error(
          'Node native Module Federation SSR does not emit workerd fragment status',
        );
      }
    },
    async waitForTimeout() {},
    async unroute() {
      routeHandler = undefined;
    },
    url() {
      return currentUrl;
    },
  };
  const browser = {
    contextOptions,
    async close() {},
    async newContext(options = {}) {
      contextOptions.push(options);
      javaScriptEnabled = options.javaScriptEnabled !== false;
      return {
        async close() {},
        async newPage() {
          return page;
        },
      };
    },
  };
  return browser;
}

test('finds duplicate hydrated stylesheet hrefs', async () => {
  const { findDuplicateStylesheetHrefs } = await loadSmoke();

  assert.deepEqual(
    findDuplicateStylesheetHrefs([
      'https://shell.example/static/app.css',
      'https://remote.example/static/remote.css',
      'https://shell.example/static/app.css',
    ]),
    [{ count: 2, href: 'https://shell.example/static/app.css' }],
  );
});

test('classifies hashed chunks from an observed remote runtime origin', async () => {
  const { federationAssetKind } = await import(
    '../browser-smoke/browser-validate.mjs'
  );
  const app = {
    moduleFederation: {
      remotes: [{ manifestUrl: 'http://localhost:3021/mf-manifest.json' }],
    },
  };

  assert.equal(
    federationAssetKind(
      'http://127.0.0.1:3121/static/js/async/436.407bc0f633.js',
      app,
      new Set(['http://127.0.0.1:3121']),
    ),
    'exposed-chunk',
  );
});

test('prefers generated app ids for shell composition boundaries', async () => {
  const { remoteBoundaryCandidates } = await loadSmoke();

  assert.deepEqual(
    remoteBoundaryCandidates({
      alias: 'explore',
      id: 'explore',
      name: 'verticalExplore',
    }),
    ['explore', 'verticalExplore'],
  );
});

test('fails unless the shell renders a declared remote boundary', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory', 'finance'],
    remotes: [{ id: 'inventory' }, { id: 'finance' }],
  };

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(target, createFakeBrowser({ boundaryIds: [] }), {
          artifactDir: root,
        }),
      /did not server-render every declared remote boundary/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails unless no-JS shell SSR contains every declared remote boundary', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory', 'finance'],
    remotes: [{ id: 'inventory' }, { id: 'finance' }],
  };

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            boundaryIds: ['inventory', 'finance'],
            boundaryIdsNoJs: ['inventory'],
          }),
          { artifactDir: root },
        ),
      /no-JS SSR did not render every declared remote boundary/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('waits for hydration before checking shell remote boundaries', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory'],
    remotes: [{ id: 'inventory' }],
  };

  try {
    const assertions = await validateBrowserTarget(
      target,
      createFakeBrowser({
        boundaryIds: ['inventory'],
        boundaryIdsNoJs: ['inventory'],
      }),
      { artifactDir: root },
    );

    assert.equal(
      assertions.find(item => item.type === 'shell-composition-boundary')
        ?.status,
      'pass',
    );
    assert.equal(
      assertions.find(item => item.type === 'no-js-shell-composition-boundary')
        ?.status,
      'pass',
    );
    assert.equal(
      assertions.find(item => item.type === 'shell-hydration-dom-identity')
        ?.status,
      'pass',
    );
    assert.equal(
      assertions.find(item => item.type === 'shell-mf-network-evidence')
        ?.status,
      'pass',
    );
    assert.equal(
      fs.existsSync(path.join(root, 'shell-super-app/hydration-identity.json')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(root, 'shell-super-app/federation-network.json')),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('accepts native Node shell SSR without workerd fragment status', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory'],
    remotes: [{ id: 'inventory' }],
  };

  try {
    const assertions = await validateBrowserTarget(
      target,
      createFakeBrowser({
        boundaryIds: ['inventory'],
        boundaryIdsNoJs: ['inventory'],
        rejectReadyBoundarySelector: true,
      }),
      { artifactDir: root, runtime: 'node' },
    );

    assert.equal(
      assertions.find(item => item.type === 'shell-hydration-dom-identity')
        ?.status,
      'pass',
    );
    assert.equal(
      assertions.find(item => item.type === 'no-js-shell-composition-boundary')
        ?.status,
      'pass',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requires every declared remote in server-rendered shell DOM before hydration', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory', 'finance'],
    remotes: [{ id: 'inventory' }, { id: 'finance' }],
  };

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            boundaryIds: ['inventory'],
            boundaryIdsAfterHydration: ['finance'],
            boundaryIdsNoJs: ['inventory', 'finance'],
          }),
          { artifactDir: root, runtime: 'node' },
        ),
      /did not server-render every declared remote boundary/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects global remote markers outside their distributed SSR wrappers', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory'],
    remotes: [{ id: 'inventory' }],
  };

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            boundaryIds: ['inventory'],
            boundaryIdsNoJs: ['inventory'],
            globalOnlyBoundaryIds: ['inventory'],
          }),
          { artifactDir: root, runtime: 'node' },
        ),
      /did not server-render every declared remote boundary/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not swallow shell boundary wait infrastructure failures', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory'],
    remotes: [{ id: 'inventory' }],
  };

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            boundaryIds: ['inventory'],
            boundaryIdsNoJs: ['inventory'],
            boundaryWaitError: true,
          }),
          { artifactDir: root, runtime: 'node' },
        ),
      /browser execution context failed/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps verified fragment readiness mandatory for workerd shell SSR', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory'],
    remotes: [{ id: 'inventory' }],
  };

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            boundaryIds: ['inventory'],
            boundaryIdsNoJs: ['inventory'],
            rejectReadyBoundarySelector: true,
          }),
          { artifactDir: root, runtime: 'workerd' },
        ),
      /does not emit workerd fragment status/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects workerd shell hydration identity without fragment provenance', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory'],
    remotes: [{ id: 'inventory' }],
  };

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            boundaryIds: ['inventory'],
            boundaryIdsNoJs: ['inventory'],
            hydrationProvenanceBoundaryCount: 0,
          }),
          { artifactDir: root, runtime: 'workerd' },
        ),
      /hydration replaced server-rendered remote DOM nodes/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requires a ready workerd distributed SSR wrapper for every remote', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory', 'finance'],
    remotes: [{ id: 'inventory' }, { id: 'finance' }],
  };

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            boundaryIds: ['inventory', 'finance'],
            boundaryIdsNoJs: ['inventory', 'finance'],
            degradedDistributedRemoteIds: ['finance'],
          }),
          { artifactDir: root, runtime: 'workerd' },
        ),
      /did not server-render every declared remote boundary/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when hydration replaces server-rendered remote nodes', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory'],
    remotes: [{ id: 'inventory' }],
  };

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            boundaryIds: ['inventory'],
            hydrationIdentityPreserved: false,
          }),
          { artifactDir: root },
        ),
      /replaced server-rendered remote DOM nodes/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when the browser emits a console error', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({ consoleError: true }),
          {
            artifactDir: root,
          },
        ),
      /emitted browser console errors/,
    );
    assert.equal(
      fs.existsSync(path.join(root, 'shell-super-app/console.json')),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('proves native localized navigation updates the route, html language, and translated DOM', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.domain = 'inventory';
  target.app.id = 'inventory';
  target.app.kind = 'vertical';

  try {
    const assertions = await validateBrowserTarget(
      target,
      createFakeBrowser({ localizedNavigation: true }),
      { artifactDir: root },
    );
    const localizedNavigation = assertions.find(
      item => item.type === 'localized-router-navigation',
    );

    assert.deepEqual(localizedNavigation, {
      documentContinuityPreserved: true,
      source: {
        htmlLang: 'en',
        navigationLabel: 'Language',
        pathname: '/en',
        text: 'Czech',
      },
      status: 'pass',
      target: {
        htmlLang: 'cs',
        navigationLabel: 'Jazyk',
        pathname: '/cs',
        text: 'Čeština',
      },
      type: 'localized-router-navigation',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a vertical that renders no Czech locale navigation link', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.domain = 'inventory';
  target.app.id = 'inventory';
  target.app.kind = 'vertical';

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({ localizedLinkCount: 0 }),
          {
            artifactDir: root,
          },
        ),
      /must render exactly one Czech locale navigation link/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a vertical that renders duplicate Czech locale navigation links', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.domain = 'inventory';
  target.app.id = 'inventory';
  target.app.kind = 'vertical';

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            localizedLinkCount: 2,
            localizedNavigation: true,
          }),
          { artifactDir: root },
        ),
      error =>
        /must render exactly one Czech locale navigation link/u.test(
          error.message,
        ) && error.details?.localizedLinkCount === 2,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects localized navigation when only the route and html language change', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.domain = 'inventory';
  target.app.id = 'inventory';
  target.app.kind = 'vertical';

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            localizedDomChanges: false,
            localizedNavigation: true,
            localizedNavigationLabelChanges: false,
          }),
          { artifactDir: root },
        ),
      /localized navigation did not update translated DOM/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects localized navigation when only the language link text translates', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.domain = 'inventory';
  target.app.id = 'inventory';
  target.app.kind = 'vertical';

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            localizedNavigation: true,
            localizedNavigationLabelChanges: false,
          }),
          { artifactDir: root },
        ),
      /localized navigation did not update the translated navigation label/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects localized navigation without an English navigation label', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.domain = 'inventory';
  target.app.id = 'inventory';
  target.app.kind = 'vertical';

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            localizedNavigationSourceLabel: null,
          }),
          { artifactDir: root },
        ),
      /did not start from rendered English DOM/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects localized navigation that falls back to a full document reload', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.domain = 'inventory';
  target.app.id = 'inventory';
  target.app.kind = 'vertical';

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            localizedHardReload: true,
            localizedNavigation: true,
          }),
          { artifactDir: root },
        ),
      /localized navigation replaced the browser document/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('attributes page errors to localized router navigation immediately', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.domain = 'inventory';
  target.app.id = 'inventory';
  target.app.kind = 'vertical';
  let failure;

  try {
    await validateBrowserTarget(
      target,
      createFakeBrowser({
        localizedNavigation: true,
        localizedNavigationPageError: true,
      }),
      { artifactDir: root },
    ).catch(error => {
      failure = error;
    });

    assert.match(
      failure?.message ?? '',
      /emitted page errors during localized router navigation/u,
    );
    assert.equal(
      failure?.details?.pageErrors?.[0]?.phase,
      'localized-router-navigation',
    );
    assert.equal(
      failure?.details?.pageErrors?.[0]?.url,
      'http://localhost:3020/cs',
    );
    assert.equal(failure?.details?.pageErrors?.[0]?.name, 'Error');

    const persisted = JSON.parse(
      fs.readFileSync(path.join(root, 'inventory/page-errors.json'), 'utf8'),
    );
    assert.equal(persisted[0].phase, 'localized-router-navigation');
    assert.equal(persisted[0].url, 'http://localhost:3020/cs');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ignores browser favicon console noise', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;

  try {
    const assertions = await validateBrowserTarget(
      target,
      createFakeBrowser({
        consoleMessages: [
          {
            location: { url: 'http://localhost:3020/en/favicon.ico' },
            text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
            type: 'error',
          },
        ],
      }),
      {
        artifactDir: root,
      },
    );

    assert.equal(
      assertions.find(item => item.type === 'browser-diagnostics')?.status,
      'pass',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checks SSR output with JavaScript disabled', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory'],
    remotes: [{ id: 'inventory' }],
  };
  const browser = createFakeBrowser({
    boundaryIds: ['inventory'],
    boundaryIdsNoJs: ['inventory'],
  });

  try {
    const assertions = await validateBrowserTarget(target, browser, {
      artifactDir: root,
    });

    assert.equal(
      browser.contextOptions.some(
        options => options.javaScriptEnabled === false,
      ),
      true,
    );
    assert.equal(
      assertions.some(item => item.type === 'no-js-ssr-ui-marker'),
      true,
    );
    assert.equal(
      assertions.some(item => item.type === 'stylesheet-href-dedupe'),
      true,
    );
    assert.equal(
      assertions.some(
        item => item.type === 'pre-federation-hydration-stylesheet-href-dedupe',
      ),
      true,
    );
    assert.equal(
      assertions.some(item => item.type === 'no-js-stylesheet-href-dedupe'),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(root, 'shell-super-app/no-js-failed-responses.json'),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(root, 'shell-super-app/stylesheets.json')),
      true,
    );
    const preFederationHydrationStylesheets = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          'shell-super-app/pre-federation-hydration-stylesheets.json',
        ),
        'utf8',
      ),
    );
    assert.deepEqual(preFederationHydrationStylesheets, [
      {
        dataChunk: 'shell',
        dataPrecedence: 'default',
        href: 'http://localhost:3020/static/css/app.css',
        normalizedHref: 'http://localhost:3020/static/css/app.css',
        outerHTML:
          '<link rel="stylesheet" href="/static/css/app.css" data-chunk="shell" data-precedence="default">',
        parent: { id: '', tagName: 'head' },
        rawHref: '/static/css/app.css',
        rel: 'stylesheet',
      },
    ]);
    assert.equal(
      fs.existsSync(path.join(root, 'shell-super-app/no-js-stylesheets.json')),
      true,
    );
    for (const artifactName of ['no-js-stylesheets.json', 'stylesheets.json']) {
      const stylesheets = JSON.parse(
        fs.readFileSync(
          path.join(root, 'shell-super-app', artifactName),
          'utf8',
        ),
      );
      assert.deepEqual(Object.keys(stylesheets[0]).sort(), [
        'dataChunk',
        'dataPrecedence',
        'href',
        'normalizedHref',
        'outerHTML',
        'parent',
        'rawHref',
        'rel',
      ]);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when pre-federation-hydration stylesheets resolve to a duplicate normalized href', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  target.app.moduleFederation = {
    verticalRefs: ['inventory'],
    remotes: [{ id: 'inventory' }],
  };
  const normalizedHref =
    'http://localhost:3020/static/css/async/async-index.css';

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            boundaryIds: ['inventory'],
            preFederationHydrationStylesheetLinks: [
              {
                href: normalizedHref,
                rawHref: '/static/css/async/async-index.css',
              },
              {
                href: normalizedHref,
                rawHref:
                  'http://localhost:3020/static/css/async/async-index.css',
              },
            ],
          }),
          { artifactDir: root },
        ),
      /rendered duplicate stylesheet links before federated-boundary hydration/,
    );
    const stylesheets = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          'shell-super-app/pre-federation-hydration-stylesheets.json',
        ),
        'utf8',
      ),
    );
    assert.equal(stylesheets.length, 2);
    assert.equal(stylesheets[0].normalizedHref, normalizedHref);
    assert.notEqual(stylesheets[0].rawHref, stylesheets[1].rawHref);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when no-JavaScript stylesheets resolve to a duplicate normalized href', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  const normalizedHref =
    'http://localhost:3020/static/css/async/async-index.css';

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            noJavaScriptStylesheetLinks: [
              {
                href: normalizedHref,
                rawHref: '/static/css/async/async-index.css',
              },
              {
                href: normalizedHref,
                rawHref:
                  'http://localhost:3020/static/css/async/async-index.css',
              },
            ],
          }),
          { artifactDir: root },
        ),
      /rendered duplicate stylesheet links without JavaScript/,
    );
    const stylesheets = JSON.parse(
      fs.readFileSync(
        path.join(root, 'shell-super-app/no-js-stylesheets.json'),
        'utf8',
      ),
    );
    assert.equal(stylesheets.length, 2);
    assert.equal(stylesheets[0].normalizedHref, normalizedHref);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when hydrated stylesheets resolve to a duplicate normalized href', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;
  const normalizedHref =
    'http://localhost:3020/static/css/async/async-index.css';

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            stylesheetLinks: [
              {
                href: normalizedHref,
                rawHref: '/static/css/async/async-index.css',
              },
              {
                href: normalizedHref,
                rawHref:
                  'http://localhost:3020/static/css/async/async-index.css',
              },
            ],
          }),
          {
            artifactDir: root,
          },
        ),
      /rendered duplicate stylesheet links after hydration/,
    );
    const stylesheets = JSON.parse(
      fs.readFileSync(
        path.join(root, 'shell-super-app/stylesheets.json'),
        'utf8',
      ),
    );
    assert.equal(stylesheets.length, 2);
    assert.equal(stylesheets[0].normalizedHref, normalizedHref);
    assert.notEqual(stylesheets[0].rawHref, stylesheets[1].rawHref);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
