import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runUltramodernToolingCli } from '../src/ultramodern-tooling/commands';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';

function readJson(workspaceRoot: string, relativePath: string) {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf-8'),
  ) as Record<string, any>;
}

function writeJson(
  workspaceRoot: string,
  relativePath: string,
  value: unknown,
) {
  fs.writeFileSync(
    path.join(workspaceRoot, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function captureStdout<T>(run: () => T): { result: T; output: string } {
  const original = process.stdout.write.bind(process.stdout);
  let output = '';
  (process.stdout as NodeJS.WriteStream).write = ((chunk: unknown) => {
    output += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { result: run(), output };
  } finally {
    process.stdout.write = original;
  }
}

test('migrate preserves an unmarked consumer Modern config while updating generated bridge ownership', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-consumer-config-'),
  );
  const workspaceRoot = path.join(tempRoot, 'consumer-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'consumer-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });

    const modernConfigPath = path.join(
      workspaceRoot,
      'apps/shell-super-app/modern.config.ts',
    );
    const generatedModernConfig = fs.readFileSync(modernConfigPath, 'utf-8');
    const consumerModernConfig = generatedModernConfig
      .replace(
        "import { i18nPlugin } from '@modern-js/plugin-i18n';",
        `import { bffPlugin } from '@modern-js/plugin-bff';
import { i18nPlugin } from '@modern-js/plugin-i18n';`,
      )
      .replace(
        'const cloudflareDeployEnabled =',
        `export const presentationAccessPolicy = {
  studioHost: '127.0.0.1',
  validateManifest: true,
} as const;

const productEffectBffPlugin = bffPlugin();

const cloudflareDeployEnabled =`,
      )
      .replace(
        '      builderPlugins:',
        `      bff: {
        effect: {
          entry: './api/product-effect',
          strictEffectApproach: true,
        },
        prefix: '/api/product',
        runtimeFramework: 'effect',
      },
      builderPlugins:`,
      )
      .replace(
        '        appTools(),',
        `        appTools(),
        productEffectBffPlugin,`,
      );
    fs.writeFileSync(modernConfigPath, consumerModernConfig, 'utf-8');

    const shellPackagePath = 'apps/shell-super-app/package.json';
    const shellPackage = readJson(workspaceRoot, shellPackagePath);
    shellPackage.dependencies['react-router'] = '8.0.0';
    const consumerDevScript = `pnpm presentation:studio && ${shellPackage.scripts.dev}`;
    const generatedBuildSegments = shellPackage.scripts.build.split(' && ');
    const consumerBuildScript = [
      generatedBuildSegments[0],
      'pnpm product:manifest',
      ...generatedBuildSegments.slice(1),
    ].join(' && ');
    const consumerServeScript =
      'node ./scripts/serve-product-preview.mjs --strict-policy';
    shellPackage.scripts.dev = consumerDevScript;
    shellPackage.scripts.build = consumerBuildScript;
    shellPackage.scripts.serve = consumerServeScript;
    shellPackage.scripts['presentation:studio'] =
      'node ./scripts/presentation-studio.mjs';
    shellPackage.scripts['product:manifest'] =
      'node ./scripts/validate-product-manifest.mjs';
    writeJson(workspaceRoot, shellPackagePath, shellPackage);

    const rootPackage = readJson(workspaceRoot, 'package.json');
    const consumerRootBuildScript = `${rootPackage.scripts.build} && pnpm product:artifacts`;
    rootPackage.scripts.build = consumerRootBuildScript;
    rootPackage.scripts['product:artifacts'] =
      'node ./scripts/validate-product-artifacts.mjs';
    writeJson(workspaceRoot, 'package.json', rootPackage);

    const baseTsConfig = readJson(workspaceRoot, 'tsconfig.base.json');
    const effectPlugin = baseTsConfig.compilerOptions.plugins.find(
      (plugin: Record<string, unknown>) =>
        plugin.name === '@effect/language-service',
    );
    effectPlugin.diagnosticSeverity['effect/floatingEffect'] = 'warning';
    baseTsConfig.compilerOptions.types = ['./types/product-globals'];
    baseTsConfig.compilerOptions.plugins.push({
      name: 'product-typescript-plugin',
      productManifest: './product-manifest.json',
    });
    baseTsConfig.references = [{ path: './packages/product-contracts' }];
    writeJson(workspaceRoot, 'tsconfig.base.json', baseTsConfig);

    const shellTsConfigPath = 'apps/shell-super-app/tsconfig.json';
    const shellTsConfig = readJson(workspaceRoot, shellTsConfigPath);
    shellTsConfig.include.push('presentation/**/*.ts');
    shellTsConfig.references = [
      ...(shellTsConfig.references ?? []),
      { path: '../../packages/product-contracts' },
    ];
    shellTsConfig.compilerOptions.paths = {
      '@product/*': ['./src/product/*'],
    };
    shellTsConfig.productValidation = { manifest: './product-manifest.json' };
    writeJson(workspaceRoot, shellTsConfigPath, shellTsConfig);

    const dryRunProtectedPaths = [
      modernConfigPath,
      path.join(workspaceRoot, 'package.json'),
      path.join(workspaceRoot, shellPackagePath),
      path.join(workspaceRoot, 'tsconfig.base.json'),
      path.join(workspaceRoot, shellTsConfigPath),
    ];
    const beforeDryRun = new Map(
      dryRunProtectedPaths.map(filePath => [
        filePath,
        fs.readFileSync(filePath),
      ]),
    );
    const dryRun = captureStdout(() =>
      runUltramodernToolingCli(
        ['migrate-strict-effect', '--dry-run'],
        workspaceRoot,
      ),
    );
    assert.equal(await dryRun.result, 0);
    assert.match(dryRun.output, /preserved consumer-owned TypeScript/u);
    assert.match(dryRun.output, /mixed consumer\/framework ownership/u);
    assert.match(dryRun.output, /Modern config is consumer-owned/u);
    for (const filePath of dryRunProtectedPaths) {
      assert.deepEqual(fs.readFileSync(filePath), beforeDryRun.get(filePath));
    }

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );

    assert.equal(
      fs.readFileSync(modernConfigPath, 'utf-8'),
      consumerModernConfig,
    );
    const migratedShellPackage = readJson(workspaceRoot, shellPackagePath);
    assert.equal(migratedShellPackage.dependencies['react-router'], undefined);
    assert.equal(migratedShellPackage.scripts.dev, consumerDevScript);
    assert.equal(migratedShellPackage.scripts.build, consumerBuildScript);
    assert.equal(migratedShellPackage.scripts.serve, consumerServeScript);
    assert.equal(
      migratedShellPackage.scripts['presentation:studio'],
      shellPackage.scripts['presentation:studio'],
    );
    assert.equal(
      migratedShellPackage.scripts['product:manifest'],
      shellPackage.scripts['product:manifest'],
    );
    const migratedRootPackage = readJson(workspaceRoot, 'package.json');
    assert.equal(migratedRootPackage.scripts.build, consumerRootBuildScript);
    assert.equal(
      migratedRootPackage.scripts['product:artifacts'],
      rootPackage.scripts['product:artifacts'],
    );
    const migratedBaseTsConfig = readJson(workspaceRoot, 'tsconfig.base.json');
    assert.deepEqual(migratedBaseTsConfig.references, baseTsConfig.references);
    assert.deepEqual(
      migratedBaseTsConfig.compilerOptions.types,
      baseTsConfig.compilerOptions.types,
    );
    assert.deepEqual(
      migratedBaseTsConfig.compilerOptions.plugins.find(
        (plugin: Record<string, unknown>) =>
          plugin.name === '@effect/language-service',
      ).diagnosticSeverity,
      effectPlugin.diagnosticSeverity,
    );
    assert.deepEqual(
      migratedBaseTsConfig.compilerOptions.plugins.find(
        (plugin: Record<string, unknown>) =>
          plugin.name === 'product-typescript-plugin',
      ),
      baseTsConfig.compilerOptions.plugins[1],
    );
    const migratedShellTsConfig = readJson(workspaceRoot, shellTsConfigPath);
    assert.ok(migratedShellTsConfig.include.includes('presentation/**/*.ts'));
    assert.ok(
      migratedShellTsConfig.references.some(
        (reference: Record<string, unknown>) =>
          reference.path === '../../packages/product-contracts',
      ),
    );
    assert.deepEqual(
      migratedShellTsConfig.compilerOptions.paths,
      shellTsConfig.compilerOptions.paths,
    );
    assert.deepEqual(
      migratedShellTsConfig.productValidation,
      shellTsConfig.productValidation,
    );
    assert.match(
      fs.readFileSync(
        path.join(
          workspaceRoot,
          'apps/shell-super-app/module-federation.config.ts',
        ),
        'utf-8',
      ),
      /enableBridgeRouter:\s*false/u,
    );

    const idempotencePaths = [
      ...dryRunProtectedPaths,
      path.join(
        workspaceRoot,
        'apps/shell-super-app/module-federation.config.ts',
      ),
    ];
    const afterFirstMigration = new Map(
      idempotencePaths.map(filePath => [filePath, fs.readFileSync(filePath)]),
    );
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );
    for (const filePath of idempotencePaths) {
      assert.deepEqual(
        fs.readFileSync(filePath),
        afterFirstMigration.get(filePath),
        `${path.relative(workspaceRoot, filePath)} was not byte-idempotent`,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate refuses an ambiguous consumer Module Federation config before writes', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-consumer-conflict-'),
  );
  const workspaceRoot = path.join(tempRoot, 'consumer-conflict-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'consumer-conflict-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    const shellPackagePath = 'apps/shell-super-app/package.json';
    const shellPackage = readJson(workspaceRoot, shellPackagePath);
    shellPackage.dependencies['react-router'] = '8.0.0';
    writeJson(workspaceRoot, shellPackagePath, shellPackage);

    const moduleFederationPath =
      'apps/shell-super-app/module-federation.config.ts';
    fs.writeFileSync(
      path.join(workspaceRoot, moduleFederationPath),
      `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

const productFederationPolicy = { name: 'consumer-shell' };

export default createModuleFederationConfig({
  ...productFederationPolicy,
});
`,
    );

    const protectedPaths = [
      '.modernjs/ultramodern.json',
      'package.json',
      shellPackagePath,
      'apps/shell-super-app/modern.config.ts',
      moduleFederationPath,
      'apps/shell-super-app/tsconfig.json',
      'tsconfig.base.json',
    ];
    const before = new Map(
      protectedPaths.map(relativePath => [
        relativePath,
        fs.readFileSync(path.join(workspaceRoot, relativePath)),
      ]),
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      1,
    );
    for (const relativePath of protectedPaths) {
      assert.deepEqual(
        fs.readFileSync(path.join(workspaceRoot, relativePath)),
        before.get(relativePath),
        `${relativePath} changed despite a preflight conflict`,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
