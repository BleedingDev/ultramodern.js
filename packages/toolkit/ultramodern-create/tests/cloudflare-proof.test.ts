import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = path.resolve(__dirname, '..');

type CloudflareProofModule = {
  validateApp: (
    app: object,
    publicUrl: string,
  ) => Promise<{ assertions: { type: string; status: string }[] }>;
  resolveModuleFederationPublicPath: (
    publicPath: unknown,
    manifestUrl: URL,
  ) => string | undefined;
};

async function loadCloudflareProofModule() {
  return (await import(
    pathToFileURL(
      path.join(
        packageRoot,
        'templates/workspace-scripts/ultramodern-cloudflare-proof.mjs',
      ),
    ).href
  )) as CloudflareProofModule;
}

const publicUrl = 'https://party.example.test';
const apiOnlyApp = () => ({
  id: 'party',
  marker: { build: 'party-build' },
  deliveryUnit: { unitId: 'app/party', buildMarker: 'party-build' },
  i18n: { namespace: 'party' },
  deploy: {
    cloudflare: {
      routes: {
        mfManifest: '/mf-manifest.json',
        apiReadiness: '/readiness',
      } as Record<string, unknown>,
      serviceBindings: [
        {
          appId: 'party',
          binding: 'PARTY_WORKER',
          route: '/binding',
          expectedMarker: 'party-build',
        },
      ],
      jsonSmokeChecks: [
        { id: 'api', route: '/api', expect: { status: 'ready' } },
      ],
    },
  },
});

async function withResponses(
  run: (requested: string[]) => Promise<void>,
  failedPath?: string,
) {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async input => {
    const route = new URL(String(input)).pathname;
    requested.push(route);
    if (route === failedPath)
      return new Response('unavailable', { status: 503 });
    return Response.json(
      route === '/mf-manifest.json'
        ? { metaData: { publicPath: `${publicUrl}/` } }
        : { marker: { build: 'party-build' }, status: 'ready' },
      { headers: { 'access-control-allow-origin': '*' } },
    );
  };
  try {
    await run(requested);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('API-only proof retains manifest, readiness, service-binding and JSON evidence without invented UI routes', async () => {
  const { validateApp } = await loadCloudflareProofModule();
  await withResponses(async requested => {
    const evidence = await validateApp(apiOnlyApp(), publicUrl);
    assert.deepEqual(requested, [
      '/mf-manifest.json',
      '/readiness',
      '/binding',
      '/api',
    ]);
    for (const type of [
      'mf-manifest',
      'api-marker',
      'delivery-unit-api-marker',
      'service-binding-api-marker',
      'json-smoke-value',
    ]) {
      assert.ok(
        evidence.assertions.some(
          entry => entry.type === type && entry.status === 'pass',
        ),
      );
    }
  });
});

test('API-only proof still fails closed for /mf-manifest.json', async () => {
  const { validateApp } = await loadCloudflareProofModule();
  await withResponses(async () => {
    await assert.rejects(
      validateApp(apiOnlyApp(), publicUrl),
      /MF manifest returned HTTP 503/u,
    );
  }, '/mf-manifest.json');
});

for (const field of ['ssr', 'locale']) {
  test(`declared ${field} remains mandatory independently of other UI routes`, async () => {
    const { validateApp } = await loadCloudflareProofModule();
    const route = field === 'ssr' ? '/en' : '/locales/en/party.json';
    await withResponses(async requested => {
      const app = apiOnlyApp();
      app.deploy.cloudflare.routes[field] = route;
      await assert.rejects(
        validateApp(app, publicUrl),
        field === 'ssr'
          ? /SSR route returned HTTP 503/u
          : /locale JSON returned HTTP 503/u,
      );
      assert.deepEqual(
        requested,
        field === 'ssr' ? [route] : ['/mf-manifest.json', route],
      );
    }, route);
  });

  test(`invalid declared ${field} cannot disable its proof`, async () => {
    const { validateApp } = await loadCloudflareProofModule();
    await withResponses(async requested => {
      const app = apiOnlyApp();
      app.deploy.cloudflare.routes[field] =
        field === 'ssr' ? 'https://foreign.test/' : '/a/../en';
      await assert.rejects(
        validateApp(app, publicUrl),
        /declared .* route must be a root-relative path/u,
      );
      assert.deepEqual(requested, []);
    });
  });
}

test('missing UI routes require an API-only contract without frontend exposes', async () => {
  const { validateApp } = await loadCloudflareProofModule();
  await withResponses(async requested => {
    const app = apiOnlyApp();
    await assert.rejects(
      validateApp(
        { ...app, moduleFederation: { exposes: ['./Page'] } },
        publicUrl,
      ),
      /missing ssr route/u,
    );
    delete app.deploy.cloudflare.routes.apiReadiness;
    await assert.rejects(validateApp(app, publicUrl), /missing ssr route/u);
    assert.deepEqual(requested, []);
  });
});

test('Cloudflare proof resolves MF publicPath values against the manifest URL', async () => {
  const { resolveModuleFederationPublicPath } =
    await loadCloudflareProofModule();
  const manifestUrl = new URL(
    'https://checkout.example.workers.dev/mf-manifest.json',
  );

  assert.equal(
    resolveModuleFederationPublicPath('assets/', manifestUrl),
    'https://checkout.example.workers.dev/assets/',
  );
  assert.equal(resolveModuleFederationPublicPath('', manifestUrl), undefined);
});

async function withAccessToken(
  token: { id?: string; secret?: string },
  run: () => Promise<void>,
) {
  const previous = {
    id: process.env.CF_ACCESS_CLIENT_ID,
    secret: process.env.CF_ACCESS_CLIENT_SECRET,
  };
  const assign = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  assign('CF_ACCESS_CLIENT_ID', token.id);
  assign('CF_ACCESS_CLIENT_SECRET', token.secret);
  try {
    await run();
  } finally {
    assign('CF_ACCESS_CLIENT_ID', previous.id);
    assign('CF_ACCESS_CLIENT_SECRET', previous.secret);
  }
}

test('every probe sends the Cloudflare Access service token when it is set', async () => {
  const { validateApp } = await loadCloudflareProofModule();
  const originalFetch = globalThis.fetch;
  const sent: {
    route: string;
    id: string | null;
    secret: string | null;
    accept: string | null;
  }[] = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const route = new URL(String(input)).pathname;
    sent.push({
      route,
      id: headers.get('cf-access-client-id'),
      secret: headers.get('cf-access-client-secret'),
      accept: headers.get('accept'),
    });
    return Response.json(
      route === '/mf-manifest.json'
        ? { metaData: { publicPath: `${publicUrl}/` } }
        : { marker: { build: 'party-build' }, status: 'ready' },
      { headers: { 'access-control-allow-origin': '*' } },
    );
  };
  try {
    await withAccessToken({ id: 'ci.access', secret: 'ci-secret' }, () =>
      validateApp(apiOnlyApp(), publicUrl).then(() => undefined),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(sent.length, 4);
  for (const request of sent) {
    assert.equal(request.id, 'ci.access');
    assert.equal(request.secret, 'ci-secret');
  }
  assert.equal(
    sent.find(({ route }) => route === '/api')?.accept,
    'application/json',
  );
});

test('a half-set Cloudflare Access service token fails before any probe', async () => {
  const { validateApp } = await loadCloudflareProofModule();
  await withResponses(async requested => {
    await withAccessToken({ id: 'ci.access' }, async () => {
      await assert.rejects(
        validateApp(apiOnlyApp(), publicUrl),
        /Set both CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET/u,
      );
    });
    assert.deepEqual(requested, []);
  });
});

test('the Cloudflare Access service token never follows a redirect to another origin', async () => {
  const { validateApp } = await loadCloudflareProofModule();
  const originalFetch = globalThis.fetch;
  const sent: { url: string; secret: string | null }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    sent.push({
      url: url.href,
      secret: new Headers(init?.headers).get('cf-access-client-secret'),
    });
    if (url.pathname === '/readiness') {
      return new Response(null, {
        status: 302,
        headers: { location: '/ready' },
      });
    }
    if (url.origin === publicUrl && url.pathname === '/api') {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://elsewhere.example.test/api' },
      });
    }
    return Response.json(
      url.pathname === '/mf-manifest.json'
        ? { metaData: { publicPath: `${publicUrl}/` } }
        : { marker: { build: 'party-build' }, status: 'ready' },
      { headers: { 'access-control-allow-origin': '*' } },
    );
  };
  try {
    await withAccessToken({ id: 'ci.access', secret: 'ci-secret' }, () =>
      validateApp(apiOnlyApp(), publicUrl).then(() => undefined),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  const secretFor = (url: string) =>
    sent.find(request => request.url === url)?.secret;
  assert.equal(secretFor(`${publicUrl}/ready`), 'ci-secret');
  assert.equal(secretFor('https://elsewhere.example.test/api'), null);
});
