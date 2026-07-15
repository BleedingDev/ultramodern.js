const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function loadSmoke() {
  return import('../run-browser-smoke.mjs');
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-browser-smoke-'));
}

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

  await assert.rejects(
    () =>
      waitForTarget(target, {
        fetchImpl: async () => new Promise(() => {}),
        retryDelayMs: 1,
        serverExit: Promise.resolve({ exitCode: 1, signal: null }),
        serverLogPath: '/tmp/shell-serve.log',
        timeoutMs: 1_000,
      }),
    error => {
      assert.match(error.message, /serve process exited before readiness/);
      assert.equal(error.details.exitCode, 1);
      assert.equal(error.details.logPath, '/tmp/shell-serve.log');
      return true;
    },
  );
});

test('rejects occupied local smoke ports before startup', async () => {
  const { assertLocalPortsAvailable } = await loadSmoke();
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, resolve));
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
  boundaryIds = [],
  consoleError = false,
  consoleMessages = [],
  stylesheetHrefs,
} = {}) {
  const handlers = {};
  const contextOptions = [];
  const resolvedStylesheetHrefs = stylesheetHrefs ?? [
    'http://localhost:3020/static/css/app.css',
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
          if (selector.includes('[data-app-id="shell-super-app"]')) {
            return 1;
          }
          return boundaryIds.some(boundaryId =>
            selector.includes(`[data-modern-boundary-id="${boundaryId}"]`),
          )
            ? 1
            : 0;
        },
        first() {
          return this;
        },
        async getAttribute(name) {
          return name === 'data-build-marker' ? 'build-shell' : null;
        },
      };
    },
    on(event, handler) {
      handlers[event] = handler;
    },
    async goto() {
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
    },
    async screenshot({ path: screenshotPath }) {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      fs.writeFileSync(screenshotPath, 'non-empty-screenshot');
    },
    async waitForLoadState() {},
    async waitForSelector() {},
    async waitForTimeout() {},
  };
  const browser = {
    contextOptions,
    async close() {},
    async newContext(options = {}) {
      contextOptions.push(options);
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

test('fails unless the shell renders every declared remote boundary', async () => {
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
          createFakeBrowser({ boundaryIds: ['inventory'] }),
          { artifactDir: root },
        ),
      /did not render every declared remote boundary/,
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
