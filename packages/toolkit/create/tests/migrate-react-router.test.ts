import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { runMigrateStrictEffect } from '../src/ultramodern-tooling/commands/migrate-strict-effect';
import {
  createMigrationIo,
  listWorkspacePackageFiles,
} from '../src/ultramodern-tooling/commands/migrate-strict-effect/io';
import {
  appDeclaresReactRouter,
  ensureGeneratedModuleFederationBridgeRouterOptOut,
  insertBridgeRouterOptOut,
  removeRetiredReactRouterDependency,
} from '../src/ultramodern-tooling/commands/migrate-strict-effect/react-router-retirement';
import { addUltramodernVertical } from '../src/ultramodern-workspace';
import { createWorkspace, snapshotWorkspace } from './helpers/workspace-kit';

// The pin a workspace generated before the bridge router opt-out carries.
const legacyReactRouterSpecifier = '7.9.6';

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

async function captureStdout<T>(run: () => T | Promise<T>) {
  const originalWrite = process.stdout.write;
  let output = '';
  (process.stdout as NodeJS.WriteStream).write = ((chunk: unknown) => {
    output += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = await run();
    return { output, result };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function appPackageFilesOf(workspaceDir: string) {
  return listWorkspacePackageFiles(workspaceDir).filter(
    relativePath =>
      relativePath.startsWith('apps/') || relativePath.startsWith('verticals/'),
  );
}

function moduleFederationConfigFilesOf(
  workspaceDir: string,
  appPackageFiles: string[],
) {
  return appPackageFiles
    .map(
      relativePath =>
        `${path.dirname(relativePath)}/module-federation.config.ts`,
    )
    .filter(relativePath =>
      fs.existsSync(path.join(workspaceDir, relativePath)),
    );
}

function createConfigWorkspace(
  configSource: string,
  packageJson?: Record<string, unknown>,
) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migration-bridge-'),
  );
  const appDirectory = 'apps/shell';
  const relativeConfigPath = `${appDirectory}/module-federation.config.ts`;
  fs.mkdirSync(path.join(tempRoot, appDirectory), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, relativeConfigPath), configSource);
  if (packageJson) {
    writeJson(tempRoot, `${appDirectory}/package.json`, packageJson);
  }
  return {
    apps: [{ directory: appDirectory }],
    read: () =>
      fs.readFileSync(path.join(tempRoot, relativeConfigPath), 'utf-8'),
    tempRoot,
  };
}

test('migrate retires the obsolete react-router pin and derives the MF bridge router from the surviving dependency', async () => {
  const { tempRoot, workspaceDir } = createWorkspace('migration-react-router', {
    tempPrefix: 'um-migration-react-router-',
  });

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const appPackageFiles = appPackageFilesOf(workspaceDir);
    assert.ok(
      appPackageFiles.length >= 2,
      'the fixture workspace must generate more than one app',
    );

    // Simulate a workspace generated while `react-router` was still pinned.
    for (const relativePath of appPackageFiles) {
      const packageJson = readJson(workspaceDir, relativePath);
      packageJson.dependencies['react-router'] = legacyReactRouterSpecifier;
      writeJson(workspaceDir, relativePath, packageJson);
    }

    // One app genuinely brings React Router: it must keep the dependency.
    const consumerPackageFile = appPackageFiles.at(-1) as string;
    const consumerDirectory = path.dirname(consumerPackageFile);
    fs.writeFileSync(
      path.join(workspaceDir, consumerDirectory, 'src/legacy-router.tsx'),
      "import { Link } from 'react-router-dom';\n\nexport const LegacyLink = Link;\n",
    );

    const migrate = () =>
      runMigrateStrictEffect(['--skip-install'], {
        invocationCwd: workspaceDir,
        workspaceRoot: workspaceDir,
      });

    assert.equal(await migrate(), 0);

    for (const relativePath of appPackageFiles) {
      const { dependencies } = readJson(workspaceDir, relativePath);
      assert.equal(
        Object.hasOwn(dependencies, 'react-router'),
        relativePath === consumerPackageFile,
        `${relativePath} react-router retention`,
      );
      // The TanStack router is the frontend router and must never be
      // collateral damage of the specifier-anchored react-router check.
      assert.equal(Object.hasOwn(dependencies, '@tanstack/react-router'), true);
      // bridge-react is what the opt-out aliases; it must stay declared.
      assert.equal(
        Object.hasOwn(dependencies, '@module-federation/bridge-react'),
        true,
      );
      assert.equal(Object.hasOwn(dependencies, 'react-router-dom'), false);
    }

    const configFiles = moduleFederationConfigFilesOf(
      workspaceDir,
      appPackageFiles,
    );
    assert.ok(
      configFiles.length > 1,
      'the fixture workspace must generate more than one Module Federation config',
    );
    const consumerConfigFile = `${consumerDirectory}/module-federation.config.ts`;
    assert.ok(
      configFiles.includes(consumerConfigFile),
      'the React Router consumer must emit a Module Federation config',
    );
    for (const relativePath of configFiles) {
      // The app that kept react-router is the only one allowed — and required
      // — to re-enable the MF bridge router.
      const expectsBridgeRouter = relativePath === consumerConfigFile;
      assert.match(
        fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
        expectsBridgeRouter
          ? /bridge: \{\n\s+enableBridgeRouter: true,\n\s+\},/u
          : /bridge: \{\n\s+enableBridgeRouter: false,\n\s+\},/u,
        `${relativePath} bridge router declaration`,
      );
    }

    // The generated validator gate must accept exactly what migrate produced,
    // opt-in app included.
    const typescriptPackage = createRequire(import.meta.url).resolve(
      'typescript/package.json',
    );
    const validation = spawnSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mts'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          NODE_PATH: path.dirname(path.dirname(typescriptPackage)),
        },
      },
    );
    assert.equal(
      validation.status,
      0,
      `${validation.stdout}\n${validation.stderr}`,
    );

    const afterFirstMigration = snapshotWorkspace(workspaceDir);
    assert.equal(await migrate(), 0);
    assert.deepEqual(
      snapshotWorkspace(workspaceDir),
      afterFirstMigration,
      'a second migration must be a no-op',
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('migration dry-run projects React Router retirement before regenerating Module Federation configs', async () => {
  const { tempRoot, workspaceDir } = createWorkspace(
    'migration-react-router-dry-run',
    { tempPrefix: 'um-migration-react-router-' },
  );

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    const context = {
      invocationCwd: workspaceDir,
      workspaceRoot: workspaceDir,
    };
    assert.equal(await runMigrateStrictEffect(['--skip-install'], context), 0);

    const appPackageFiles = appPackageFilesOf(workspaceDir);
    for (const relativePath of appPackageFiles) {
      const packageJson = readJson(workspaceDir, relativePath);
      packageJson.dependencies['react-router'] = legacyReactRouterSpecifier;
      writeJson(workspaceDir, relativePath, packageJson);
    }
    const before = snapshotWorkspace(workspaceDir);

    const { output, result } = await captureStdout(() =>
      runMigrateStrictEffect(['--dry-run'], context),
    );
    assert.equal(result, 0);
    assert.deepEqual(
      snapshotWorkspace(workspaceDir),
      before,
      'dry-run must leave the source workspace byte-identical',
    );
    for (const relativePath of moduleFederationConfigFilesOf(
      workspaceDir,
      appPackageFiles,
    )) {
      assert.equal(
        output.includes(`[dry-run] would write ${relativePath}`),
        false,
        `${relativePath} must be derived from the projected manifests`,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('the react-router pin only survives authored React Router imports', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migration-react-router-usage-'),
  );

  try {
    const packageDirectory = path.join(tempRoot, 'apps/vertical');
    fs.mkdirSync(path.join(packageDirectory, 'src/routes'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(packageDirectory, 'node_modules/react-router'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(packageDirectory, 'src/routes/page.tsx'),
      "import { Link } from '@tanstack/react-router';\n\nexport const Page = Link;\n",
    );
    // Installed packages and build output are not authored source.
    fs.writeFileSync(
      path.join(packageDirectory, 'node_modules/react-router/index.js'),
      "export * from 'react-router-dom';\n",
    );

    const withTanstackOnly = {
      dependencies: {
        '@tanstack/react-router': '1.0.0',
        'react-router': '7.9.6',
      },
    };
    assert.equal(
      removeRetiredReactRouterDependency(withTanstackOnly, packageDirectory),
      'removed',
    );
    assert.deepEqual(withTanstackOnly.dependencies, {
      '@tanstack/react-router': '1.0.0',
    });

    // Idempotent: the second pass has nothing left to retire.
    assert.equal(
      removeRetiredReactRouterDependency(withTanstackOnly, packageDirectory),
      'absent',
    );

    // A stale pin moved into devDependencies is the same obsolete pin.
    const withDevPin = {
      dependencies: { '@tanstack/react-router': '1.0.0' },
      devDependencies: { 'react-router': '7.9.6', typescript: '5.9.3' },
    };
    assert.equal(
      removeRetiredReactRouterDependency(withDevPin, packageDirectory),
      'removed',
    );
    assert.deepEqual(withDevPin.devDependencies, { typescript: '5.9.3' });

    // A nested authored import under a scanned root makes the app an explicit
    // React Router consumer.
    fs.mkdirSync(path.join(packageDirectory, 'server'), { recursive: true });
    fs.writeFileSync(
      path.join(packageDirectory, 'server/render.ts'),
      "import { StaticRouter } from 'react-router-dom/server';\n\nexport default StaticRouter;\n",
    );
    const explicitConsumer = { dependencies: { 'react-router': '7.9.6' } };
    assert.equal(
      removeRetiredReactRouterDependency(explicitConsumer, packageDirectory),
      'preserved',
    );
    assert.deepEqual(explicitConsumer.dependencies, {
      'react-router': '7.9.6',
    });
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('the bridge router opt-out pass fails closed on unrecognizable MF configs', () => {
  const nonLiteral = `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { baseConfig } from './base';

export default createModuleFederationConfig(baseConfig);
`;
  const spread = `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { baseConfig } from './base';

export default createModuleFederationConfig({
  ...baseConfig,
  name: 'shell',
});
`;
  const noConfigCall = `export default {
  name: 'shell',
};
`;

  for (const configSource of [nonLiteral, spread, noConfigCall]) {
    const { apps, read, tempRoot } = createConfigWorkspace(configSource);
    try {
      const io = createMigrationIo(tempRoot, false);
      assert.equal(
        ensureGeneratedModuleFederationBridgeRouterOptOut(io, apps),
        false,
      );
      assert.equal(read(), configSource);
    } finally {
      fs.rmSync(tempRoot, { force: true, recursive: true });
    }
  }
});

test('the bridge router opt-out pass rewrites recognizable MF configs exactly once', () => {
  const configSource = `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

const moduleFederationConfig: Parameters<
  typeof createModuleFederationConfig
>[0] = createModuleFederationConfig({
  filename: 'remoteEntry.js',
  name: 'shell',
});

export default moduleFederationConfig;
`;
  const { apps, read, tempRoot } = createConfigWorkspace(configSource);

  try {
    const io = createMigrationIo(tempRoot, false);
    assert.equal(
      ensureGeneratedModuleFederationBridgeRouterOptOut(io, apps),
      true,
    );
    const rewritten = read();
    assert.equal(
      rewritten,
      `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

const moduleFederationConfig: Parameters<
  typeof createModuleFederationConfig
>[0] = createModuleFederationConfig({
  bridge: {
    enableBridgeRouter: false,
  },
  filename: 'remoteEntry.js',
  name: 'shell',
});

export default moduleFederationConfig;
`,
    );

    assert.equal(
      ensureGeneratedModuleFederationBridgeRouterOptOut(io, apps),
      false,
    );
    assert.equal(read(), rewritten);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('the bridge router flag follows the app package.json declaration', () => {
  const configSource = `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

export default createModuleFederationConfig({
  name: 'shell',
});
`;
  const declarations = [
    { dependencies: { 'react-router': '7.9.6' } },
    { devDependencies: { 'react-router-dom': '7.9.6' } },
  ];

  for (const packageJson of declarations) {
    assert.equal(appDeclaresReactRouter(packageJson), true);
    const { apps, read, tempRoot } = createConfigWorkspace(
      configSource,
      packageJson,
    );
    try {
      const io = createMigrationIo(tempRoot, false);
      assert.equal(
        ensureGeneratedModuleFederationBridgeRouterOptOut(io, apps),
        true,
      );
      assert.match(read(), /bridge: \{\n\s+enableBridgeRouter: true,\n\s+\},/u);
    } finally {
      fs.rmSync(tempRoot, { force: true, recursive: true });
    }
  }

  const withoutDeclaration = {
    dependencies: { '@tanstack/react-router': '1.0.0' },
  };
  assert.equal(appDeclaresReactRouter(withoutDeclaration), false);
  const { apps, read, tempRoot } = createConfigWorkspace(
    configSource,
    withoutDeclaration,
  );
  try {
    const io = createMigrationIo(tempRoot, false);
    // A missing package.json is not a declaration either.
    assert.equal(
      appDeclaresReactRouter(path.join(tempRoot, 'apps/absent')),
      false,
    );
    assert.equal(
      ensureGeneratedModuleFederationBridgeRouterOptOut(io, apps),
      true,
    );
    assert.match(read(), /bridge: \{\n\s+enableBridgeRouter: false,\n\s+\},/u);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('an already declared bridge block is left alone, including a non-default one', () => {
  const configured = `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

export default createModuleFederationConfig({
  bridge: {
    enableBridgeRouter: true,
  },
  name: 'shell',
});
`;
  assert.equal(insertBridgeRouterOptOut(configured), configured);

  const empty = `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

export default createModuleFederationConfig({});
`;
  assert.equal(
    insertBridgeRouterOptOut(empty),
    `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

export default createModuleFederationConfig({
  bridge: {
    enableBridgeRouter: false,
  },
});
`,
  );
});
