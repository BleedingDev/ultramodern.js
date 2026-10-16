import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateUltramodernBuildArtifact } from '@modern-js/backend-federation-contracts';
import {
  normalizeWorkspaceInputs,
  readResolvedUltramodernWorkspaceInputs,
} from '../src/ultramodern-tooling/config';
import { __transactionTestHooks } from '../src/ultramodern-workspace/add-vertical/transaction';
import { createBuildMarker } from '../src/ultramodern-workspace/delivery-unit';
import { runSyncDeliveryUnit } from '../src/ultramodern-workspace/delivery-unit-sync';
import { createUltramodernBuildArtifactJson } from '../src/ultramodern-workspace/module-federation';
import { captureWorkspaceRendererEvaluations } from '../src/ultramodern-workspace/renderer-config-evaluation';
import {
  assertWorkspaceRendererArtifact,
  reconcileWorkspaceRendererIdentities,
} from '../src/ultramodern-workspace/renderer-identity';
import type {
  ApplicationRenderer,
  WorkspaceApp,
} from '../src/ultramodern-workspace/types';

function waitForFiles(directory: string, names: readonly string[]) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      watcher.close();
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (names.every(name => fs.existsSync(path.join(directory, name))))
        finish();
    };
    const watcher = fs.watch(directory, check);
    const timer = setTimeout(
      () =>
        finish(new Error(`Missing config worker markers: ${names.join(', ')}`)),
      10000,
    );
    watcher.once('error', finish);
    check();
  });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-renderer-identity-'));
  const write = (relative: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  };
  write(
    'package.json',
    JSON.stringify({
      name: 'identity',
      private: true,
      devDependencies: { '@modern-js/ultramodern-create': 'workspace:*' },
    }),
  );
  for (const id of ['shell', 'catalog', 'api']) {
    write(
      `${id}/package.json`,
      JSON.stringify({ name: `@identity/${id}`, version: '1.0.0' }),
    );
  }
  // Plain TypeScript entries keep these fixtures focused on metadata and discovery.
  for (const id of ['shell', 'catalog'])
    write(`${id}/src/entry.ts`, 'export default () => "metadata entry";');
  const defineConfigImport =
    "import { defineConfig } from '@modern-js/ultramodern-app-tools';\n";
  const topology = {
    schemaVersion: 1,
    shell: {
      id: 'shell',
      kind: 'shell',
      path: 'shell',
      package: '@identity/shell',
    },
    verticals: [
      {
        id: 'catalog',
        kind: 'vertical',
        path: 'catalog',
        package: '@identity/catalog',
      },
      {
        id: 'api',
        kind: 'vertical',
        path: 'api',
        package: '@identity/api',
        surfaceProfile: 'api-only',
      },
    ],
  };
  const overlay = {
    schemaVersion: 1,
    ports: { shell: 3000, catalog: 3001, api: 3002 },
  };
  write('topology/reference-topology.json', JSON.stringify(topology));
  write('topology/local-overlays/development.json', JSON.stringify(overlay));
  const config = (
    id: string,
    renderer: ApplicationRenderer,
    form = 'object',
  ) => {
    const value = `{ renderer: '${renderer}', source: { disableDefaultEntries: true, entries: { main: { entry: './src/entry.ts', disableMount: true } } } }`;
    write(
      `${id}/modern.config.mjs`,
      form === 'object'
        ? `${defineConfigImport}export default defineConfig(${value});`
        : `${defineConfigImport}export default defineConfig(${form === 'async' ? 'async ' : ''}({env,command}) => { if(env !== 'development' || command !== 'dev') throw new Error('wrong context'); return ${value}; });`,
    );
  };
  config('shell', 'react');
  config('catalog', 'solid', 'async');
  const apps = () =>
    normalizeWorkspaceInputs(root, {
      topology: JSON.parse(
        fs.readFileSync(
          path.join(root, 'topology/reference-topology.json'),
          'utf8',
        ),
      ),
      overlay,
    }).apps;
  const barriers = path.join(root, 'worker-barriers');
  const gatedConfig = (
    id: string,
    renderer: ApplicationRenderer,
    error?: string,
  ) => {
    fs.mkdirSync(barriers, { recursive: true });
    write(`${id}/.env`, `MODERN_EVALUATION_APP=${id}\n`);
    write(
      `${id}/modern.config.mjs`,
      `${defineConfigImport}import fs from 'node:fs';
import path from 'node:path';
export default defineConfig(async ({env,command}) => {
  const directory = ${JSON.stringify(barriers)};
  const marker = name => path.join(directory, '${id}.' + name);
  if (globalThis.metadataApp !== undefined) throw new Error('shared config context');
  globalThis.metadataApp = '${id}';
  process.once('exit', () => fs.writeFileSync(marker('closed'), 'closed'));
  fs.writeFileSync(marker('started'), JSON.stringify({pid: process.pid, cwd: process.cwd(), env, command, app: process.env.MODERN_EVALUATION_APP}));
  await new Promise(resolve => {
    const check = () => {
      if (fs.existsSync(marker('release'))) { watcher.close(); resolve(); }
    };
    const watcher = fs.watch(directory, check);
    check();
  });
  ${error ? `throw new Error(${JSON.stringify(error)});` : `return {renderer: '${renderer}', source: {disableDefaultEntries: true, entries: {main: {entry: './src/entry.ts', disableMount: true}}}};`}
});`,
    );
  };
  const release = (id: string) =>
    fs.writeFileSync(path.join(barriers, `${id}.release`), 'release');
  return {
    root,
    write,
    config,
    apps,
    defineConfigImport,
    barriers,
    gatedConfig,
    release,
    clean: () => {
      for (const key of Object.keys(__transactionTestHooks))
        delete __transactionTestHooks[
          key as keyof typeof __transactionTestHooks
        ];
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('owning config loader resolves object/sync/async selection; headless has no UI identity', async () => {
  const f = fixture();
  try {
    const first = await reconcileWorkspaceRendererIdentities(
      f.root,
      'identity',
      f.apps(),
    );
    assert.deepEqual(
      first.map(app => app.renderer),
      ['react', 'solid', 'none'],
    );
    assert.equal(first[2].rendererIdentity, undefined);
    const source = fs.readFileSync(
      path.join(f.root, 'catalog/modern.config.mjs'),
      'utf8',
    );
    const reloaded = await reconcileWorkspaceRendererIdentities(
      f.root,
      'identity',
      first,
    );
    assert.deepEqual(reloaded, first);
    assert.equal(
      fs.readFileSync(path.join(f.root, 'catalog/modern.config.mjs'), 'utf8'),
      source,
    );
    f.config('catalog', 'octane', 'sync');
    const switched = await reconcileWorkspaceRendererIdentities(
      f.root,
      'identity',
      first,
    );
    assert.equal(switched[1].renderer, 'octane');
    assert.notEqual(
      switched[1].deliveryUnit!.buildMarker,
      first[1].deliveryUnit!.buildMarker,
    );
    const uiArtifact = JSON.parse(
      createUltramodernBuildArtifactJson('identity', switched[1]),
    );
    const headless = JSON.parse(
      createUltramodernBuildArtifactJson('identity', switched[2]),
    );
    assert.equal(validateUltramodernBuildArtifact(uiArtifact).ok, true);
    assert.equal(headless.surfaces.ui, undefined);
  } finally {
    f.clean();
  }
});

test('metadata overlaps isolated app processes, bounds active pairs and preserves input order', async () => {
  const f = fixture();
  const originalAppEnv = process.env.MODERN_EVALUATION_APP;
  let settled: Promise<unknown> = Promise.resolve();
  try {
    const [shell, catalog, headless] = f.apps();
    const checkout = { ...catalog, id: 'checkout', directory: 'checkout' };
    for (const [id, renderer] of [
      ['shell', 'react'],
      ['catalog', 'solid'],
      ['checkout', 'octane'],
    ] as const) {
      f.write(
        `${id}/package.json`,
        JSON.stringify({ name: `@identity/${id}`, version: '1.0.0' }),
      );
      f.write(`${id}/src/entry.ts`, 'export default () => "metadata entry";');
      f.gatedConfig(id, renderer);
    }
    f.write(
      'api/modern.config.mjs',
      "throw new Error('headless config must not load');",
    );
    const captured = captureWorkspaceRendererEvaluations(
      f.root,
      [shell, headless, catalog, checkout],
      { env: 'production', command: 'validate' },
    );
    // Attach a rejection handler before waiting for worker observations.
    settled = captured.then(
      value => ({ value }),
      error => ({ error }),
    );
    await waitForFiles(f.barriers, ['shell.started', 'catalog.started']);
    assert.equal(
      fs.existsSync(path.join(f.barriers, 'checkout.started')),
      false,
    );
    f.release('catalog');
    await waitForFiles(f.barriers, ['catalog.closed']);
    assert.equal(
      fs.existsSync(path.join(f.barriers, 'checkout.started')),
      false,
    );
    f.release('shell');
    await waitForFiles(f.barriers, ['checkout.started']);
    assert.equal(fs.existsSync(path.join(f.barriers, 'shell.closed')), true);
    f.release('checkout');
    const evaluations = await captured;
    assert.deepEqual([...evaluations.keys()], ['shell', 'catalog', 'checkout']);
    assert.deepEqual(
      [...evaluations.values()].map(value => value.renderer),
      ['react', 'solid', 'octane'],
    );
    const observations = ['shell', 'catalog', 'checkout'].map(id =>
      JSON.parse(
        fs.readFileSync(path.join(f.barriers, `${id}.started`), 'utf8'),
      ),
    );
    assert.equal(new Set(observations.map(value => value.pid)).size, 3);
    for (const [index, id] of ['shell', 'catalog', 'checkout'].entries()) {
      assert.notEqual(observations[index].pid, process.pid);
      assert.deepEqual(observations[index], {
        pid: observations[index].pid,
        cwd: fs.realpathSync(path.join(f.root, id)),
        env: 'production',
        command: 'validate',
        app: id,
      });
      assert.equal(fs.existsSync(path.join(f.barriers, `${id}.closed`)), true);
      assert.throws(() => process.kill(observations[index].pid, 0), {
        code: 'ESRCH',
      });
    }
    assert.equal(process.env.MODERN_EVALUATION_APP, originalAppEnv);
  } finally {
    if (fs.existsSync(f.barriers))
      for (const id of ['shell', 'catalog', 'checkout']) f.release(id);
    await settled;
    f.clean();
  }
});

test.each(['shell', 'catalog'])(
  'metadata chooses the first input error and drains the held %s process',
  async held => {
    const f = fixture();
    let settled: Promise<unknown> = Promise.resolve();
    try {
      const [shell, catalog] = f.apps();
      f.gatedConfig('shell', 'react', 'first app failed');
      f.gatedConfig('catalog', 'solid', 'second app failed');
      f.write(
        'unstarted/package.json',
        JSON.stringify({ name: '@identity/unstarted', version: '1.0.0' }),
      );
      f.write(
        'unstarted/src/entry.ts',
        'export default () => "metadata entry";',
      );
      f.gatedConfig('unstarted', 'octane');
      let finished = false;
      const captured = captureWorkspaceRendererEvaluations(f.root, [
        shell,
        catalog,
        { ...catalog, id: 'unstarted', directory: 'unstarted' },
      ]);
      const closedAtSettlement = captured.then(
        () => {
          finished = true;
          return [];
        },
        () => {
          finished = true;
          return ['shell', 'catalog'].map(id =>
            fs.existsSync(path.join(f.barriers, `${id}.closed`)),
          );
        },
      );
      settled = closedAtSettlement;
      await waitForFiles(f.barriers, ['shell.started', 'catalog.started']);
      const released = held === 'shell' ? 'catalog' : 'shell';
      f.release(released);
      await waitForFiles(f.barriers, [`${released}.closed`]);
      assert.equal(finished, false);
      assert.equal(
        fs.existsSync(path.join(f.barriers, `${held}.closed`)),
        false,
      );
      f.release(held);
      await assert.rejects(captured, /first app failed/);
      assert.deepEqual(await closedAtSettlement, [true, true]);
      assert.equal(
        fs.existsSync(path.join(f.barriers, 'unstarted.started')),
        false,
      );
      for (const id of ['shell', 'catalog']) {
        assert.equal(
          fs.existsSync(path.join(f.barriers, `${id}.closed`)),
          true,
        );
        const { pid } = JSON.parse(
          fs.readFileSync(path.join(f.barriers, `${id}.started`), 'utf8'),
        );
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      }
    } finally {
      if (fs.existsSync(f.barriers))
        for (const id of ['shell', 'catalog', 'unstarted']) f.release(id);
      await settled;
      f.clean();
    }
  },
);

test('immutable artifacts reject renderer/ABI conflicts while local projection regenerates', async () => {
  const f = fixture();
  try {
    const apps = await reconcileWorkspaceRendererIdentities(
      f.root,
      'identity',
      f.apps(),
    );
    const immutable = JSON.parse(
      createUltramodernBuildArtifactJson('identity', apps[1]),
    );
    assertWorkspaceRendererArtifact(apps[1], immutable);
    f.config('catalog', 'octane');
    await assert.rejects(
      reconcileWorkspaceRendererIdentities(f.root, 'identity', apps, {
        immutableArtifacts: new Map([['catalog', immutable]]),
      }),
      /buildMarker|cross-renderer/,
    );
    const changedAbi = structuredClone(apps[1]);
    changedAbi.rendererProfile!.compiler.version = '2.0.0-rc.99';
    assert.notEqual(
      createBuildMarker('identity', apps[1], '1.0.0'),
      createBuildMarker('identity', changedAbi, '1.0.0'),
    );
    assert.throws(
      () => assertWorkspaceRendererArtifact(changedAbi, immutable),
      /compiler.version/,
    );
    const changedRouterCore = structuredClone(apps[1]);
    changedRouterCore.rendererProfile!.router.coreName = '@other/router-core';
    assert.notEqual(
      createBuildMarker('identity', apps[1], '1.0.0'),
      createBuildMarker('identity', changedRouterCore, '1.0.0'),
    );
    assert.throws(
      () => assertWorkspaceRendererArtifact(changedRouterCore, immutable),
      /router.coreName/,
    );
    const headlessArtifact = JSON.parse(
      createUltramodernBuildArtifactJson('identity', apps[2]),
    );
    assertWorkspaceRendererArtifact(apps[2], headlessArtifact);
    const wrongHeadless = {
      ...apps[2],
      id: 'other-api',
      deliveryUnit: { ...apps[2].deliveryUnit, appId: 'other-api' },
    };
    assert.throws(
      () => assertWorkspaceRendererArtifact(wrongHeadless, headlessArtifact),
      /appId/,
    );
    const wrongPackage = {
      ...apps[1],
      deliveryUnit: { ...apps[1].deliveryUnit, packageName: '@other/catalog' },
    };
    assert.throws(
      () => assertWorkspaceRendererArtifact(wrongPackage, immutable),
      /packageName/,
    );
    const changedBuildId = {
      ...apps[1],
      rendererIdentity: { ...apps[1].rendererIdentity!, buildId: 'different' },
    } satisfies WorkspaceApp;
    assert.equal(
      createBuildMarker('identity', changedBuildId, '1.0.0'),
      createBuildMarker('identity', apps[1], '1.0.0'),
    );
  } finally {
    f.clean();
  }
});

test('explicit multi-entry config projects every identity and its actual primary entry', async () => {
  const f = fixture();
  try {
    assert.equal(f.apps()[0].renderer, undefined);
    f.write(
      'catalog/modern.config.mjs',
      `${f.defineConfigImport}export default defineConfig({
      renderer: 'solid',
      source: { disableDefaultEntries: true, entries: { dashboard: './src/dashboard.tsx', checkout: './src/checkout.tsx' } },
    });`,
    );
    f.write(
      'catalog/src/dashboard.tsx',
      'export default () => "dashboard metadata entry";',
    );
    f.write(
      'catalog/src/checkout.tsx',
      'export default () => "checkout metadata entry";',
    );
    const apps = await reconcileWorkspaceRendererIdentities(
      f.root,
      'identity',
      f.apps(),
    );
    const catalog = apps[1];
    assert.equal(catalog.rendererIdentity!.entryName, 'dashboard');
    assert.deepEqual(Object.keys(catalog.rendererIdentities!), [
      'dashboard',
      'checkout',
    ]);
    assert.deepEqual(Object.keys(catalog.routerBindings ?? {}), [
      'dashboard',
      'checkout',
    ]);
    assert.equal(
      catalog.rendererIdentity!.buildId,
      catalog.rendererIdentities!.dashboard.buildId,
    );
    assert.notEqual(
      catalog.rendererIdentity,
      catalog.rendererIdentities!.dashboard,
    );
    for (const [entryName, identity] of Object.entries(
      catalog.rendererIdentities!,
    )) {
      assert.deepEqual(identity, {
        renderer: 'solid',
        appId: catalog.id,
        entryName,
        protocolVersion: 1,
        buildId: createBuildMarker(
          'identity',
          { ...catalog, rendererIdentity: { ...identity, entryName } },
          '1.0.0',
        ),
      });
    }
    assert.equal(
      catalog.deliveryUnit!.buildMarker,
      catalog.rendererIdentity!.buildId,
    );
    assert.equal(catalog.deliveryUnit!.appId, catalog.id);
    assert.equal(catalog.deliveryUnit!.version, '1.0.0');
    assert.notEqual(
      catalog.rendererIdentities!.dashboard.buildId,
      catalog.rendererIdentities!.checkout.buildId,
    );
    const artifact = JSON.parse(
      createUltramodernBuildArtifactJson('identity', catalog),
    );
    assert.equal(artifact.surfaces.ui.rendererIdentity.entryName, 'dashboard');
    assert.deepEqual(
      artifact.surfaces.ui.routerBindings,
      catalog.routerBindings,
    );
    const changedBinding = structuredClone(catalog);
    changedBinding.routerBindings = {
      ...changedBinding.routerBindings!,
      checkout: {
        ...changedBinding.routerBindings!.checkout,
        owner: '@other/route-owner',
      },
    };
    assert.throws(
      () => assertWorkspaceRendererArtifact(changedBinding, artifact),
      /immutable router bindings/,
    );
    assert.notEqual(
      createBuildMarker('identity', {
        ...catalog,
        rendererIdentity: catalog.rendererIdentities!.checkout,
      }),
      createBuildMarker('identity', {
        ...changedBinding,
        rendererIdentity: changedBinding.rendererIdentities!.checkout,
      }),
    );
    const missingBinding = { dashboard: catalog.routerBindings!.dashboard };
    await assert.rejects(
      reconcileWorkspaceRendererIdentities(f.root, 'identity', [catalog], {
        evaluations: new Map([
          [
            catalog.id,
            {
              renderer: 'solid',
              entries: [
                { entryName: 'dashboard', isMainEntry: true },
                { entryName: 'checkout', isMainEntry: false },
              ],
              primaryEntryName: 'dashboard',
              routerBindings: missingBinding,
            },
          ],
        ]),
      }),
      /invalid router bindings from the owning entry resolver/,
    );
  } finally {
    f.clean();
  }
});

test('authored dependency ABI conflicts reject before publishing any projection', async () => {
  const f = fixture();
  try {
    f.write(
      'catalog/package.json',
      JSON.stringify({
        name: '@identity/catalog',
        version: '1.0.0',
        dependencies: { '@solidjs/web': '2.0.0-rc.12' },
      }),
    );
    const before = fs.readFileSync(
      path.join(f.root, 'topology/reference-topology.json'),
    );
    await assert.rejects(
      runSyncDeliveryUnit([], { workspaceRoot: f.root, invocationCwd: f.root }),
      /selected renderer pin|renderer.*pin|must use|disagrees/,
    );
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, 'topology/reference-topology.json')),
      before,
    );
    assert.equal(
      fs.existsSync(path.join(f.root, 'shell/shared/ultramodern-build.json')),
      false,
    );
  } finally {
    f.clean();
  }
});

test('owning discovery includes a convention entry beside explicit secondary entries', async () => {
  const f = fixture();
  try {
    f.write(
      'catalog/checkout.ts',
      'export default () => "checkout metadata entry";',
    );
    f.write(
      'catalog/modern.config.mjs',
      `${f.defineConfigImport}export default defineConfig({
      renderer: 'solid',
      source: { entriesDir: './src', mainEntryName: 'homepage', entries: { checkout: { entry: './checkout.ts', disableMount: true } } }
    });`,
    );
    const apps = await reconcileWorkspaceRendererIdentities(
      f.root,
      'identity',
      f.apps(),
    );
    assert.equal(apps[1].rendererIdentity!.entryName, 'homepage');
    assert.deepEqual(Object.keys(apps[1].rendererIdentities!).sort(), [
      'checkout',
      'homepage',
    ]);
  } finally {
    f.clean();
  }
});

test('sync publishes all projection files atomically, rolls back interruption, and reloads idempotently', async () => {
  const f = fixture();
  try {
    const original = fs.readFileSync(
      path.join(f.root, 'topology/reference-topology.json'),
    );
    const context = { workspaceRoot: f.root, invocationCwd: f.root };
    __transactionTestHooks.afterPublishPath = () => {
      throw new Error('interrupt projection');
    };
    await assert.rejects(
      runSyncDeliveryUnit([], context),
      /interrupt projection/,
    );
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, 'topology/reference-topology.json')),
      original,
    );
    assert.equal(
      fs.existsSync(path.join(f.root, 'shell/shared/ultramodern-build.json')),
      false,
    );
    delete __transactionTestHooks.afterPublishPath;
    assert.equal(await runSyncDeliveryUnit([], context), 0);
    const topology = JSON.parse(
      fs.readFileSync(
        path.join(f.root, 'topology/reference-topology.json'),
        'utf8',
      ),
    );
    assert.equal(topology.verticals[0].renderer, 'solid');
    assert.equal(topology.verticals[1].renderer, 'none');
    const artifactBefore = fs.readFileSync(
      path.join(f.root, 'catalog/shared/ultramodern-build.json'),
    );
    const topologyBefore = fs.readFileSync(
      path.join(f.root, 'topology/reference-topology.json'),
    );
    assert.equal(await runSyncDeliveryUnit([], context), 0);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, 'topology/reference-topology.json')),
      topologyBefore,
    );
    assert.deepEqual(
      fs.readFileSync(
        path.join(f.root, 'catalog/shared/ultramodern-build.json'),
      ),
      artifactBefore,
    );
  } finally {
    f.clean();
  }
});

test('sync evaluates each original config callback once and reuses its checked metadata in staging', async () => {
  const f = fixture();
  const observations = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-renderer-evaluation-observations-'),
  );
  const observedPath = path.join(observations, 'callbacks.jsonl');
  try {
    for (const [id, renderer] of [
      ['shell', 'react'],
      ['catalog', 'solid'],
    ]) {
      f.write(
        `${id}/modern.config.mjs`,
        `${f.defineConfigImport}import fs from 'node:fs';
export default defineConfig(async ({env,command}) => {
  fs.appendFileSync(${JSON.stringify(observedPath)}, JSON.stringify({id: '${id}', env, command}) + '\\n');
  return {renderer: '${renderer}', source: {disableDefaultEntries: true, entries: {main: {entry: './src/entry.ts', disableMount: true}}}};
});`,
      );
    }
    assert.equal(
      await runSyncDeliveryUnit([], {
        workspaceRoot: f.root,
        invocationCwd: f.root,
      }),
      0,
    );
    assert.deepEqual(
      fs
        .readFileSync(observedPath, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
        .sort((left, right) => left.id.localeCompare(right.id)),
      [
        { id: 'catalog', env: 'development', command: 'dev' },
        { id: 'shell', env: 'development', command: 'dev' },
      ],
    );
  } finally {
    f.clean();
    fs.rmSync(observations, { recursive: true, force: true });
  }
});

test('checked metadata reconciles per-entry partitions without replaying authored config', async () => {
  const f = fixture();
  try {
    f.write(
      'shell/modern.config.mjs',
      `${f.defineConfigImport}export default defineConfig({ renderer: 'react', source: { disableDefaultEntries: true, entries: { index: { entry: './src/entry.ts', disableMount: true } } } });`,
    );
    f.write(
      'catalog/modern.config.mjs',
      `${f.defineConfigImport}export default defineConfig({ renderer: 'solid', source: { disableDefaultEntries: true, mainEntryName: 'dashboard', entries: { dashboard: { entry: './src/entry.ts', disableMount: true }, checkout: { entry: './src/checkout.ts', disableMount: true } } } });`,
    );
    f.write(
      'catalog/src/checkout.ts',
      'export default () => "checkout metadata entry";',
    );
    const captured = await captureWorkspaceRendererEvaluations(
      f.root,
      f.apps(),
    );
    for (const id of ['shell', 'catalog'])
      f.write(
        `${id}/modern.config.mjs`,
        `export default () => { throw new Error('config replay is forbidden'); };`,
      );
    const workspace = await readResolvedUltramodernWorkspaceInputs(
      f.root,
      {},
      { evaluations: captured },
    );
    const apps = workspace.apps;
    const [shell, catalog, headless] = apps;
    assert.ok(workspace.config.topology.apps[0].moduleFederation);
    assert.deepEqual(workspace.config.topology.apps[1].moduleFederation, {
      name: 'verticalCatalog',
      role: 'remote',
      exposes: [],
      exposePaths: undefined,
      verticalRefs: undefined,
    });
    assert.equal(workspace.config.topology.apps[2].moduleFederation, undefined);
    assert.equal(shell.rendererIdentity!.entryName, 'index');
    assert.equal(catalog.rendererIdentity!.entryName, 'dashboard');
    assert.notEqual(
      catalog.rendererIdentities!.dashboard.buildId,
      catalog.rendererIdentities!.checkout.buildId,
    );
    assert.equal(
      catalog.rendererIdentity!.buildId,
      catalog.deliveryUnit!.buildMarker,
    );
    assert.equal(headless.renderer, 'none');
    assert.equal(headless.rendererProfile, undefined);
    for (const app of apps) {
      const artifact = JSON.parse(
        createUltramodernBuildArtifactJson('identity', app),
      );
      assert.equal(validateUltramodernBuildArtifact(artifact).ok, true);
      assertWorkspaceRendererArtifact(app, artifact);
      for (const [field, value] of [
        ['appId', 'different-app'],
        ['packageName', '@different/package'],
        ['version', '2.0.0'],
      ]) {
        const changed = structuredClone(artifact);
        changed.deliveryUnit[field] = value;
        for (const surface of Object.values(changed.surfaces))
          (surface as Record<string, unknown>)[field] = value;
        if (changed.surfaces.ui && field === 'appId')
          changed.surfaces.ui.rendererIdentity.appId = value;
        assert.equal(validateUltramodernBuildArtifact(changed).ok, true);
        assert.throws(
          () => assertWorkspaceRendererArtifact(app, changed),
          new RegExp(field),
        );
      }
    }
  } finally {
    f.clean();
  }
});

test('sync keeps a config edit made while it runs', async () => {
  const f = fixture();
  try {
    const configPath = path.join(f.root, 'catalog/modern.config.mjs');
    const concurrentEdit = '\n// concurrent authored config edit\n';
    __transactionTestHooks.beforePublish = () => {
      fs.appendFileSync(configPath, concurrentEdit);
    };
    await runSyncDeliveryUnit([], {
      workspaceRoot: f.root,
      invocationCwd: f.root,
    });
    assert.equal(
      fs.readFileSync(configPath, 'utf8').endsWith(concurrentEdit),
      true,
    );
  } finally {
    __transactionTestHooks.beforePublish = undefined;
    f.clean();
  }
});
