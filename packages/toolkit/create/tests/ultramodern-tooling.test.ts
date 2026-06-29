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

const retiredContractPath = '.modernjs/ultramodern-generated-contract.json';
const retiredPackageSourcePath = '.modernjs/ultramodern-package-source.json';

function readJson(workspaceDir: string, relativePath: string) {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  );
}

function writeJson(workspaceDir: string, relativePath: string, value: unknown) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

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

test('UltraModern tooling config reads compact config and rejects retired metadata', () => {
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
      fs.existsSync(path.join(workspaceDir, retiredContractPath)),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, retiredPackageSourcePath)),
      false,
    );

    const retiredMetadataWorkspaceDir = path.join(
      tempRoot,
      'retired-metadata-tooling-config',
    );
    fs.mkdirSync(path.join(retiredMetadataWorkspaceDir, '.modernjs'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(retiredMetadataWorkspaceDir, retiredPackageSourcePath),
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
      path.join(retiredMetadataWorkspaceDir, retiredContractPath),
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

    assert.throws(
      () => readUltramodernConfig(retiredMetadataWorkspaceDir),
      /Missing UltraModern config\. Expected \.modernjs\/ultramodern\.json/u,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate-strict-effect updates package cohort and direct API metadata', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-migrate');

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    const catalog = topology.verticals.find(
      (vertical: Record<string, unknown>) => vertical.id === 'catalog',
    );
    catalog.api = {
      ...catalog.api,
      effect: {
        stem: 'catalog',
        prefix: '/catalog-api',
        consumedBy: ['shell-super-app', 'catalog'],
      },
      bff: {
        prefix: '/catalog-api',
        strictEffectApproach: false,
      },
      contract: {
        export: './shared/effect/api',
        path: 'verticals/catalog/shared/effect/api.ts',
      },
      client: {
        export: './effect/client',
        path: 'verticals/catalog/src/effect/catalog-client.ts',
      },
      serverEntry: 'verticals/catalog/api/effect/index.ts',
    };
    writeJson(workspaceDir, 'topology/reference-topology.json', topology);

    assert.equal(
      await runUltramodernToolingCli(
        [
          'migrate-strict-effect',
          '--version',
          '3.5.0-ultramodern.1',
          '--skip-install',
        ],
        workspaceDir,
      ),
      0,
    );

    const compactConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    assert.equal(
      compactConfig.packageSource.modernPackageVersion,
      '3.5.0-ultramodern.1',
    );
    assert.equal(compactConfig.packageSource.aliasScope, 'bleedingdev');
    assert.equal(
      compactConfig.packageSource.aliasPackageNamePrefix,
      'modern-js-',
    );

    const rootPackage = readJson(workspaceDir, 'package.json');
    assert.equal(
      rootPackage.devDependencies['@modern-js/create'],
      'npm:@bleedingdev/modern-js-create@3.5.0-ultramodern.1',
    );
    assert.equal(rootPackage.modernjs.packageSource.strategy, 'install');

    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    assert.equal(
      shellPackage.dependencies['@modern-js/plugin-bff'],
      'npm:@bleedingdev/modern-js-plugin-bff@3.5.0-ultramodern.1',
    );

    const migratedTopology = readJson(
      workspaceDir,
      'topology/reference-topology.json',
    );
    const migratedCatalog = migratedTopology.verticals.find(
      (vertical: Record<string, unknown>) => vertical.id === 'catalog',
    );
    assert.equal(migratedCatalog.api.effect, undefined);
    assert.equal(migratedCatalog.api.bff.strictEffectApproach, true);
    assert.equal(
      migratedCatalog.api.serverEntry,
      'verticals/catalog/api/index.ts',
    );
    assert.equal(migratedCatalog.api.contract.export, './api');
    assert.equal(
      migratedCatalog.api.contract.path,
      'verticals/catalog/shared/api.ts',
    );
    assert.equal(migratedCatalog.api.client.export, './api/client');
    assert.equal(
      migratedCatalog.api.client.path,
      'verticals/catalog/src/api/catalog-client.ts',
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
          api: {
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
