import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMicroVerticalReleaseEnvelope } from '@modern-js/app-tools-extensions/release-envelope';
import { reactReleaseUi } from '../../../solutions/app-tools-extensions/tests/renderer-release-fixture';

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

type ProofModule = {
  planWorkerdSsrProof: (topology: unknown) => {
    plans: ProofPlan[];
  };
  resolveAppOutputRoot: (
    artifactRoot: string,
    appId: string,
    appPath: unknown,
  ) => string;
  validateWorkerdProofFixture: (fixture: unknown, apps: unknown[]) => unknown;
  expectedEnvelopeSurfaces: (
    kind: 'shell' | 'vertical',
    surfaceProfile?: string,
  ) => { apiBackend: boolean; backendFederation: boolean; uiClient: boolean };
};

const loadProofModule = async () =>
  (await import(pathToFileURL(templatePath).href)) as ProofModule;

async function loadPlanner() {
  return (await loadProofModule()).planWorkerdSsrProof;
}

type TopologyShell = Record<string, unknown> & {
  cloudflare?: Record<string, unknown>;
};

const shell = (cloudflare: Record<string, unknown> = {}): TopologyShell => ({
  id: 'shell',
  kind: 'shell',
  // Generated Shells declare ui-only; an omitted profile owns an API backend.
  surfaceProfile: 'ui-only',
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
    assert.throws(
      () =>
        planWorkerdSsrProof(
          topology(shell({ distributedSsrProofRoutes: '/en/home' })),
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
    // An explicit HTTPS mount: forward to the approved owner origin.
    if (url.pathname.startsWith('/mounted/')) {
      if (request.headers.get('x-proof-revision') !== (await env.COMPOSITION.get('active'))) {
        return new Response('stale composition revision', { status: 409 });
      }
      const owner = await fetch(new URL(url.pathname.slice('/mounted'.length), 'https://contacts.proof.test'), {
        method: request.method,
        redirect: 'manual',
      });
      return env.MOUNT_CONTENT_TYPE
        ? new Response(owner.body, { status: owner.status, headers: { 'content-type': env.MOUNT_CONTENT_TYPE } })
        : owner;
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
    const active = env.COMPOSITION === undefined ? null : await env.COMPOSITION.get('active');
    if (env.REQUIRE_ACTIVE === '1' && active === null) {
      return Response.json(
        { type: 'urn:proof:composition-missing', title: 'Active composition is not seeded', status: 503, detail: 'x'.repeat(600) },
        { status: 503, headers: { 'content-type': 'application/problem+json' } },
      );
    }
    if (url.pathname === '/contacts-api/readiness') {
      return Response.json({ status: 'ready', active, secretConfigured: env.PROOF_SECRET === 'local', hyperdriveConnectionString: env.HYPERDRIVE?.connectionString === undefined ? null : typeof env.HYPERDRIVE.connectionString, marker: { appId: 'contacts', build: 'b1', version: '1.0.0' } });
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

async function createFixtureWorkspace(options: {
  renderBoundary: boolean;
  shellCloudflare?: Record<string, unknown>;
  shellWrangler?: Record<string, unknown>;
  contactsWrangler?: Record<string, unknown>;
  contactsDevVars?: string;
  /** Write built `.output` directories below this subdirectory of the root. */
  artifactDirectory?: string;
}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-workerd-ssr-proof-')),
  );
  const artifactRoot = path.join(root, options.artifactDirectory ?? '');
  const shellOutput = path.join(artifactRoot, 'apps/shell/.output');
  const contactsOutput = path.join(artifactRoot, 'verticals/contacts/.output');
  writeFile(
    path.join(root, 'topology/reference-topology.json'),
    JSON.stringify({
      schemaVersion: 1,
      shell: {
        id: 'shell',
        kind: 'shell',
        surfaceProfile: 'ui-only',
        path: 'apps/shell',
        portEnv: 'SHELL_PORT',
        deliveryUnit: { unitId: 'app/shell' },
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
      ...options.shellWrangler,
      vars: {
        GREETING: 'hello',
        RENDER_BOUNDARY: options.renderBoundary ? '1' : '0',
        ...(options.shellWrangler?.vars as Record<string, string> | undefined),
      },
    }),
  );
  writeFile(path.join(shellOutput, 'server/index.mjs'), shellWorker);
  writeFile(path.join(shellOutput, 'public/.keep'), '');
  writeFile(
    path.join(contactsOutput, 'wrangler.json'),
    wrangler('app-contacts', options.contactsWrangler),
  );
  writeFile(path.join(contactsOutput, 'server/index.mjs'), contactsWorker);
  writeFile(path.join(contactsOutput, 'public/.keep'), '');
  writeFile(
    path.join(contactsOutput, '.dev.vars'),
    `PROOF_SECRET=local\n${options.contactsDevVars ?? ''}`,
  );
  // Each executed Worker is bound to an owner-verified release envelope
  // resolved through the app's own @modern-js/ultramodern-app-tools.
  const sdkRoot = path.resolve(
    packageRoot,
    '../../solutions/ultramodern-app-tools',
  );
  for (const app of [
    { id: 'shell', path: 'apps/shell', unitId: 'app/shell', hasApi: false },
    {
      id: 'contacts',
      path: 'verticals/contacts',
      unitId: 'app/contacts',
      hasApi: true,
    },
  ]) {
    const appRoot = path.join(root, app.path);
    const outputRoot = path.join(artifactRoot, app.path, '.output');
    writeFile(
      path.join(appRoot, 'package.json'),
      JSON.stringify({ name: `@test/${app.id}` }),
    );
    fs.mkdirSync(path.join(appRoot, 'node_modules/@modern-js'), {
      recursive: true,
    });
    fs.symlinkSync(
      sdkRoot,
      path.join(appRoot, 'node_modules/@modern-js/ultramodern-app-tools'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const files: Record<string, string> = {
      'public/client.js': 'globalThis.ui = true;',
      ...(app.hasApi
        ? {
            'worker/__modern_bff_effect.js': 'export const api = true;',
            'public/backend-mf-manifest.json': '{"name":"contacts"}',
            'public/backendRemoteEntry.cjs': 'module.exports = {};',
          }
        : {}),
    };
    for (const [logicalPath, content] of Object.entries(files))
      writeFile(path.join(outputRoot, logicalPath), content);
    const envelope = await createMicroVerticalReleaseEnvelope({
      artifactRoot: outputRoot,
      target: 'cloudflare',
      identity: {
        unitId: app.unitId,
        buildMarker: 'b1',
        sourceRevision: 'a'.repeat(40),
        releaseVersion: '1.0.0',
      },
      ui: reactReleaseUi('b1', app.id),
      artifacts: ['server/index.mjs', ...Object.keys(files)].map(
        logicalPath => ({
          logicalPath,
          runtime:
            logicalPath === 'worker/__modern_bff_effect.js'
              ? 'workerd-effect'
              : logicalPath.endsWith('backend-mf-manifest.json')
                ? 'module-federation-manifest'
                : logicalPath.endsWith('.cjs')
                  ? 'commonjs-module'
                  : logicalPath.startsWith('public/')
                    ? 'browser'
                    : 'workerd',
        }),
      ),
      surfaces: {
        uiClient: ['public/client.js'],
        ssr: ['server/index.mjs'],
        apiBackend: app.hasApi ? ['worker/__modern_bff_effect.js'] : [],
        ...(app.hasApi
          ? {
              backendFederation: {
                manifest: 'public/backend-mf-manifest.json',
                container: 'public/backendRemoteEntry.cjs',
              },
            }
          : {}),
      },
    });
    writeFile(
      path.join(outputRoot, 'release/microvertical-release-envelope.json'),
      JSON.stringify(envelope),
    );
  }
  return root;
}

function runProof(root: string, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [templatePath], {
    cwd: root,
    env: { ...process.env, ...env, ULTRAMODERN_WORKSPACE_ROOT: root },
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
  test('proves a shell-rendered boundary and the vertical on its own Worker', async () => {
    const root = await createFixtureWorkspace({ renderBoundary: true });
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

  test('binds a Worker Hyperdrive to its local PostgreSQL as Wrangler does', async () => {
    const root = await createFixtureWorkspace({
      renderBoundary: true,
      contactsWrangler: {
        hyperdrive: [{ binding: 'HYPERDRIVE', id: '0'.repeat(32) }],
      },
    });
    try {
      const { status, output } = runProof(root, {
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
          'postgresql://proof:proof@127.0.0.1:5432/proof',
      });
      assert.equal(status, 0, output);
      const body = JSON.parse(
        Buffer.from(
          readReport(root).apiProofs[0].direct.bodyBase64,
          'base64',
        ).toString('utf8'),
      );
      assert.equal(body.hyperdriveConnectionString, 'string');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test("reads a Hyperdrive local connection string from the app's .dev.vars", async () => {
    const root = await createFixtureWorkspace({
      renderBoundary: true,
      contactsWrangler: {
        hyperdrive: [{ binding: 'HYPERDRIVE', id: '0'.repeat(32) }],
      },
      contactsDevVars:
        'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://proof:proof@127.0.0.1:5432/proof\n',
    });
    try {
      const { status, output } = runProof(root, {
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: '',
      });
      assert.equal(status, 0, output);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test('names the missing local connection string of a Hyperdrive binding', async () => {
    const root = await createFixtureWorkspace({
      renderBoundary: true,
      contactsWrangler: {
        hyperdrive: [{ binding: 'HYPERDRIVE', id: '0'.repeat(32) }],
      },
    });
    try {
      const { status, output } = runProof(root, {
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: '',
      });
      assert.equal(status, 1, output);
      assert.match(
        output,
        /contacts Hyperdrive binding HYPERDRIVE needs a local PostgreSQL connection string; set CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE/u,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test('keeps requiring server-rendered boundaries on the default shell SSR route', async () => {
    const root = await createFixtureWorkspace({ renderBoundary: false });
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

  test('rejects server-rendered boundaries from a client-composed shell', async () => {
    const root = await createFixtureWorkspace({
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

  test('proves a client-composed shell through each vertical Worker', async () => {
    const root = await createFixtureWorkspace({
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

describe('workerd SSR proof artifact root', () => {
  test('keeps topology paths inside the selected artifact root', async () => {
    const { resolveAppOutputRoot } = await loadProofModule();
    const root = path.resolve('/proof/artifacts');

    assert.equal(
      resolveAppOutputRoot(root, 'shell', 'apps/shell'),
      path.join(root, 'apps/shell/.output'),
    );
    for (const appPath of [
      '../shell',
      'apps/../../shell',
      '/apps/shell',
      path.resolve('/elsewhere/shell'),
      '.',
      './',
    ]) {
      assert.throws(
        () => resolveAppOutputRoot(root, 'shell', appPath),
        /shell topology path .* escapes the selected artifact root/u,
        appPath,
      );
    }
    assert.throws(
      () => resolveAppOutputRoot(root, 'shell', ''),
      /shell topology path is missing/u,
    );
  });

  test('proves built outputs from ULTRAMODERN_WORKERD_ARTIFACT_ROOT', async () => {
    const root = await createFixtureWorkspace({
      renderBoundary: true,
      artifactDirectory: 'downloaded-artifacts',
    });
    try {
      const missing = runProof(root);
      assert.equal(missing.status, 1, missing.output);
      assert.match(missing.output, /shell Cloudflare output is missing/u);

      const { status, output } = runProof(root, {
        ULTRAMODERN_WORKERD_ARTIFACT_ROOT: path.join(
          root,
          'downloaded-artifacts',
        ),
      });
      assert.equal(status, 0, output);
      const report = readReport(root);
      assert.deepEqual(
        report.executions.map(
          (execution: { modulesRoot: string }) => execution.modulesRoot,
        ),
        ['apps/shell/.output', 'verticals/contacts/.output'],
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

const proofApps = [
  {
    id: 'shell',
    kind: 'shell',
    hasApiSurface: false,
    wrangler: {
      kv_namespaces: [{ binding: 'COMPOSITION', id: 'composition' }],
    },
  },
  {
    id: 'contacts',
    kind: 'vertical',
    hasApiSurface: true,
    wrangler: {
      kv_namespaces: [{ binding: 'COMPOSITION', id: 'composition' }],
    },
  },
];
const proofFixture = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  kvSeeds: [
    {
      appId: 'shell',
      binding: 'COMPOSITION',
      entries: [{ key: 'active', value: 'r1' }],
    },
    {
      appId: 'contacts',
      binding: 'COMPOSITION',
      entries: [{ key: 'active', value: 'r1' }],
    },
  ],
  ownerTargets: [
    { appId: 'contacts', baseUrl: 'https://contacts.proof.test/' },
  ],
  shellApiTargets: [
    {
      shellId: 'shell',
      appId: 'contacts',
      routePrefix: '/mounted',
      headers: { 'x-proof-revision': 'r1' },
    },
  ],
  ...overrides,
});

describe('workerd SSR proof fixture validation', () => {
  test('accepts declared KV seeds, HTTPS owners and Shell API mounts', async () => {
    const { validateWorkerdProofFixture } = await loadProofModule();
    const fixture = proofFixture();
    assert.equal(validateWorkerdProofFixture(fixture, proofApps), fixture);
  });

  test('rejects fixture data the executed Workers do not declare', async () => {
    const { validateWorkerdProofFixture } = await loadProofModule();
    const rejects = (fixture: unknown, message: RegExp) =>
      assert.throws(
        () => validateWorkerdProofFixture(fixture, proofApps),
        message,
      );
    const kvMessage =
      /KV seed must name an executed Worker's declared kv_namespaces binding/u;
    const ownerMessage =
      /owner targets must be unique executed MicroVerticals at canonical HTTPS origins/u;
    const mountMessage =
      /Shell API targets must name one approved owner, an explicit mount and string headers/u;
    const owner = (baseUrl: string, appId = 'contacts') => ({
      ownerTargets: [{ appId, baseUrl }],
    });
    const mount = (target: Record<string, unknown>) => ({
      shellApiTargets: [
        {
          shellId: 'shell',
          appId: 'contacts',
          routePrefix: '/mounted',
          headers: {},
          ...target,
        },
      ],
    });

    rejects(
      { ...proofFixture(), schemaVersion: 2 },
      /Invalid Workerd proof fixture/u,
    );
    rejects(
      { schemaVersion: 1, kvSeeds: [] },
      /Invalid Workerd proof fixture/u,
    );
    rejects(
      proofFixture({
        kvSeeds: [{ appId: 'shell', binding: 'MISSING', entries: [] }],
      }),
      kvMessage,
    );
    rejects(
      proofFixture({
        kvSeeds: [{ appId: 'pricing', binding: 'COMPOSITION', entries: [] }],
      }),
      kvMessage,
    );
    rejects(
      proofFixture({
        kvSeeds: [
          {
            appId: 'shell',
            binding: 'COMPOSITION',
            entries: [{ key: 'active', value: 1 }],
          },
        ],
      }),
      /unique string keys with string values/u,
    );
    rejects(
      proofFixture({
        kvSeeds: [
          {
            appId: 'shell',
            binding: 'COMPOSITION',
            entries: [{ key: 'active', value: 'r1' }],
          },
          {
            appId: 'contacts',
            binding: 'COMPOSITION',
            entries: [{ key: 'active', value: 'r2' }],
          },
        ],
      }),
      /must not conflict in a shared namespace/u,
    );
    for (const baseUrl of [
      'http://contacts.proof.test/',
      'https://contacts.proof.test',
      'https://contacts.proof.test/api/',
      'https://user@contacts.proof.test/',
      'https://contacts.proof.test/?x=1',
      'not a url',
    ]) {
      rejects(proofFixture(owner(baseUrl)), ownerMessage);
    }
    rejects(
      proofFixture(owner('https://shell.proof.test/', 'shell')),
      ownerMessage,
    );
    rejects(
      proofFixture({
        ownerTargets: [
          { appId: 'contacts', baseUrl: 'https://contacts.proof.test/' },
          { appId: 'contacts', baseUrl: 'https://other.proof.test/' },
        ],
      }),
      ownerMessage,
    );
    rejects(proofFixture({ ownerTargets: [] }), mountMessage);
    for (const routePrefix of [
      'mounted',
      '/mounted/',
      '/mounted/../admin',
      '/mounted/%2fadmin',
      '/mounted?x=1',
      '/mounted\\admin',
    ]) {
      rejects(proofFixture(mount({ routePrefix })), mountMessage);
    }
    rejects(proofFixture(mount({ shellId: 'contacts' })), mountMessage);
    rejects(proofFixture(mount({ headers: { 'x-a': 1 } })), mountMessage);
    rejects(
      proofFixture(mount({ headers: { 'x-a': 'one\r\nx-b: two' } })),
      mountMessage,
    );
    rejects(
      proofFixture(mount({ headers: { 'bad header': 'x' } })),
      mountMessage,
    );
    rejects(proofFixture(mount({ headers: ['x'] })), mountMessage);
  });
});

describe('workerd SSR proof fixture placement', () => {
  const compositionNamespace = {
    kv_namespaces: [{ binding: 'COMPOSITION', id: 'composition' }],
  };
  const createPlacedWorkspace = (shellVars: Record<string, string> = {}) =>
    createFixtureWorkspace({
      renderBoundary: true,
      shellWrangler: { ...compositionNamespace, vars: shellVars },
      contactsWrangler: {
        ...compositionNamespace,
        vars: { REQUIRE_ACTIVE: '1' },
      },
    });
  const runPlacedProof = (
    root: string,
    fixture: Record<string, unknown> = proofFixture(),
  ) => {
    const fixturePath = path.join(root, 'workerd-proof-fixture.json');
    writeFile(fixturePath, JSON.stringify(fixture));
    return runProof(root, { ULTRAMODERN_WORKERD_PROOF_FIXTURE: fixturePath });
  };

  test('seeds KV and proves the Shell API through its approved HTTPS owner', async () => {
    const root = await createPlacedWorkspace();
    try {
      const { status, output } = runPlacedProof(root);
      assert.equal(status, 0, output);
      const report = readReport(root);
      const [apiProof] = report.apiProofs;
      assert.equal(report.apiProofs.length, 1);
      assert.equal(apiProof.shellRoute, '/mounted/contacts-api/readiness');
      assert.equal(
        apiProof.httpsTarget.baseUrl,
        'https://contacts.proof.test/',
      );
      assert.equal(apiProof.binding, undefined);
      assert.equal(apiProof.throughShell.sha256, apiProof.direct.sha256);
      assert.equal(
        apiProof.throughShell.contentType,
        apiProof.direct.contentType,
      );
      assert.deepEqual(
        apiProof.outboundRequests.map((request: Record<string, unknown>) => ({
          callerId: request.callerId,
          method: request.method,
          targetAppId: request.targetAppId,
          url: request.url,
        })),
        [
          {
            callerId: 'shell',
            method: 'GET',
            targetAppId: 'contacts',
            url: 'https://contacts.proof.test/contacts-api/readiness',
          },
        ],
      );
      const body = JSON.parse(
        Buffer.from(apiProof.direct.bodyBase64, 'base64').toString('utf8'),
      );
      assert.equal(body.active, 'r1');
      // The vertical's own runtime receives the seeds as well.
      assert.equal(report.verticalProofs[0].status, 200);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test('summarizes an unseeded owner problem response', async () => {
    const root = await createPlacedWorkspace();
    try {
      const { status, output } = runPlacedProof(
        root,
        proofFixture({ kvSeeds: [] }),
      );
      assert.equal(status, 1, output);
      assert.match(output, /contacts direct API response returned HTTP 503/u);
      assert.match(output, /"contentType":"application\/problem\+json"/u);
      assert.match(output, /"title":"Active composition is not seeded"/u);
      assert.match(output, /"type":"urn:proof:composition-missing"/u);
      assert.ok(!output.includes('x'.repeat(256)), output);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test('keeps every origin but the approved owners disabled', async () => {
    const root = await createPlacedWorkspace();
    try {
      const { status, output } = runPlacedProof(
        root,
        proofFixture({
          ownerTargets: [
            { appId: 'contacts', baseUrl: 'https://elsewhere.proof.test/' },
          ],
        }),
      );
      assert.equal(status, 1, output);
      assert.match(
        output,
        /contacts through-shell API response returned HTTP 502/u,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test('requires the shell to return the owner content type', async () => {
    const root = await createPlacedWorkspace({
      MOUNT_CONTENT_TYPE: 'text/plain',
    });
    try {
      const { status, output } = runPlacedProof(root);
      assert.equal(status, 1, output);
      assert.match(
        output,
        /contacts direct and through-shell API responses differ/u,
      );
      assert.match(output, /"contentType":"text\/plain"/u);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('workerd SSR proof envelope surfaces', () => {
  it('expects a full-stack Shell API backend without backend federation', async () => {
    const { expectedEnvelopeSurfaces } = await loadProofModule();
    expect(expectedEnvelopeSurfaces('shell', undefined)).toEqual({
      apiBackend: true,
      backendFederation: false,
      uiClient: true,
    });
    expect(expectedEnvelopeSurfaces('shell', 'ui-only')).toEqual({
      apiBackend: false,
      backendFederation: false,
      uiClient: true,
    });
  });

  it('expects MicroVertical surfaces from the declared profile', async () => {
    const { expectedEnvelopeSurfaces } = await loadProofModule();
    expect(expectedEnvelopeSurfaces('vertical', undefined)).toEqual({
      apiBackend: true,
      backendFederation: true,
      uiClient: true,
    });
    expect(expectedEnvelopeSurfaces('vertical', 'api-only')).toEqual({
      apiBackend: true,
      backendFederation: true,
      uiClient: false,
    });
    expect(expectedEnvelopeSurfaces('vertical', 'ui-only')).toEqual({
      apiBackend: false,
      backendFederation: false,
      uiClient: true,
    });
  });
});
