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

test('browser smoke reads canonical topology, overlay and app security choices', async t => {
  const { readSmokeContract } = await import('../browser-smoke/contract.mjs');
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  write('package.json', { name: '@fixture/root' });
  write('apps/shell/package.json', {
    name: '@fixture/shell',
    version: '0.2.0',
  });
  write('verticals/inventory/package.json', {
    name: '@fixture/inventory',
    version: '0.3.0',
  });
  write('topology/reference-topology.json', {
    shell: {
      id: 'shell',
      kind: 'shell',
      path: 'apps/shell',
      package: '@fixture/shell',
      verticalRefs: ['inventory'],
      moduleFederation: { role: 'host' },
      cloudflare: {
        workerName: 'custom-shell-worker',
        distributedSsrProofRoutes: ['/cs', '/cs/inventory/example'],
        security: { enabled: true, contentSecurityPolicy: { mode: 'enforce' } },
        routes: { ssr: '/cs' },
      },
    },
    verticals: [
      {
        id: 'inventory',
        kind: 'vertical',
        path: 'verticals/inventory',
        package: '@fixture/inventory',
        api: {
          runtime: 'effect',
          basePath: '/inventory-api/inventory',
          bff: { prefix: '/inventory-api' },
        },
        cloudflare: {
          routes: { apiReadiness: '/inventory-api/inventory/readiness' },
          jsonSmokeChecks: [
            {
              id: 'inventory-ready',
              route: '/inventory-api/inventory/readiness',
            },
          ],
        },
      },
    ],
  });
  write('topology/local-overlays/development.json', {
    ports: { shell: 4100, inventory: 4101 },
  });
  const { contract, contractPath } = readSmokeContract(root);
  assert.equal(
    contractPath,
    path.join(root, 'topology/reference-topology.json'),
  );
  assert.deepEqual(
    contract.apps.map(app => [
      app.id,
      app.config.source.siteUrl.defaultLocalhostPort,
    ]),
    [
      ['shell', 4100],
      ['inventory', 4101],
    ],
  );
  assert.equal(
    contract.apps[0].deploy.cloudflare.workerName,
    'custom-shell-worker',
  );
  assert.equal(
    contract.apps[0].deploy.cloudflare.security.contentSecurityPolicy.mode,
    'enforce',
  );
  assert.equal(contract.apps[0].deploy.cloudflare.routes.ssr, '/cs');
  assert.deepEqual(contract.apps[0].moduleFederation.verticalRefs, [
    'inventory',
  ]);
  assert.deepEqual(
    contract.apps[0].deploy.cloudflare.distributedSsrProofRoutes,
    ['/cs', '/cs/inventory/example'],
  );
  assert.equal(
    contract.apps[1].deploy.cloudflare.jsonSmokeChecks[0].id,
    'inventory-ready',
  );
  assert.equal(
    contract.apps[1].deploy.cloudflare.routes.apiReadiness,
    '/inventory-api/inventory/readiness',
  );
  assert.equal(contract.apps[1].api.protocol, 'rest');
  const rpcTopology = JSON.parse(
    fs.readFileSync(path.join(root, 'topology/reference-topology.json')),
  );
  rpcTopology.verticals[0].api.protocol = 'rpc';
  rpcTopology.verticals[0].cloudflare.routes = {
    rpc: '/inventory-api/rpc',
  };
  write('topology/reference-topology.json', rpcTopology);
  const rpcContract = readSmokeContract(root).contract;
  assert.equal(rpcContract.apps[1].api.protocol, 'rpc');
  assert.equal(
    rpcContract.apps[1].deploy.cloudflare.routes.rpc,
    '/inventory-api/rpc',
  );
  assert.equal(
    fs.existsSync(path.join(root, '.modernjs/ultramodern.json')),
    false,
  );
  write('topology/local-overlays/development.json', {
    ports: { shell: 4100, inventory: 4100 },
  });
  assert.throws(
    () => readSmokeContract(root),
    /unique development overlay port/u,
  );
});

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
  assert.equal(
    parsed.publicUrls['shell-super-app'],
    'https://shell.example.test/',
  );

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

test('shell federation proof matches each remote against its deployed target URL', async () => {
  const { remoteFederationNetworkEvidence } = await import(
    '../browser-smoke/browser-validate.mjs'
  );
  const remotes = [
    { id: 'inventory', manifestUrl: 'http://localhost:4101/mf-manifest.json' },
    { id: 'finance', manifestUrl: 'http://localhost:4102/mf-manifest.json' },
  ];
  const targets = [
    {
      app: { id: 'inventory' },
      baseUrl: 'http://localhost:62924',
      routes: { mfManifest: '/mf-manifest.json' },
    },
    {
      app: { id: 'finance' },
      baseUrl: 'http://localhost:62925',
      routes: { mfManifest: '/mf-manifest.json' },
    },
  ];
  const responses = targets.flatMap(target =>
    [
      ['manifest', '/mf-manifest.json'],
      ['remote-entry', '/remoteEntry.js'],
      ['exposed-chunk', '/static/js/async/__federation_expose_Widget.js'],
    ].map(([kind, route]) => ({
      kind,
      status: 200,
      url: `${target.baseUrl}${route}`,
    })),
  );

  assert.deepEqual(
    remoteFederationNetworkEvidence(remotes, targets, responses).map(remote => [
      remote.manifestUrl,
      remote.status,
    ]),
    [
      ['http://localhost:62924/mf-manifest.json', 'pass'],
      ['http://localhost:62925/mf-manifest.json', 'pass'],
    ],
  );
  assert.equal(
    remoteFederationNetworkEvidence(remotes, targets, responses.slice(0, -1))[1]
      .status,
    'fail',
  );
  assert.equal(
    remoteFederationNetworkEvidence(remotes, targets, [
      ...responses.filter(response => response.kind !== 'manifest'),
      {
        kind: 'manifest',
        status: 200,
        url: 'http://localhost:62924/wrong-mf-manifest.json',
      },
    ])[0].status,
    'fail',
  );
  assert.equal(
    remoteFederationNetworkEvidence(
      [{ id: 'inventory', manifestUrl: 'not-a-url' }],
      targets,
      responses,
    )[0].status,
    'fail',
  );
  assert.equal(
    remoteFederationNetworkEvidence(
      [
        {
          id: 'missing',
          manifestUrl: 'http://localhost:4103/mf-manifest.json',
        },
      ],
      targets,
      responses,
    )[0].status,
    'fail',
  );

  const workerdTargets = targets.map(target => ({
    ...target,
    baseUrl: target.baseUrl.replace('localhost', '127.0.0.1'),
  }));
  assert.deepEqual(
    remoteFederationNetworkEvidence(
      remotes,
      workerdTargets,
      responses,
      'workerd',
    ).map(remote => remote.status),
    ['pass', 'pass'],
  );
  assert.equal(
    remoteFederationNetworkEvidence(remotes, workerdTargets, responses)[0]
      .status,
    'fail',
  );
  const replaceInventoryHost = host =>
    responses.map(response => ({
      ...response,
      url: response.url.replace('localhost:62924', host),
    }));
  assert.equal(
    remoteFederationNetworkEvidence(
      remotes,
      workerdTargets,
      replaceInventoryHost('localhost:62926'),
      'workerd',
    )[0].status,
    'fail',
  );
  assert.equal(
    remoteFederationNetworkEvidence(
      remotes,
      workerdTargets,
      replaceInventoryHost('example.com:62924'),
      'workerd',
    )[0].status,
    'fail',
  );
  assert.equal(
    remoteFederationNetworkEvidence(
      remotes,
      workerdTargets,
      responses.filter(
        response => response.url !== 'http://localhost:62924/mf-manifest.json',
      ),
      'workerd',
    )[0].status,
    'fail',
  );
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

  const crossOrigin = createNodeBackendProofResult();
  crossOrigin.runtimeEntry = 'https://forged.example/backendRemoteEntry.cjs';
  assert.equal(
    validateNodeBackendFederationProofResult(crossOrigin).ok,
    false,
    'the runtime entry must match the manifest and API origin',
  );

  for (const logicalPath of ['/api/index.js', 'api/nested/../../outside.js']) {
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

test('Node backend proof accepts native RPC operations only when live URL, envelope, and backend artifacts remain bound', async () => {
  const { validateNodeBackendFederationProofResult } = await import(
    '../browser-smoke/backend-proof-contract.mjs'
  );
  const valid = createNodeBackendProofResult();
  valid.liveApi = {
    method: 'RPC',
    protocol: 'rpc',
    serialization: 'json',
    group: 'inventory',
    route: '/inventory-api/rpc',
    url: 'http://localhost:3021/inventory-api/rpc',
    operations: [
      { method: 'list', itemId: 'starter-inventory', status: 'pass' },
      { method: 'get', itemId: 'starter-inventory', status: 'pass' },
      {
        method: 'get',
        errorTag: 'InventoryNotFoundRpc',
        missingId: '__missing__',
        status: 'pass',
      },
    ],
    envelopeDigest: valid.releaseEnvelope.envelopeDigest,
    apiBackendArtifacts: valid.liveApi.apiBackendArtifacts,
    status: 'pass',
  };
  valid.smokeChecks[0].method = 'POST';
  valid.smokeChecks[0].route = '/inventory-api/rpc';
  assert.equal(validateNodeBackendFederationProofResult(valid).ok, true);
  for (const mutate of [
    proof => {
      proof.liveApi.operations[2].errorTag = 'OtherNotFoundRpc';
    },
    proof => {
      proof.liveApi.url = 'http://localhost:3022/inventory-api/rpc';
    },
    proof => {
      proof.liveApi.envelopeDigest = 'f'.repeat(64);
    },
    proof => {
      proof.liveApi.apiBackendArtifacts = [];
    },
  ]) {
    const forged = structuredClone(valid);
    mutate(forged);
    assert.equal(validateNodeBackendFederationProofResult(forged).ok, false);
  }
});

test('workerd RPC response evidence requires the declared POST result without inventing a release marker', async () => {
  const { verifyWorkerdResponse } = await import(
    '../browser-smoke/runtime-evidence.mjs'
  );
  const app = {
    id: 'inventory',
    api: { protocol: 'rpc' },
    deploy: { cloudflare: { routes: { rpc: '/inventory-api/rpc' } } },
  };
  const check = {
    method: 'POST',
    route: '/inventory-api/rpc',
    body: {
      jsonrpc: '2.0',
      id: 'inventory-cloudflare-proof',
      method: 'list',
      params: { limit: 1 },
    },
    expect: {
      id: 'inventory-cloudflare-proof',
      'result.items.0.id': 'starter-inventory',
    },
  };
  const evidence = body => {
    const bytes = Buffer.from(JSON.stringify(body));
    return {
      bodyBase64: bytes.toString('base64'),
      byteLength: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      status: 200,
    };
  };
  const response = evidence({
    jsonrpc: '2.0',
    id: check.body.id,
    result: { items: [{ id: 'starter-inventory', title: 'Real RPC item' }] },
  });
  assert.doesNotThrow(() =>
    verifyWorkerdResponse(response, app, {}, 'direct', check),
  );
  assert.throws(
    () =>
      verifyWorkerdResponse(
        evidence({
          jsonrpc: '2.0',
          id: check.body.id,
          result: { items: [{ id: 'other-app' }] },
        }),
        app,
        {},
        'direct',
        check,
      ),
    /declared POST smoke check/u,
  );
  assert.throws(
    () =>
      verifyWorkerdResponse(
        { ...response, releaseMarker: { appId: 'inventory' } },
        app,
        {},
        'direct',
        check,
      ),
    /declared POST smoke check/u,
  );
});

test('workerd API proof requires the actual service binding or an unbound headless worker', async () => {
  const { assertWorkerdApiProofTarget } = await import(
    '../browser-smoke/runtime-evidence.mjs'
  );
  const app = { id: 'inventory', surfaceProfile: 'api-only' };
  const worker = 'fixture-inventory';
  const envelopeDigest = 'a'.repeat(64);
  const target = { appId: app.id, envelopeDigest, worker };
  const direct = { directTarget: target };
  assert.equal(
    assertWorkerdApiProofTarget(direct, app, worker, envelopeDigest),
    'direct',
  );
  assert.throws(
    () => assertWorkerdApiProofTarget(direct, app, worker, 'b'.repeat(64)),
    /not tied to its Miniflare worker identity/u,
  );
  assert.throws(
    () =>
      assertWorkerdApiProofTarget(
        direct,
        { ...app, surfaceProfile: 'full-stack' },
        worker,
        envelopeDigest,
      ),
    /omitted a required service binding/u,
  );
  const binding = { binding: 'VERTICAL_INVENTORY_WORKER', service: worker };
  assert.throws(
    () =>
      assertWorkerdApiProofTarget(direct, app, worker, envelopeDigest, binding),
    /not tied to its Miniflare worker identity/u,
  );
  const bound = {
    binding: binding.binding,
    bindingTarget: target,
    throughShell: { status: 200 },
  };
  assert.equal(
    assertWorkerdApiProofTarget(bound, app, worker, envelopeDigest, binding),
    'service-binding',
  );
  assert.throws(
    () =>
      assertWorkerdApiProofTarget(
        { ...bound, binding: 'OTHER_WORKER' },
        app,
        worker,
        envelopeDigest,
        binding,
      ),
    /does not match its deployed worker configuration/u,
  );
});

test('workerd API evidence correlates each mixed-topology shell with its own binding', async t => {
  const { verifyWorkerdRuntimeCorrelation } = await import(
    '../browser-smoke/runtime-evidence.mjs'
  );
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  const worker = 'fixture-inventory';
  const digest = 'a'.repeat(64);
  const identity = {
    buildMarker: 'fixture',
    releaseVersion: '1',
    sourceRevision: 'abc',
  };
  const check = {
    id: 'rpc-readiness',
    method: 'POST',
    route: '/rpc',
    body: { jsonrpc: '2.0', id: 'proof', method: 'list', params: {} },
    expect: { id: 'proof', 'result.items.0.id': 'item' },
  };
  const app = {
    id: 'inventory',
    path: 'verticals/inventory',
    surfaceProfile: 'api-only',
    api: { protocol: 'rpc' },
    deploy: {
      cloudflare: { routes: { rpc: '/rpc' }, jsonSmokeChecks: [check] },
    },
  };
  const shells = [
    { id: 'shell-ui', path: 'apps/shell-ui', verticalRefs: ['catalog'] },
    { id: 'shell-api', path: 'apps/shell-api', verticalRefs: [] },
  ];
  write('topology/reference-topology.json', {
    shell: shells[0],
    shells: [shells[1]],
  });
  write('apps/shell-ui/.output/wrangler.json', { services: [] });
  const binding = { binding: 'INVENTORY_WORKER', service: worker };
  write('apps/shell-api/.output/wrangler.json', { services: [binding] });
  const body = Buffer.from(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'proof',
      result: { items: [{ id: 'item' }] },
    }),
  );
  const response = {
    bodyBase64: body.toString('base64'),
    byteLength: body.length,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    status: 200,
  };
  const target = { appId: app.id, envelopeDigest: digest, worker };
  const modules = [
    {
      logicalPath: 'server/index.mjs',
      byteLength: 1,
      sha256: 'b'.repeat(64),
      type: 'ESModule',
    },
    {
      logicalPath: 'worker/__modern_bff_effect.js',
      byteLength: 1,
      sha256: 'c'.repeat(64),
      type: 'ESModule',
    },
  ];
  const report = {
    schemaVersion: 3,
    runtime: 'workerd',
    executions: [
      {
        appId: app.id,
        modulesRoot: 'verticals/inventory/.output',
        envelopeDigest: digest,
        identity,
        worker,
        main: 'server/index.mjs',
        modules,
      },
    ],
    apiProofs: [
      {
        ...check,
        appId: app.id,
        shellId: 'shell-ui',
        directTarget: target,
        direct: response,
      },
      {
        ...check,
        appId: app.id,
        shellId: 'shell-api',
        binding: binding.binding,
        bindingTarget: target,
        direct: response,
        throughShell: response,
      },
    ],
  };
  const reportPath =
    '.codex/reports/cloudflare-workerd-ssr/composition-proof.json';
  const location = {
    envelope: {
      envelopeDigest: digest,
      identity,
      artifacts: modules.map(({ logicalPath, byteLength, sha256 }) => ({
        logicalPath,
        byteLength,
        sha256,
        kind: 'file',
      })),
      surfaces: {
        uiClient: [],
        ssr: [],
        apiBackend: ['worker/__modern_bff_effect.js'],
      },
    },
  };
  write(reportPath, report);
  assert.equal(
    verifyWorkerdRuntimeCorrelation(root, app, location).apiProofCount,
    2,
  );
  write('apps/shell-api/.output/wrangler.json', { services: [] });
  assert.throws(
    () => verifyWorkerdRuntimeCorrelation(root, app, location),
    /not tied to its Miniflare worker identity/u,
  );
  write('apps/shell-api/.output/wrangler.json', { services: [binding] });
  write(reportPath, {
    ...report,
    apiProofs: [
      report.apiProofs[0],
      { ...report.apiProofs[1], shellId: 'shell-ui' },
    ],
  });
  assert.throws(
    () => verifyWorkerdRuntimeCorrelation(root, app, location),
    /do not exactly match configured shell JSON smoke checks/u,
  );
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

test('finds duplicate stylesheet hrefs in browser validation', async () => {
  const { findDuplicateStylesheetHrefs } = await loadSmoke();
  const duplicateHref = 'https://shell.example/static/app.css';

  assert.deepEqual(
    findDuplicateStylesheetHrefs([
      duplicateHref,
      'https://remote.example/static/remote.css',
      duplicateHref,
    ]),
    [{ count: 2, href: duplicateHref }],
  );
});
