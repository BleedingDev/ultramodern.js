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
import {
  createAppMfTypesTsConfig,
  createAppTsConfig,
  createSharedPackageTsConfig,
} from '../src/ultramodern-workspace/package-json';
import {
  DRIZZLE_ORM_VERSION,
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  OXFMT_VERSION,
  TYPESCRIPT_NATIVE_PREVIEW_VERSION,
} from '../src/ultramodern-workspace/versions';

const retiredContractPath = '.modernjs/ultramodern-generated-contract.json';
const retiredPackageSourcePath = '.modernjs/ultramodern-package-source.json';

function readJson(workspaceDir: string, relativePath: string) {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  );
}

function readText(workspaceDir: string, relativePath: string) {
  return fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');
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

function assertTargetIsolatedModernConfig(source: string, label: string) {
  assert.match(
    source,
    /const buildTarget = cloudflareDeployEnabled \? 'cloudflare' : 'web';/,
    `${label} must derive mutable build paths from the active target`,
  );
  assert.match(
    source,
    /const buildOutputRoot = cloudflareDeployEnabled \? 'dist-cloudflare' : 'dist';/,
    `${label} must isolate normal and Cloudflare output roots`,
  );
  assert.match(
    source,
    /const buildTempDirectory = `node_modules\/\.modern-js-\$\{appId\}-\$\{buildTarget\}`;/,
    `${label} must isolate normal and Cloudflare Modern temp directories`,
  );
  assert.match(
    source,
    /const buildCacheDirectory = `node_modules\/\.cache\/rspack-\$\{appId\}-\$\{buildTarget\}`;/,
    `${label} must isolate Rspack cache directories by target`,
  );
  assert.match(
    source,
    /root: buildOutputRoot,/,
    `${label} must pass the per-target output root to the builder`,
  );
  assert.match(
    source,
    /tempDir: buildTempDirectory,/,
    `${label} must pass the per-target Modern temp directory to the builder`,
  );
  assert.match(
    source,
    /cacheDigest: \[appId, buildTarget\],/,
    `${label} must include the target in the Rspack cache digest`,
  );
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

    const rootPackageBefore = readJson(workspaceDir, 'package.json');
    rootPackageBefore.devDependencies['@typescript/native-preview'] =
      '7.0.0-dev.20260620.1';
    rootPackageBefore.devDependencies['drizzle-orm'] = DRIZZLE_ORM_VERSION;
    rootPackageBefore.devDependencies.oxfmt = '0.55.0';
    writeJson(workspaceDir, 'package.json', rootPackageBefore);

    for (const packageFile of [
      'apps/shell-super-app/package.json',
      'verticals/catalog/package.json',
    ]) {
      const packageJson = readJson(workspaceDir, packageFile);
      packageJson.scripts['cloudflare:build'] = packageJson.scripts[
        'cloudflare:build'
      ].replace(
        'MODERNJS_DEPLOY=cloudflare modern deploy --skip-build',
        'MODERNJS_DEPLOY=cloudflare modern deploy',
      );
      packageJson.scripts['cloudflare:deploy'] =
        `${packageJson.scripts['cloudflare:deploy']} --skip-build`;
      writeJson(workspaceDir, packageFile, packageJson);
    }

    const pnpmWorkspaceFile = path.join(workspaceDir, 'pnpm-workspace.yaml');
    fs.writeFileSync(
      pnpmWorkspaceFile,
      fs
        .readFileSync(pnpmWorkspaceFile, 'utf-8')
        .replace(
          `'@effect/vitest>effect': '${EFFECT_VERSION}'`,
          "'@effect/vitest>effect': '4.0.0-beta.89'",
        )
        .replace(
          `'@effect/vitest': ${EFFECT_VITEST_VERSION}`,
          "'@effect/vitest': 4.0.0-beta.89",
        )
        .replace(`effect: ${EFFECT_VERSION}`, 'effect: 4.0.0-beta.89')
        .replace(
          `  'effect@${EFFECT_VERSION}': patches/effect-schema-error-type-id.patch\n`,
          '',
        )
        .replace(
          `  'drizzle-orm@${DRIZZLE_ORM_VERSION}': patches/drizzle-orm-ts7-strict-declarations.patch\n`,
          '',
        )
        .replace(
          `  - 'effect@${EFFECT_VERSION}'\n  - '@effect/opentelemetry@${EFFECT_VERSION}'\n`,
          '',
        )
        .replace(
          `trustPolicyExclude:\n  - 'effect@${EFFECT_VERSION}'\n  - '@effect/opentelemetry@${EFFECT_VERSION}'\n`,
          '',
        ),
      'utf-8',
    );
    fs.rmSync(
      path.join(workspaceDir, 'patches/effect-schema-error-type-id.patch'),
      {
        force: true,
      },
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        'patches/drizzle-orm-ts7-strict-declarations.patch',
      ),
      {
        force: true,
      },
    );

    const baseTsConfig = readJson(workspaceDir, 'tsconfig.base.json');
    baseTsConfig.compilerOptions.skipLibCheck = true;
    writeJson(workspaceDir, 'tsconfig.base.json', baseTsConfig);

    const gitignorePath = path.join(workspaceDir, '.gitignore');
    fs.writeFileSync(
      gitignorePath,
      fs
        .readFileSync(gitignorePath, 'utf-8')
        .replace(/^\.mf\/\n/mu, '')
        .replace(/^\*\*\/\.mf\/\n/mu, '')
        .replace(/^dist-cloudflare\/\n/mu, ''),
      'utf-8',
    );

    for (const sharedPackageDir of [
      'packages/shared-contracts',
      'packages/shared-design-tokens',
    ]) {
      writeJson(workspaceDir, `${sharedPackageDir}/tsconfig.json`, {
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          composite: true,
          incremental: true,
          tsBuildInfoFile: `../../node_modules/.cache/tsgo/${sharedPackageDir.replace(/[^a-zA-Z0-9._-]+/gu, '__')}.tsbuildinfo`,
        },
        include: ['src'],
      });
    }

    for (const appDir of ['apps/shell-super-app', 'verticals/catalog']) {
      const appTsConfig = readJson(workspaceDir, `${appDir}/tsconfig.json`);
      appTsConfig.include = [
        ...appTsConfig.include,
        'modern.config.ts',
        'module-federation.config.ts',
      ];
      writeJson(workspaceDir, `${appDir}/tsconfig.json`, appTsConfig);

      const mfTypesTsConfig = readJson(
        workspaceDir,
        `${appDir}/tsconfig.mf-types.json`,
      );
      mfTypesTsConfig.extends = './tsconfig.json';
      writeJson(
        workspaceDir,
        `${appDir}/tsconfig.mf-types.json`,
        mfTypesTsConfig,
      );

      fs.writeFileSync(
        path.join(workspaceDir, appDir, 'src/modern-app-env.d.ts'),
        `/// <reference types='@modern-js/app-tools/types' />

declare global {
  const ULTRAMODERN_SITE_URL: string;
}

declare module '*.svg' {}

declare module '*.css' {}
`,
        'utf-8',
      );
    }

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
    assert.equal(
      rootPackage.devDependencies['@typescript/native-preview'],
      TYPESCRIPT_NATIVE_PREVIEW_VERSION,
    );
    assert.equal(rootPackage.devDependencies.oxfmt, OXFMT_VERSION);
    assert.equal(rootPackage.modernjs.packageSource.strategy, 'install');

    const pnpmWorkspace = fs.readFileSync(pnpmWorkspaceFile, 'utf-8');
    assert.match(
      pnpmWorkspace,
      new RegExp(`'@effect/vitest>effect': '${EFFECT_VERSION}'`, 'u'),
    );
    assert.match(
      pnpmWorkspace,
      new RegExp(`'@effect/vitest': ${EFFECT_VITEST_VERSION}`, 'u'),
    );
    assert.match(pnpmWorkspace, new RegExp(`effect: ${EFFECT_VERSION}`, 'u'));
    assert.match(
      pnpmWorkspace,
      new RegExp(
        `'effect@${EFFECT_VERSION}': patches/effect-schema-error-type-id\\.patch`,
        'u',
      ),
    );
    assert.match(
      pnpmWorkspace,
      new RegExp(
        `'drizzle-orm@${DRIZZLE_ORM_VERSION}': patches/drizzle-orm-ts7-strict-declarations\\.patch`,
        'u',
      ),
    );
    assert.match(
      pnpmWorkspace,
      new RegExp(
        `minimumReleaseAgeExclude:\\n(?:  - .+\\n)*  - 'effect@${EFFECT_VERSION}'`,
        'u',
      ),
    );
    assert.match(
      pnpmWorkspace,
      new RegExp(
        `minimumReleaseAgeExclude:\\n(?:  - .+\\n)*  - '@effect/opentelemetry@${EFFECT_VERSION}'`,
        'u',
      ),
    );
    assert.match(
      pnpmWorkspace,
      new RegExp(
        `trustPolicyExclude:\\n(?:  - .+\\n)*  - 'effect@${EFFECT_VERSION}'`,
        'u',
      ),
    );
    assert.match(
      pnpmWorkspace,
      new RegExp(
        `trustPolicyExclude:\\n(?:  - .+\\n)*  - '@effect/opentelemetry@${EFFECT_VERSION}'`,
        'u',
      ),
    );
    assert.ok(
      fs.existsSync(
        path.join(workspaceDir, 'patches/effect-schema-error-type-id.patch'),
      ),
      'migrate-strict-effect must restore the generated Effect declaration patch',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          'patches/drizzle-orm-ts7-strict-declarations.patch',
        ),
      ),
      'migrate-strict-effect must restore the generated Drizzle declaration patch',
    );

    const migratedBaseTsConfig = readJson(workspaceDir, 'tsconfig.base.json');
    assert.equal(
      migratedBaseTsConfig.compilerOptions.skipLibCheck,
      undefined,
      'migrate-strict-effect must remove generated skipLibCheck',
    );
    const migratedGitignore = fs.readFileSync(gitignorePath, 'utf-8');
    assert.match(
      migratedGitignore,
      /^\.mf\/$/mu,
      'migrate-strict-effect must ignore root Module Federation diagnostics',
    );
    assert.match(
      migratedGitignore,
      /^\*\*\/\.mf\/$/mu,
      'migrate-strict-effect must ignore per-app Module Federation diagnostics',
    );
    assert.match(
      migratedGitignore,
      /^dist-cloudflare\/$/mu,
      'migrate-strict-effect must ignore Cloudflare build output',
    );

    const shellTsConfig = readJson(
      workspaceDir,
      'apps/shell-super-app/tsconfig.json',
    );
    assert.deepEqual(shellTsConfig.include, [
      'src',
      'locales/**/*.json',
      'package.json',
      'shared',
    ]);

    const catalogTsConfig = readJson(
      workspaceDir,
      'verticals/catalog/tsconfig.json',
    );
    assert.deepEqual(catalogTsConfig.include, [
      'src',
      'locales/**/*.json',
      'package.json',
      'shared',
      'api',
    ]);

    for (const sharedPackageDir of [
      'packages/shared-contracts',
      'packages/shared-design-tokens',
    ]) {
      assert.deepEqual(
        readJson(workspaceDir, `${sharedPackageDir}/tsconfig.json`),
        createSharedPackageTsConfig(sharedPackageDir),
      );
    }

    for (const appDir of ['apps/shell-super-app', 'verticals/catalog']) {
      const mfTypesTsConfig = readJson(
        workspaceDir,
        `${appDir}/tsconfig.mf-types.json`,
      );
      assert.equal(mfTypesTsConfig.extends, '../../tsconfig.base.json');

      const appEnv = fs.readFileSync(
        path.join(workspaceDir, appDir, 'src/modern-app-env.d.ts'),
        'utf-8',
      );
      assert.match(appEnv, /^import '@modern-js\/app-tools\/types';/u);
      assert.doesNotMatch(appEnv, /<reference types=/u);
      assert.doesNotMatch(appEnv, /declare module '\*\.svg'/u);
      assert.doesNotMatch(appEnv, /declare module '\*\.css'/u);
    }

    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    assert.equal(
      shellPackage.dependencies['@modern-js/plugin-bff'],
      'npm:@bleedingdev/modern-js-plugin-bff@3.5.0-ultramodern.1',
    );
    assert.match(
      shellPackage.scripts['cloudflare:build'],
      /MODERNJS_DEPLOY=cloudflare modern deploy --skip-build/u,
    );
    assert.doesNotMatch(
      shellPackage.scripts['cloudflare:build'],
      /--target dist && ULTRAMODERN_ZEPHYR=false MODERNJS_DEPLOY=cloudflare modern deploy/u,
    );
    assert.equal(
      shellPackage.scripts['cloudflare:deploy'],
      'ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS=true pnpm run cloudflare:build && wrangler deploy --config .output/wrangler.json',
    );
    assertTargetIsolatedModernConfig(
      readText(workspaceDir, 'apps/shell-super-app/modern.config.ts'),
      'shell modern.config.ts',
    );

    const catalogPackage = readJson(
      workspaceDir,
      'verticals/catalog/package.json',
    );
    assert.match(
      catalogPackage.scripts['cloudflare:build'],
      /MODERNJS_DEPLOY=cloudflare modern deploy --skip-build/u,
    );
    assert.doesNotMatch(
      catalogPackage.scripts['cloudflare:build'],
      /--target dist && ULTRAMODERN_ZEPHYR=false MODERNJS_DEPLOY=cloudflare modern deploy/u,
    );
    assert.equal(
      catalogPackage.scripts['cloudflare:deploy'],
      'ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS=true pnpm run cloudflare:build && wrangler deploy --config .output/wrangler.json',
    );
    assertTargetIsolatedModernConfig(
      readText(workspaceDir, 'verticals/catalog/modern.config.ts'),
      'catalog modern.config.ts',
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

test('UltraModern migrate-strict-effect removes unused Drizzle declaration patches', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-no-drizzle');

  try {
    const pnpmWorkspaceFile = path.join(workspaceDir, 'pnpm-workspace.yaml');
    fs.writeFileSync(
      pnpmWorkspaceFile,
      fs
        .readFileSync(pnpmWorkspaceFile, 'utf-8')
        .replace(
          `  'effect@${EFFECT_VERSION}': patches/effect-schema-error-type-id.patch\n`,
          `  'effect@${EFFECT_VERSION}': patches/effect-schema-error-type-id.patch\n  'drizzle-orm@${DRIZZLE_ORM_VERSION}': patches/drizzle-orm-ts7-strict-declarations.patch\n`,
        ),
      'utf-8',
    );

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

    const pnpmWorkspace = fs.readFileSync(pnpmWorkspaceFile, 'utf-8');
    assert.doesNotMatch(
      pnpmWorkspace,
      new RegExp(
        `'drizzle-orm@${DRIZZLE_ORM_VERSION}': patches/drizzle-orm-ts7-strict-declarations\\.patch`,
        'u',
      ),
      'migrate-strict-effect must remove stale Drizzle patches when drizzle-orm is not installed',
    );
    assert.equal(
      fs.existsSync(
        path.join(
          workspaceDir,
          'patches/drizzle-orm-ts7-strict-declarations.patch',
        ),
      ),
      false,
      'migrate-strict-effect must remove the generated Drizzle patch file when it is unused',
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
  assert.deepEqual(
    (createAppMfTypesTsConfig(catalog!) as Record<string, unknown>).include,
    [
      'src/federation-entry.tsx',
      'src/components/product-grid.tsx',
      'src/components/catalog-widget.tsx',
      'src/features/custom-surface.tsx',
      'src/modern-app-env.d.ts',
    ],
    'custom expose order must keep the route entry first for MF DTS validation',
  );
});

test('generated app tsconfig uses sibling-relative vertical references', () => {
  const apps = workspaceAppsFromToolingConfig({
    schemaVersion: 1,
    source: 'compact',
    sourcePath: '.modernjs/ultramodern.json',
    workspace: {
      packageScope: 'tooling-references',
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
            verticalRefs: ['catalog', 'checkout'],
          },
        },
        {
          id: 'catalog',
          kind: 'vertical',
          path: 'verticals/catalog',
          moduleFederation: {
            role: 'remote',
            exposes: ['./Route'],
          },
          api: {
            stem: 'catalog',
            prefix: '/catalog-api',
            consumedBy: ['shell-super-app', 'catalog', 'checkout'],
          },
        },
        {
          id: 'checkout',
          kind: 'vertical',
          path: 'verticals/checkout',
          moduleFederation: {
            role: 'remote',
            exposes: ['./Route'],
            verticalRefs: ['catalog'],
          },
          api: {
            stem: 'checkout',
            prefix: '/checkout-api',
            consumedBy: ['shell-super-app', 'checkout'],
          },
        },
      ],
    },
  });
  const checkout = apps.find(app => app.id === 'checkout');
  assert.deepEqual(
    (
      createAppTsConfig(
        checkout!,
        apps.filter(app => app.kind !== 'shell'),
      ) as Record<string, unknown>
    ).references,
    [
      { path: '../../packages/shared-contracts' },
      { path: '../../packages/shared-design-tokens' },
      { path: '../catalog' },
    ],
  );
});
