import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runUltramodernToolingCli } from '../src/ultramodern-tooling/commands';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

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

function snapshotWorkspace(directory: string, root = directory) {
  const snapshot = new Map<string, Buffer>();
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .toSorted((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = path.relative(root, entryPath);
    if (entry.isDirectory()) {
      for (const [nestedPath, content] of snapshotWorkspace(entryPath, root)) {
        snapshot.set(nestedPath, content);
      }
    } else if (entry.isSymbolicLink()) {
      snapshot.set(
        relativePath,
        Buffer.from(`symlink:${fs.readlinkSync(entryPath)}`),
      );
    } else {
      snapshot.set(relativePath, fs.readFileSync(entryPath));
    }
  }
  return snapshot;
}

function removeTsCheckerBuildOverride(source: string) {
  return source.replace(
    `        tsChecker: {
          typescript: {
            build: false,
          },
        },
`,
    '',
  );
}

function addLegacyGeneratedDefaults(source: string) {
  const serverAnchor = "        publicDir: ['./locales', './assets'],\n";
  const withLegacySsr = source.replace(
    serverAnchor,
    `${serverAnchor}        ssr: {
          mode: 'stream',
          moduleFederationAppSSR: true,
        },
`,
  );
  assert.notEqual(withLegacySsr, source);

  const composeEndIndex = withLegacySsr.lastIndexOf('\n  )');
  assert.notEqual(composeEndIndex, -1);
  const optionsEndIndex =
    withLegacySsr.lastIndexOf('\n    }', composeEndIndex) + 1;
  assert.notEqual(optionsEndIndex, 0);
  return `${withLegacySsr.slice(0, optionsEndIndex)}      enableBffRequestId: true,
      enableModuleFederationSSR: true,
      enableTelemetryExporters: true,
      telemetryFailLoudStartup: false,
${withLegacySsr.slice(optionsEndIndex)}`;
}

test('migrate converges the published .15 generated Tailwind config to native defaults', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-generated-config-'),
  );
  const workspaceRoot = path.join(tempRoot, 'generated-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'generated-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    const modernConfigPath = path.join(
      workspaceRoot,
      'apps/shell-super-app/modern.config.ts',
    );
    const currentGeneratedConfig = fs.readFileSync(modernConfigPath, 'utf-8');
    assert.match(
      currentGeneratedConfig,
      /tsChecker:\s*\{\s*typescript:\s*\{\s*build: false,/u,
    );
    const predecessorGeneratedConfig = removeTsCheckerBuildOverride(
      currentGeneratedConfig.replace(
        'pluginTailwindcss()',
        'pluginTailwindcss({ optimize: false })',
      ),
    );
    assert.notEqual(predecessorGeneratedConfig, currentGeneratedConfig);
    assert.doesNotMatch(predecessorGeneratedConfig, /tsChecker/u);
    fs.writeFileSync(
      modernConfigPath,
      addLegacyGeneratedDefaults(predecessorGeneratedConfig),
      'utf-8',
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );
    assert.equal(
      fs.readFileSync(modernConfigPath, 'utf-8'),
      currentGeneratedConfig,
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );
    assert.equal(
      fs.readFileSync(modernConfigPath, 'utf-8'),
      currentGeneratedConfig,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

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
    const predecessorGeneratedConfig = removeTsCheckerBuildOverride(
      generatedModernConfig.replace(
        'pluginTailwindcss()',
        'pluginTailwindcss({ optimize: false })',
      ),
    );
    assert.notEqual(predecessorGeneratedConfig, generatedModernConfig);
    assert.doesNotMatch(predecessorGeneratedConfig, /tsChecker/u);
    const consumerModernConfig = predecessorGeneratedConfig
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

test('migrate refuses a marked ambiguous Module Federation config before writes', async () => {
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
      `// ultramodern-mf: generated
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

const productFederationPolicy = { name: 'consumer-shell' };

export default createModuleFederationConfig({
  ...productFederationPolicy,
});
`,
    );

    const before = snapshotWorkspace(workspaceRoot);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      1,
    );
    assert.deepEqual(
      snapshotWorkspace(workspaceRoot),
      before,
      'workspace changed despite a marked ambiguous preflight conflict',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate preserves a generator-derived Module Federation config with consumer extensions', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-extended-mf-config-'),
  );
  const workspaceRoot = path.join(tempRoot, 'extended-mf-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'extended-mf-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    const configPath = path.join(
      workspaceRoot,
      'apps/shell-super-app/module-federation.config.ts',
    );
    const generatedSource = fs.readFileSync(configPath, 'utf-8');
    const extendedSource = generatedSource.replace(
      'export default moduleFederationConfig;',
      `export const consumerFederationDiagnostics = {
  owner: 'product-platform',
  validateRemoteManifest: true,
} as const;

export default moduleFederationConfig;`,
    );
    assert.notEqual(extendedSource, generatedSource);
    fs.writeFileSync(configPath, extendedSource);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );
    assert.equal(fs.readFileSync(configPath, 'utf-8'), extendedSource);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate preserves unproven browser and backend federation configs on surface retirement', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-retired-mf-surface-'),
  );
  const workspaceRoot = path.join(tempRoot, 'retired-mf-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'retired-mf-workspace',
      modernVersion: '3.2.1',
      enableTailwind: false,
      packageSource: { strategy: 'workspace' },
    });
    addUltramodernVertical({
      workspaceRoot,
      name: 'headless-orders',
      modernVersion: '3.2.1',
      enableTailwind: false,
      packageSource: { strategy: 'workspace' },
      preset: 'api-only',
    });
    addUltramodernVertical({
      workspaceRoot,
      name: 'storefront',
      modernVersion: '3.2.1',
      enableTailwind: false,
      packageSource: { strategy: 'workspace' },
      preset: 'ui-only',
    });
    addUltramodernVertical({
      workspaceRoot,
      name: 'generated-headless-orders',
      modernVersion: '3.2.1',
      enableTailwind: false,
      packageSource: { strategy: 'workspace' },
      preset: 'full-stack',
    });

    const compactPath = '.modernjs/ultramodern.json';
    const compact = readJson(workspaceRoot, compactPath);
    const generatedHeadlessApp = compact.topology.apps.find(
      (app: Record<string, any>) => app.id === 'generated-headless-orders',
    );
    assert.ok(generatedHeadlessApp);
    generatedHeadlessApp.surfaceProfile = 'api-only';
    writeJson(workspaceRoot, compactPath, compact);

    const browserConfigPath = path.join(
      workspaceRoot,
      'verticals/headless-orders/module-federation.config.ts',
    );
    const generatedBrowserConfigPath = path.join(
      workspaceRoot,
      'verticals/generated-headless-orders/module-federation.config.ts',
    );
    const generatedBrowserConfig = fs.readFileSync(
      generatedBrowserConfigPath,
      'utf-8',
    );
    const backendConfigPath = path.join(
      workspaceRoot,
      'verticals/storefront/backend-federation.config.ts',
    );
    const consumerBrowserConfig = `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

export default createModuleFederationConfig({
  name: 'consumer-owned-headless-browser-surface',
  filename: 'consumer-remoteEntry.js',
});
`;
    const consumerBackendConfig = `export default {
  name: 'consumer-owned-storefront-backend-surface',
};
`;
    fs.writeFileSync(browserConfigPath, consumerBrowserConfig);
    fs.writeFileSync(backendConfigPath, consumerBackendConfig);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--dry-run', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );
    assert.equal(
      fs.readFileSync(browserConfigPath, 'utf-8'),
      consumerBrowserConfig,
    );
    assert.equal(
      fs.readFileSync(generatedBrowserConfigPath, 'utf-8'),
      generatedBrowserConfig,
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );
    assert.equal(
      fs.readFileSync(browserConfigPath, 'utf-8'),
      consumerBrowserConfig,
    );
    assert.equal(fs.existsSync(generatedBrowserConfigPath), false);
    assert.equal(
      fs.readFileSync(backendConfigPath, 'utf-8'),
      consumerBackendConfig,
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );
    assert.equal(
      fs.readFileSync(browserConfigPath, 'utf-8'),
      consumerBrowserConfig,
    );
    assert.equal(fs.existsSync(generatedBrowserConfigPath), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate rolls back earlier writes when a deterministic late write fails', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-late-rollback-'),
  );
  const workspaceRoot = path.join(tempRoot, 'rollback-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'rollback-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    const compactPath = '.modernjs/ultramodern.json';
    const compact = readJson(workspaceRoot, compactPath);
    compact.generator.version = '0.0.0-rollback-proof';
    writeJson(workspaceRoot, compactPath, compact);

    const outsideOxlintPath = path.join(tempRoot, 'outside-oxlint.config.ts');
    fs.writeFileSync(
      outsideOxlintPath,
      `export default {
  extends: [core, react],
};
`,
    );
    const oxlintPath = path.join(workspaceRoot, 'oxlint.config.ts');
    fs.rmSync(oxlintPath);
    fs.symlinkSync(outsideOxlintPath, oxlintPath);

    const before = snapshotWorkspace(workspaceRoot);
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      1,
    );
    assert.deepEqual(snapshotWorkspace(workspaceRoot), before);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate preserves consumer Drizzle versions without materializing an unrelated patch', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-consumer-drizzle-'),
  );
  const workspaceRoot = path.join(tempRoot, 'consumer-drizzle-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'consumer-drizzle-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    addUltramodernVertical({
      workspaceRoot,
      name: 'orders',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    const ordersPackagePath = 'verticals/orders/package.json';
    const ordersPackage = readJson(workspaceRoot, ordersPackagePath);
    ordersPackage.dependencies['drizzle-orm'] = '0.45.2';
    ordersPackage.devDependencies['drizzle-kit'] = '0.31.10';
    writeJson(workspaceRoot, ordersPackagePath, ordersPackage);

    const workspacePolicyPath = path.join(workspaceRoot, 'pnpm-workspace.yaml');
    const beforePolicy = fs.readFileSync(workspacePolicyPath);
    const drizzlePatchPath = path.join(
      workspaceRoot,
      'patches/drizzle-orm-ts7-strict-declarations.patch',
    );
    fs.rmSync(drizzlePatchPath, { force: true });
    assert.equal(fs.existsSync(drizzlePatchPath), false);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );

    const migratedOrdersPackage = readJson(workspaceRoot, ordersPackagePath);
    assert.equal(migratedOrdersPackage.dependencies['drizzle-orm'], '0.45.2');
    assert.equal(
      migratedOrdersPackage.devDependencies['drizzle-kit'],
      '0.31.10',
    );
    assert.deepEqual(fs.readFileSync(workspacePolicyPath), beforePolicy);
    assert.equal(fs.existsSync(drizzlePatchPath), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
