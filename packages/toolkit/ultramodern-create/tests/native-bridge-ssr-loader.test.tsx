import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { type ComponentType, createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server.edge';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import {
  createFederatedComponentsRegistry,
  createShellRemoteComponents,
} from '../src/ultramodern-workspace/demo-components';
import {
  createVerticalDescriptor,
  remoteDependencyAlias,
  shellApp,
} from '../src/ultramodern-workspace/descriptors';

const require = createRequire(__filename);
const {
  createDistributedSsrComponent,
} = require('../../../runtime/federation-runtime/dist/cjs/module-federation/distributed-ssr.js');
const bridge = require('@module-federation/modern-js-v3/react');
const runtime = require('@module-federation/modern-js-v3/runtime');

async function render(Component: ComponentType) {
  const stream = await renderToReadableStream(createElement(Component));
  await stream.allReady;
  return new Response(stream).text();
}

test('generated native bridge loaders preserve runtime module identity during Node SSR', async () => {
  const remote = {
    ...createVerticalDescriptor('inventory', 4101),
    exposes: { './Widget': './src/Widget.tsx' },
  };
  const alias = remoteDependencyAlias(remote);
  const id = `${alias}/Widget`;
  const instance = runtime.createInstance({
    name: 'generated-bridge-ssr-test',
    remotes: [
      { name: alias, entry: 'https://inventory.invalid/remoteEntry.js' },
    ],
    plugins: [
      {
        name: 'in-memory-remote-entry',
        loadEntry: () => ({
          init: () => {},
          get: async () => () => ({
            default: () =>
              createElement(
                'section',
                { 'data-native-remote': id },
                'inventory',
              ),
          }),
        }),
      },
    ],
  });
  const loaded = await instance.loadRemote(id);
  assert.equal(loaded[Symbol.for('mf_module_id')], id);
  // Import namespace conversion copies named exports, losing this native
  // non-enumerable identity. Exercise the bridge's real getData failure.
  const namespace = { ...loaded };
  assert.equal(namespace[Symbol.for('mf_module_id')], undefined);
  const broken = bridge.createLazyComponent({
    instance,
    loader: async () => namespace,
    loading: null,
    fallback: 'remote-unavailable',
    injectLink: false,
  });
  assert.match(await render(broken), /remote-unavailable/u);

  const source = createFederatedComponentsRegistry(
    'native-bridge-ssr',
    { ...shellApp, verticalRefs: [remote.id] },
    [remote],
  );
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(
    transformSync(source, {
      loader: 'tsx',
      format: 'cjs',
      supported: { 'dynamic-import': false },
    }).code,
    {
      module,
      exports: module.exports,
      require(specifier: string) {
        if (specifier === id) return loaded;
        if (specifier === '@modern-js/federation-runtime/distributed-ssr') {
          return { createDistributedSsrComponent };
        }
        if (specifier === '@module-federation/modern-js-v3/react')
          return bridge;
        assert.equal(specifier, '@module-federation/modern-js-v3/runtime');
        return {
          getInstance: () => instance,
          loadRemote: instance.loadRemote.bind(instance),
        };
      },
    },
  );
  const createComponents = module.exports.createFederatedComponents as (
    fallback: string,
  ) => { Widget: ComponentType };
  const html = await render(createComponents('remote-unavailable').Widget);
  assert.ok(html.includes(`data-native-remote="${id}"`));
  assert.ok(
    html.includes('data-modern-distributed-ssr-boundary="inventory::./Widget"'),
  );
  assert.ok(!html.includes('remote-unavailable'));
  const shellModule = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(
    transformSync(
      `${createShellRemoteComponents(shellApp, [remote])}\nexport { InventoryWidget };`,
      {
        loader: 'tsx',
        format: 'cjs',
        jsx: 'automatic',
        supported: { 'dynamic-import': false },
      },
    ).code,
    {
      module: shellModule,
      exports: shellModule.exports,
      require(specifier: string) {
        if (specifier === id) return namespace;
        if (specifier === '@modern-js/federation-runtime/distributed-ssr')
          return { createDistributedSsrComponent };
        if (specifier === '@module-federation/modern-js-v3/react')
          return bridge;
        if (specifier === '@module-federation/modern-js-v3/runtime')
          return {
            getInstance: () => instance,
            loadRemote: instance.loadRemote.bind(instance),
          };
        if (specifier === '@modern-js/plugin-i18n/runtime')
          return { useModernI18n: () => ({ t: (value: string) => value }) };
        return require(specifier);
      },
    },
  );
  const shellHtml = await render(
    shellModule.exports.InventoryWidget as ComponentType,
  );
  assert.ok(shellHtml.includes(`data-native-remote="${id}"`));
  assert.ok(!shellHtml.includes('shell.remoteUnavailable'));
});

test('adding ERP verticals writes native loaders into the final shell routes', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-native-shell-loader-'),
  );
  const targetDir = path.join(tempRoot, 'workspace');
  try {
    await generateUltramodernWorkspace({
      targetDir,
      packageName: 'native-shell-loader',
      modernVersion: '3.9.3',
      generateAgentFiles: false,
      enableTailwind: false,
      packageSource: { strategy: 'workspace' },
    });
    const names = [
      'inventory',
      'finance',
      'people',
      'analytics',
      'orders',
      'procurement',
      'billing',
      'logistics',
      'support',
      'compliance',
    ];
    for (const name of names) {
      await addUltramodernVertical({
        workspaceRoot: targetDir,
        name,
        modernVersion: '3.9.3',
        enableTailwind: false,
        packageSource: { strategy: 'workspace' },
      });
    }
    const source = fs.readFileSync(
      path.join(
        targetDir,
        'apps/shell-super-app/src/routes/vertical-components.tsx',
      ),
      'utf8',
    );
    assert.match(source, /import \{ getInstance, loadRemote \}/u);
    for (const name of names) {
      assert.ok(
        source.includes(`loadRemote<RemoteComponentModule>('${name}/Widget')`),
      );
      assert.ok(!source.includes(`import('${name}/Widget')`));
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
