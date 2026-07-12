import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runUltramodernToolingCli } from '../src/ultramodern-tooling/commands';
import { addUltramodernVertical } from '../src/ultramodern-workspace';
import { createWorkspace, snapshotWorkspace } from './helpers/workspace-kit';

const forbiddenModuleFederationWorkarounds = [
  '@effect-diagnostics',
  'disableDynamicRemoteTypeHints',
  'enableBridgeRouter',
  "treeShakingSharedExcludePlugins: ['RspackModuleFederationPlugin']",
];

function readGeneratedFederationSources(workspaceDir: string) {
  return Object.keys(snapshotWorkspace(workspaceDir))
    .filter(
      relativePath =>
        relativePath.endsWith('/module-federation.config.ts') ||
        relativePath.endsWith('/backend-federation.config.ts'),
    )
    .map(relativePath => ({
      relativePath,
      source: fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
    }));
}

function assertNativeModuleFederationWorkspace(workspaceDir: string) {
  for (const { relativePath, source } of readGeneratedFederationSources(
    workspaceDir,
  )) {
    for (const workaround of forbiddenModuleFederationWorkarounds) {
      assert.equal(
        source.includes(workaround),
        false,
        `${relativePath} must not emit ${workaround}`,
      );
    }
  }

  const remoteComponents = fs.readFileSync(
    path.join(
      workspaceDir,
      'apps/shell-super-app/src/routes/vertical-components.tsx',
    ),
    'utf-8',
  );
  assert.match(
    remoteComponents,
    /from '@module-federation\/modern-js-v3\/react';/u,
  );
  assert.match(
    remoteComponents,
    /createRemoteComponent\(\s*\(\) => import\('[^']+\/Widget'\)/u,
  );
  assert.match(remoteComponents, /fallback: <RemoteUnavailable \/>/u);
  for (const fallback of [
    '@module-federation/bridge-react',
    'createHydratedRemote',
    'createRemoteFallback',
    'loadRemote',
    'useEffect',
    'useMemo',
    'useState',
  ]) {
    assert.equal(
      remoteComponents.includes(fallback),
      false,
      `vertical remote loader must use native Module Federation loading without ${fallback}`,
    );
  }
}

function createWorkspaceWithVertical(packageName: string, tempPrefix: string) {
  const workspace = createWorkspace(packageName, { tempPrefix });
  addUltramodernVertical({
    workspaceRoot: workspace.workspaceDir,
    name: 'catalog',
    modernVersion: '3.2.1',
  });
  return workspace;
}

test('fresh generation emits native Module Federation configs and vertical loaders', () => {
  const { tempRoot, workspaceDir } = createWorkspaceWithVertical(
    'native-mf-fresh',
    'um-native-mf-fresh-',
  );

  try {
    assertNativeModuleFederationWorkspace(workspaceDir);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('migration converges Module Federation configs and vertical loaders', async () => {
  const { tempRoot, workspaceDir } = createWorkspaceWithVertical(
    'native-mf-migrate',
    'um-native-mf-migrate-',
  );

  try {
    const shellConfigPath = path.join(
      workspaceDir,
      'apps/shell-super-app/module-federation.config.ts',
    );
    const remoteComponentsPath = path.join(
      workspaceDir,
      'apps/shell-super-app/src/routes/vertical-components.tsx',
    );
    fs.appendFileSync(
      shellConfigPath,
      "\n// @effect-diagnostics processEnv:off\nconst enableBridgeRouter = false;\nconst disableDynamicRemoteTypeHints = true;\nconst treeShakingSharedExcludePlugins = ['RspackModuleFederationPlugin'];\n",
    );
    fs.appendFileSync(
      remoteComponentsPath,
      '\nconst createHydratedRemote = () => undefined;\n',
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    assertNativeModuleFederationWorkspace(workspaceDir);
    const afterFirstMigration = snapshotWorkspace(workspaceDir);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    assert.deepEqual(snapshotWorkspace(workspaceDir), afterFirstMigration);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});
