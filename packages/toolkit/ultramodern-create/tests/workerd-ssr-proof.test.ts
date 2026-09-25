import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = path.resolve(__dirname, '..');
const templatePath = path.join(
  packageRoot,
  'templates/workspace-scripts/proof-workerd-ssr.mjs',
);

type ProofPlan = {
  id: string;
  kind: 'shell' | 'vertical';
  apiOnly: boolean;
  ssrRoutes: string[];
  serverRenderedRoutes: string[];
  serverRenderedRemoteIds: string[];
  verticalRefs: string[];
};

async function loadPlanner() {
  const module = (await import(pathToFileURL(templatePath).href)) as {
    planWorkerdSsrProof: (topology: unknown) => {
      plans: ProofPlan[];
    };
  };
  return module.planWorkerdSsrProof;
}

type TopologyShell = Record<string, unknown> & {
  cloudflare?: Record<string, unknown>;
};

const shell = (cloudflare: Record<string, unknown> = {}): TopologyShell => ({
  id: 'shell',
  kind: 'shell',
  path: 'apps/shell',
  verticalRefs: ['contacts', 'catalog'],
  cloudflare: { routes: { ssr: '/en' }, ...cloudflare },
});
const contacts = {
  id: 'contacts',
  kind: 'vertical',
  path: 'verticals/contacts',
  moduleFederation: { exposes: ['./Route', './Widget'] },
  cloudflare: {
    routes: { ssr: '/en/contacts' },
    distributedSsrProofRoutes: ['/en/contacts', '/en/contacts/new'],
  },
};
const catalog = {
  id: 'catalog',
  kind: 'vertical',
  path: 'verticals/catalog',
  moduleFederation: { exposes: ['./Route'] },
  cloudflare: { routes: { ssr: '/en' } },
};
const pricing = {
  id: 'pricing',
  kind: 'vertical',
  path: 'verticals/pricing',
  surfaceProfile: 'api-only',
  moduleFederation: { exposes: [] },
  cloudflare: { routes: { apiReadiness: '/pricing-api/readiness' } },
};
const topology = (shellApp: TopologyShell) => ({
  schemaVersion: 1,
  shell: shellApp,
  verticals: [contacts, catalog, pricing],
});
const planFor = (plans: ProofPlan[], id: string) => {
  const plan = plans.find(candidate => candidate.id === id);
  assert.ok(plan, id);
  return plan;
};

describe('workerd SSR proof topology planning', () => {
  test('reads every app route from cloudflare.routes.ssr instead of a hard-coded locale', async () => {
    const planWorkerdSsrProof = await loadPlanner();
    const { plans } = planWorkerdSsrProof(topology(shell()));

    assert.deepEqual(planFor(plans, 'shell').ssrRoutes, ['/en']);
    assert.deepEqual(planFor(plans, 'contacts').ssrRoutes, [
      '/en/contacts',
      '/en/contacts/new',
    ]);
    assert.deepEqual(planFor(plans, 'catalog').ssrRoutes, ['/en']);
    assert.deepEqual(planFor(plans, 'pricing').ssrRoutes, []);
    assert.equal(planFor(plans, 'pricing').apiOnly, true);
  });

  test('requires shell boundaries only for remotes that declare a distributed SSR expose', async () => {
    const planWorkerdSsrProof = await loadPlanner();
    const shellPlan = planFor(
      planWorkerdSsrProof(topology(shell())).plans,
      'shell',
    );

    // The shell composes on its SSR route by default; catalog only exposes
    // its page route, so it is proven on its own Worker instead.
    assert.deepEqual(shellPlan.serverRenderedRoutes, ['/en']);
    assert.deepEqual(shellPlan.serverRenderedRemoteIds, ['contacts']);
    assert.deepEqual(shellPlan.verticalRefs, ['contacts', 'catalog']);
  });

  test('declared distributed SSR routes replace the shell composition route', async () => {
    const planWorkerdSsrProof = await loadPlanner();
    const shellPlan = planFor(
      planWorkerdSsrProof(
        topology(shell({ distributedSsrProofRoutes: ['/en/home'] })),
      ).plans,
      'shell',
    );

    assert.deepEqual(shellPlan.serverRenderedRoutes, ['/en/home']);
    assert.deepEqual(shellPlan.ssrRoutes, ['/en/home', '/en']);
    // A malformed list must not read as the client-composed [] declaration.
    assert.throws(
      () =>
        planWorkerdSsrProof(
          topology(shell({ distributedSsrProofRoutes: ['en'] })),
        ),
      /shell cloudflare\.distributedSsrProofRoutes must list unique absolute routes/u,
    );
  });

  test('an empty distributed SSR route list declares a client-composed shell', async () => {
    const planWorkerdSsrProof = await loadPlanner();
    const shellPlan = planFor(
      planWorkerdSsrProof(topology(shell({ distributedSsrProofRoutes: [] })))
        .plans,
      'shell',
    );

    assert.deepEqual(shellPlan.serverRenderedRoutes, []);
    assert.deepEqual(shellPlan.serverRenderedRemoteIds, []);
    assert.deepEqual(shellPlan.ssrRoutes, ['/en']);
  });

  test('rejects UI apps without an SSR route and dangling vertical refs', async () => {
    const planWorkerdSsrProof = await loadPlanner();

    assert.throws(
      () =>
        planWorkerdSsrProof({
          ...topology(shell()),
          verticals: [{ ...catalog, cloudflare: {} }, contacts, pricing],
        }),
      /catalog declares no cloudflare\.routes\.ssr/u,
    );
    assert.throws(
      () =>
        planWorkerdSsrProof({
          ...topology(shell()),
          verticals: [
            {
              ...catalog,
              cloudflare: { distributedSsrProofRoutes: ['/en'] },
            },
            contacts,
            pricing,
          ],
        }),
      /catalog declares no cloudflare\.routes\.ssr/u,
    );
    assert.throws(
      () =>
        planWorkerdSsrProof(
          topology({ ...shell(), verticalRefs: ['contacts', 'missing'] }),
        ),
      /shell references missing MicroVertical missing/u,
    );
    assert.throws(
      () =>
        planWorkerdSsrProof(
          topology({ ...shell(), kind: 'vertical', verticalRefs: [] }),
        ),
      /Workerd SSR proof requires at least one shell/u,
    );
    assert.throws(
      () =>
        planWorkerdSsrProof({ schemaVersion: 1, shell: null, verticals: [] }),
      /Invalid topology\/reference-topology\.json/u,
    );
  });
});

const sha256 = (bytes: Buffer) =>
  crypto.createHash('sha256').update(bytes).digest('hex');
const writeFile = (filePath: string, content: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

// The shell renders the contacts Widget boundary only when RENDER_BOUNDARY is
// set, composing it through its CONTACTS service binding like the framework.
const shellWorker = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/contacts-api')) {
      return env.CONTACTS.fetch(request);
    }
    if (env.GREETING !== 'hello') {
      return new Response('wrangler vars were not bound', { status: 500 });
    }
    let boundary = '';
    if (env.RENDER_BOUNDARY === '1') {
      const fragment = await env.CONTACTS.fetch('https://contacts.invalid/en/_mf/fragment/widget', {
        headers: {
          'x-modern-js-fragment-request': '1',
          'x-modern-distributed-ssr-boundary-id': 'contacts-widget',
          'x-modern-distributed-ssr-expose': './Widget',
          'x-modern-distributed-ssr-props': encodeURIComponent('{}'),
          'x-modern-distributed-ssr-remote': 'contacts',
          'x-modern-distributed-ssr-source-url': url.href,
        },
      });
      boundary = '<section data-modern-distributed-ssr-boundary="contacts::./Widget" data-modern-distributed-ssr-status="ready" data-modern-distributed-ssr-build="b1" data-modern-distributed-ssr-digest="' + 'a'.repeat(64) + '">' + (await fragment.text()) + '</section>';
    }
    return new Response('<html><body data-greeting="' + env.GREETING + '">' + boundary + '</body></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
};
`;
const contactsWorker = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/contacts-api/readiness') {
      return Response.json({ status: 'ready', secretConfigured: env.PROOF_SECRET === 'local', marker: { appId: 'contacts', build: 'b1', version: '1.0.0' } });
    }
    if (url.pathname === '/en/_mf/fragment/widget') {
      return new Response('<div>widget</div>', { headers: { 'content-type': 'text/html' } });
    }
    if (url.pathname === '/en/contacts') {
      return new Response('<html><body>contacts</body></html>', { headers: { 'content-type': 'text/html' } });
    }
    return new Response('not found', { status: 404 });
  },
};
`;

function createFixtureWorkspace(options: {
  renderBoundary: boolean;
  shellCloudflare?: Record<string, unknown>;
}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-workerd-ssr-proof-')),
  );
  const shellOutput = path.join(root, 'apps/shell/.output');
  const contactsOutput = path.join(root, 'verticals/contacts/.output');
  writeFile(
    path.join(root, 'topology/reference-topology.json'),
    JSON.stringify({
      schemaVersion: 1,
      shell: {
        id: 'shell',
        kind: 'shell',
        path: 'apps/shell',
        portEnv: 'SHELL_PORT',
        verticalRefs: ['contacts'],
        cloudflare: {
          routes: { ssr: '/en' },
          ...options.shellCloudflare,
        },
      },
      verticals: [
        {
          id: 'contacts',
          kind: 'vertical',
          path: 'verticals/contacts',
          deliveryUnit: { unitId: 'app/contacts' },
          moduleFederation: { exposes: ['./Route', './Widget'] },
          api: { bff: { prefix: '/contacts-api' } },
          cloudflare: {
            routes: { ssr: '/en/contacts' },
            jsonSmokeChecks: [
              { id: 'ready', route: '/contacts-api/readiness' },
            ],
          },
        },
      ],
    }),
  );
  writeFile(
    path.join(root, 'topology/local-overlays/development.json'),
    JSON.stringify({ ports: { shell: 3020, contacts: 4102 } }),
  );
  const wrangler = (name: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      name,
      main: 'server/index.mjs',
      compatibility_date: '2026-06-02',
      compatibility_flags: ['nodejs_compat'],
      assets: { binding: 'ASSETS', directory: './public' },
      ...extra,
    });
  writeFile(
    path.join(shellOutput, 'wrangler.json'),
    wrangler('app-shell', {
      services: [{ binding: 'CONTACTS', service: 'app-contacts' }],
      vars: {
        GREETING: 'hello',
        RENDER_BOUNDARY: options.renderBoundary ? '1' : '0',
      },
    }),
  );
  writeFile(path.join(shellOutput, 'server/index.mjs'), shellWorker);
  writeFile(path.join(shellOutput, 'public/.keep'), '');
  writeFile(
    path.join(contactsOutput, 'wrangler.json'),
    wrangler('app-contacts'),
  );
  writeFile(path.join(contactsOutput, 'server/index.mjs'), contactsWorker);
  writeFile(path.join(contactsOutput, 'public/.keep'), '');
  writeFile(path.join(contactsOutput, '.dev.vars'), 'PROOF_SECRET=local\n');
  const workerBytes = fs.readFileSync(
    path.join(contactsOutput, 'server/index.mjs'),
  );
  writeFile(
    path.join(contactsOutput, 'release/microvertical-release-envelope.json'),
    JSON.stringify({
      schemaVersion: 3,
      target: 'cloudflare',
      envelopeDigest: 'b'.repeat(64),
      identity: {
        unitId: 'app/contacts',
        buildMarker: 'b1',
        releaseVersion: '1.0.0',
      },
      artifacts: [
        {
          logicalPath: 'server/index.mjs',
          kind: 'file',
          byteLength: workerBytes.byteLength,
          sha256: sha256(workerBytes),
          runtime: 'workerd',
        },
      ],
      surfaces: {
        ssr: ['server/index.mjs'],
        apiBackend: ['server/index.mjs'],
      },
    }),
  );
  return root;
}

function runProof(root: string) {
  const result = spawnSync(process.execPath, [templatePath], {
    cwd: root,
    env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: root },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function readReport(root: string) {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        '.codex/reports/cloudflare-workerd-ssr/composition-proof.json',
      ),
      'utf8',
    ),
  );
}

describe('workerd SSR proof fixture execution', () => {
  test('proves a shell-rendered boundary and the vertical on its own Worker', () => {
    const root = createFixtureWorkspace({ renderBoundary: true });
    try {
      const { status, output } = runProof(root);
      assert.equal(status, 0, output);
      const report = readReport(root);
      assert.equal(report.schemaVersion, 3);
      assert.deepEqual(
        report.proofs.map((proof: { route: string }) => proof.route),
        ['/en'],
      );
      assert.equal(report.proofs[0].boundaries[0].key, 'contacts::./Widget');
      assert.equal(report.proofs[0].fragmentBindingRequests.length, 1);
      assert.deepEqual(
        report.verticalProofs.map(
          (proof: { appId: string; route: string }) =>
            `${proof.appId}:${proof.route}`,
        ),
        ['contacts:/en/contacts'],
      );
      assert.equal(report.apiProofs.length, 1);
      assert.equal(report.apiProofs[0].binding, 'CONTACTS');
      // The shell only answers once its wrangler vars are bound; the
      // vertical reports whether its .dev.vars secret reached the Worker.
      const body = JSON.parse(
        Buffer.from(report.apiProofs[0].direct.bodyBase64, 'base64').toString(
          'utf8',
        ),
      );
      assert.equal(body.secretConfigured, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test('keeps requiring server-rendered boundaries on the default shell SSR route', () => {
    const root = createFixtureWorkspace({ renderBoundary: false });
    try {
      const { status, output } = runProof(root);
      assert.equal(status, 1, output);
      assert.match(
        output,
        /shell rendered no distributed SSR boundaries for \/en/u,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test('rejects server-rendered boundaries from a client-composed shell', () => {
    const root = createFixtureWorkspace({
      renderBoundary: true,
      shellCloudflare: { distributedSsrProofRoutes: [] },
    });
    try {
      const { status, output } = runProof(root);
      assert.equal(status, 1, output);
      assert.match(
        output,
        /shell declares client composition but rendered distributed SSR boundaries for \/en/u,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test('proves a client-composed shell through each vertical Worker', () => {
    const root = createFixtureWorkspace({
      renderBoundary: false,
      shellCloudflare: { distributedSsrProofRoutes: [] },
    });
    try {
      const { status, output } = runProof(root);
      assert.equal(status, 0, output);
      const report = readReport(root);
      assert.deepEqual(report.proofs[0].boundaries, []);
      assert.equal(report.verticalProofs.length, 1);
      assert.equal(report.verticalProofs[0].status, 200);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
