const assert = require('node:assert/strict');
const fs = require('node:fs');
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
          output: {
            assetPrefix: {
              defaultLocalhostPort: 3020,
              envFallbackOrder: [
                'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
                'SHELL_SUPER_APP_PORT',
              ],
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

function createFakeBrowser({ consoleError = false } = {}) {
  const handlers = {};
  const page = {
    locator(selector) {
      return {
        async click() {},
        async count() {
          return selector.includes('[data-app-id="shell-super-app"]') ? 1 : 0;
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
      if (consoleError) {
        handlers.console?.({
          location: () => ({ url: 'http://localhost:3020/en' }),
          text: () => 'boom',
          type: () => 'error',
        });
      }
    },
    async screenshot() {},
    async waitForSelector() {},
  };
  return {
    async newContext() {
      return {
        async close() {},
        async newPage() {
          return page;
        },
      };
    },
  };
}

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
