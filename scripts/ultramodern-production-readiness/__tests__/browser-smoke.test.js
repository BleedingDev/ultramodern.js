const assert = require('node:assert/strict');
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

test('creates smoke targets from the compact UltraModern config', async () => {
  const { createSmokeTargets, orderTargetsForLocalStartup } = await loadSmoke();
  const { targets } = createSmokeTargets(createCompactConfig());

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
});

test('parses browser smoke CLI options with stable validation behavior', async () => {
  const { parseArgs } = await loadSmoke();
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
      startWorkerdProofImpl() {
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
    const [assertion] = runNodeBackendFederationProof({
      artifactDir: path.join(root, 'artifacts'),
      projectDir: root,
      spawnSyncImpl() {
        return { status: 0, stderr: '', stdout: 'proof passed' };
      },
    });
    assert.equal(assertion.status, 'pass');
    assert.equal(assertion.type, 'backend-federation-network');

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
  const { createRuntimeEvidence } = await import(
    '../browser-smoke/runtime-evidence.mjs'
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
  };
  for (const [logicalPath, bytes] of Object.entries(artifactBytes)) {
    const artifactPath = path.join(appRoot, logicalPath);
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, bytes);
  }
  const payload = {
    artifacts: Object.entries(artifactBytes).map(([logicalPath, bytes]) => ({
      byteLength: bytes.byteLength,
      logicalPath,
      runtime:
        logicalPath === 'mf-manifest.json'
          ? 'browser'
          : logicalPath === 'bundles/ssr.js' ||
              logicalPath === 'backendRemoteEntry.cjs'
            ? 'nodejs'
            : 'module-federation-manifest',
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    })),
    identity: {
      buildMarker: 'build-inventory',
      releaseVersion: '0.1.0',
      sourceRevision: 'a'.repeat(40),
      unitId: 'inventory',
    },
    kind: 'ultramodern-target-microvertical-release-envelope',
    schemaVersion: 2,
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
  const contract = {
    apps: [
      {
        id: 'inventory',
        kind: 'vertical',
        path: 'verticals/inventory',
      },
    ],
  };

  try {
    const evidence = createRuntimeEvidence({
      artifactMode: 'published',
      contract,
      platform: 'node',
      projectDir: root,
      results: [],
    });

    assert.equal(evidence['release-identity'].status, 'pass');
    const expectedIdentity = {
      buildMarker: 'build-inventory',
      moduleFederation: [
        {
          packageName: '@module-federation/runtime',
          version: '2.8.0',
        },
      ],
      releaseVersion: '0.1.0',
      sourceRevision: 'a'.repeat(40),
    };
    assert.deepEqual(evidence['release-identity'].apps[0].surfaces, {
      api: expectedIdentity,
      backend: expectedIdentity,
      frontend: expectedIdentity,
      ssr: expectedIdentity,
    });

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
      /escapes target root/,
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
    'server/index.mjs': Buffer.from('worker main'),
    'worker/__modern_bff_effect.js': Buffer.from('effect api'),
    'worker/index.js': Buffer.from('worker ssr'),
  };
  const payload = {
    artifacts: Object.entries(artifactBytes).map(([logicalPath, bytes]) => ({
      byteLength: bytes.byteLength,
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
                : 'workerd',
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    })),
    identity: {
      buildMarker: 'build-inventory',
      releaseVersion: '0.1.0',
      sourceRevision: 'a'.repeat(40),
      unitId: 'inventory',
    },
    kind: 'ultramodern-target-microvertical-release-envelope',
    schemaVersion: 2,
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
          build: 'build-inventory',
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
        build: 'build-inventory',
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
    assert.equal(releaseEvidence().status, 'pass');

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
  consoleError = false,
  consoleMessages = [],
  hydrationIdentityPreserved = true,
  markerValue = 'build-shell',
  stylesheetHrefs,
} = {}) {
  const handlers = {};
  const contextOptions = [];
  const resolvedStylesheetHrefs = stylesheetHrefs ?? [
    'http://localhost:3020/static/css/app.css',
  ];
  let hydrationSettled = false;
  let javaScriptEnabled = true;
  let routeHandler;
  let identityProbeCalls = 0;
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
      return mapper(
        resolvedStylesheetHrefs.map(href => ({
          getAttribute(name) {
            return name === 'rel' ? 'stylesheet' : null;
          },
          href,
          rel: 'stylesheet',
        })),
      );
    },
    locator(selector) {
      return {
        async click() {},
        async count() {
          if (selector.includes('[data-app-id="')) {
            return 1;
          }
          const renderedBoundaryIds = javaScriptEnabled
            ? hydrationSettled
              ? [...boundaryIds, ...boundaryIdsAfterHydration]
              : boundaryIds
            : boundaryIdsNoJs;
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
          return name === 'data-build-marker' ? markerValue : null;
        },
        async textContent() {
          return selector === '[data-testid="api-status"]' ? apiStatus : '';
        },
        async waitFor() {},
      };
    },
    async evaluate() {
      identityProbeCalls += 1;
      if (identityProbeCalls === 1) {
        return { boundaryCount: 1, nodeCount: 3 };
      }
      return {
        boundaryCount: 1,
        connectedNodeCount: hydrationIdentityPreserved ? 3 : 2,
        nodeCount: 3,
        preserved: hydrationIdentityPreserved,
        provenanceBoundaryCount: hydrationIdentityPreserved ? 1 : 0,
        readyBoundaryCount: hydrationIdentityPreserved ? 1 : 0,
        removedNodeCount: hydrationIdentityPreserved ? 0 : 1,
      };
    },
    on(event, handler) {
      handlers[event] = handler;
    },
    async goto(_url, options = {}) {
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
    async waitForFunction() {},
    async waitForResponse(predicate) {
      const response = {
        json: async () => apiResponseJson,
        status: () => 200,
        url: () => apiResponseUrl,
      };
      assert.equal(predicate(response), true);
      return response;
    },
    async waitForSelector() {},
    async waitForTimeout() {},
    async unroute() {
      routeHandler = undefined;
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
      /did not render a declared remote boundary/,
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
            boundaryIdsAfterHydration: ['inventory', 'finance'],
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
        boundaryIdsAfterHydration: ['inventory'],
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
  const browser = createFakeBrowser();

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
      fs.existsSync(
        path.join(root, 'shell-super-app/no-js-failed-responses.json'),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(root, 'shell-super-app/stylesheets.json')),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when hydrated stylesheets contain duplicate hrefs', async () => {
  const { createSmokeTargets, validateBrowserTarget } = await loadSmoke();
  const root = tempRoot();
  const [target] = createSmokeTargets(createContract()).targets;

  try {
    await assert.rejects(
      () =>
        validateBrowserTarget(
          target,
          createFakeBrowser({
            stylesheetHrefs: [
              'http://localhost:3020/static/css/async/async-index.css',
              'http://localhost:3020/static/css/async/async-index.css',
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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
