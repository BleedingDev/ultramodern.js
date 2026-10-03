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
  return {
    root,
    write,
    config,
    apps,
    defineConfigImport,
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
        .map(line => JSON.parse(line)),
      [
        { id: 'shell', env: 'development', command: 'dev' },
        { id: 'catalog', env: 'development', command: 'dev' },
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
      {
        evaluations: captured.evaluations,
      },
    );
    const apps = workspace.apps;
    const [shell, catalog, headless] = apps;
    assert.ok(workspace.config.topology.apps[0].moduleFederation);
    assert.equal(workspace.config.topology.apps[1].moduleFederation, undefined);
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

test('sync rejects a source edit made after staging and preserves the concurrent authored edit', async () => {
  const f = fixture();
  try {
    const topologyPath = path.join(f.root, 'topology/reference-topology.json');
    const originalTopology = fs.readFileSync(topologyPath);
    const configPath = path.join(f.root, 'catalog/modern.config.mjs');
    const concurrentEdit = '\n// concurrent authored config edit\n';
    __transactionTestHooks.beforePublish = () => {
      fs.appendFileSync(configPath, concurrentEdit);
    };
    await assert.rejects(
      runSyncDeliveryUnit([], {
        workspaceRoot: f.root,
        invocationCwd: f.root,
      }),
      /changed|snapshot|source/i,
    );
    assert.deepEqual(fs.readFileSync(topologyPath), originalTopology);
    assert.equal(
      fs.readFileSync(configPath, 'utf8').endsWith(concurrentEdit),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(f.root, 'shell/shared/ultramodern-build.json')),
      false,
    );
  } finally {
    f.clean();
  }
});
