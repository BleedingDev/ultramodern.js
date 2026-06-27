import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runUltramodernToolingCli } from '../src/ultramodern-tooling/commands';
import {
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../src/ultramodern-tooling/config';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

const legacyContractPath = '.modernjs/ultramodern-generated-contract.json';
const legacyPackageSourcePath = '.modernjs/ultramodern-package-source.json';

function scaffoldWorkspace(name: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-tooling-'));
  const workspaceDir = path.join(tempRoot, name);
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: name,
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: {
      strategy: 'install',
      modernPackageVersion: '3.2.0-ultramodern.108',
    },
  });
  return { tempRoot, workspaceDir };
}

test('UltraModern tooling config prefers compact config and falls back to legacy contract', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-config');

  try {
    const compact = readUltramodernConfig(workspaceDir);
    assert.equal(compact.source, 'compact');
    assert.equal(compact.workspace.packageScope, 'tooling-config');
    assert.equal(compact.packageSource?.strategy, 'install');
    assert.equal(
      compact.packageSource?.modernPackageVersion,
      '3.2.0-ultramodern.108',
    );
    assert.deepEqual(
      compact.topology.apps.map(app => app.id),
      ['shell-super-app'],
    );
    assert.equal(compact.topology.apps[0].moduleFederation?.role, 'host');
    assert.equal(
      fs.existsSync(path.join(workspaceDir, legacyContractPath)),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, legacyPackageSourcePath)),
      false,
    );

    const legacyWorkspaceDir = path.join(tempRoot, 'legacy-tooling-config');
    fs.mkdirSync(path.join(legacyWorkspaceDir, '.modernjs'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(legacyWorkspaceDir, 'topology/local-overlays'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(legacyWorkspaceDir, 'package.json'),
      `${JSON.stringify({ name: 'legacy-tooling-config' }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(legacyWorkspaceDir, 'topology/local-overlays/development.json'),
      `${JSON.stringify({ ports: { 'shell-super-app': 3020 } }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(legacyWorkspaceDir, legacyPackageSourcePath),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          strategy: 'install',
          modernPackages: {
            specifier: '3.2.0-ultramodern.108',
            registry: 'https://registry.npmjs.org/',
            aliases: {
              '@modern-js/app-tools': '@bleedingdev/modern-js-app-tools',
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      path.join(legacyWorkspaceDir, legacyContractPath),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profile: 'cloudflare-ssr-mf-effect-v1',
          apps: [
            {
              id: 'shell-super-app',
              kind: 'shell',
              path: 'apps/shell-super-app',
              package: '@legacy-tooling-config/shell-super-app',
              styling: { tailwind: true },
              moduleFederation: {
                name: 'shellSuperApp',
                verticalRefs: [],
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const legacy = readUltramodernConfig(legacyWorkspaceDir);
    assert.equal(legacy.source, 'legacy');
    assert.equal(legacy.workspace.packageScope, 'legacy-tooling-config');
    assert.equal(legacy.packageSource?.strategy, 'install');
    assert.equal(
      legacy.packageSource?.modernPackageVersion,
      '3.2.0-ultramodern.108',
    );
    assert.equal(legacy.packageSource?.aliasScope, 'bleedingdev');
    assert.equal(legacy.packageSource?.aliasPackageNamePrefix, 'modern-js-');
    assert.deepEqual(
      legacy.topology.apps.map(app => app.id),
      ['shell-super-app'],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern mf-types validates real Module Federation config files', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-mf');

  try {
    assert.equal(
      await runUltramodernToolingCli(
        ['mf-types', 'apps/shell-super-app'],
        workspaceDir,
      ),
      0,
    );

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    assert.equal(
      await runUltramodernToolingCli(
        ['mf-types', 'verticals/catalog'],
        workspaceDir,
      ),
      1,
      'remote exposes must require a non-empty DTS archive',
    );

    const archivePath = path.join(
      workspaceDir,
      'verticals/catalog/dist/@mf-types.zip',
    );
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, 'zip');

    assert.equal(
      await runUltramodernToolingCli(
        ['mf-types', 'verticals/catalog'],
        workspaceDir,
      ),
      0,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('compact UltraModern config maps component exposes to concrete DTS source files', () => {
  const apps = workspaceAppsFromToolingConfig({
    schemaVersion: 1,
    source: 'compact',
    sourcePath: '.modernjs/ultramodern.json',
    workspace: {
      packageScope: 'tooling-exposes',
    },
    features: {
      tailwind: true,
    },
    topology: {
      apps: [
        {
          id: 'shell-super-app',
          kind: 'shell',
          path: 'apps/shell-super-app',
          moduleFederation: {
            role: 'host',
            name: 'shellSuperApp',
            exposes: [],
            verticalRefs: ['catalog'],
          },
        },
        {
          id: 'catalog',
          kind: 'vertical',
          path: 'verticals/catalog',
          domain: 'catalog',
          moduleFederation: {
            role: 'remote',
            name: 'verticalCatalog',
            exposes: ['./ProductGrid', './Route', './Widget', './Custom'],
            exposePaths: {
              './Custom': './src/features/custom-surface.tsx',
            },
          },
          effectApi: {
            stem: 'catalog',
            prefix: '/catalog-api',
            consumedBy: ['shell-super-app', 'catalog'],
          },
        },
      ],
    },
  });

  const catalog = apps.find(app => app.id === 'catalog');

  assert.deepEqual(catalog?.exposes, {
    './Custom': './src/features/custom-surface.tsx',
    './ProductGrid': './src/components/product-grid.tsx',
    './Route': './src/federation-entry.tsx',
    './Widget': './src/components/catalog-widget.tsx',
  });
});
