import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');

// Keeps every spawned CLI hermetic: no test may dial the npm registry for
// the @bleedingdev/modern-js-create framework cohort.
const hermeticEnv = {
  ...process.env,
  MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: '3.2.0-ultramodern.108',
};

const readGeneratedFile = (workspacePath: string, relativePath: string) =>
  fs.readFileSync(path.join(workspacePath, relativePath), 'utf8');

const writeExecutable = (filePath: string, content: string) => {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
};

const generatedConfigRuntimePackages = {
  'app-tools': path.resolve(packageRoot, '../../solutions/app-tools'),
  'plugin-i18n': path.resolve(packageRoot, '../../runtime/plugin-i18n'),
  'plugin-tanstack': path.resolve(packageRoot, '../../runtime/plugin-tanstack'),
};

function linkGeneratedConfigRuntime(
  workspacePath: string,
  appDirectory: string,
) {
  fs.symlinkSync(
    path.resolve(packageRoot, '../../../node_modules/.pnpm/node_modules'),
    path.join(workspacePath, 'node_modules'),
    'dir',
  );
  const modernScope = path.join(
    workspacePath,
    'apps',
    appDirectory,
    'node_modules/@modern-js',
  );
  fs.mkdirSync(modernScope, { recursive: true });
  for (const [name, packagePath] of Object.entries(
    generatedConfigRuntimePackages,
  )) {
    fs.symlinkSync(packagePath, path.join(modernScope, name), 'dir');
  }
}

function loadGeneratedAssetPrefix(
  workspacePath: string,
  appDirectory: string,
  env: Record<string, string | undefined>,
) {
  const configPath = path.join(
    workspacePath,
    'apps',
    appDirectory,
    'modern.config.ts',
  );
  const tsxLoader = fs.realpathSync(
    path.join(packageRoot, 'node_modules/tsx/dist/loader.mjs'),
  );
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      tsxLoader,
      '--input-type=module',
      '--eval',
      `
        import { pathToFileURL } from 'node:url';
        const loaded = await import(pathToFileURL(${JSON.stringify(configPath)}).href);
        const config = loaded.default?.default ?? loaded.default;
        process.stdout.write(JSON.stringify(config.output.assetPrefix));
      `,
    ],
    {
      cwd: path.dirname(configPath),
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as string;
}

const linkCreatePackageIntoConsumer = (consumerDir: string) => {
  const scopeDir = path.join(consumerDir, 'node_modules/@modern-js');
  fs.mkdirSync(scopeDir, { recursive: true });
  fs.symlinkSync(packageRoot, path.join(scopeDir, 'create'), 'dir');
};

test('package exposes the pnpm dlx command alias', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  );

  assert.equal(packageJson.bin['modern-js-create'], './bin/run.js');
});

test('package exposes the public UltraModern workspace generator subpath', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  );
  const expectedPublicExport = {
    types: './dist/types/ultramodern-workspace/public-api.d.ts',
    node: {
      import: './dist/esm-node/ultramodern-workspace/public-api.js',
      require: './dist/cjs/ultramodern-workspace/public-api.cjs',
    },
    default: './dist/esm-node/ultramodern-workspace/public-api.js',
  };
  const expectedCodeSmithExport = {
    types: './dist/types/ultramodern-workspace/codesmith.d.ts',
    node: {
      import: './dist/esm-node/ultramodern-workspace/codesmith.js',
      require: './dist/cjs/ultramodern-workspace/codesmith.cjs',
    },
    default: './dist/esm-node/ultramodern-workspace/codesmith.js',
  };

  assert.deepEqual(packageJson.typesVersions['*']['ultramodern-workspace'], [
    './dist/types/ultramodern-workspace/public-api.d.ts',
  ]);
  assert.deepEqual(
    packageJson.typesVersions['*']['ultramodern-workspace/codesmith'],
    ['./dist/types/ultramodern-workspace/codesmith.d.ts'],
  );
  assert.deepEqual(packageJson.exports['./ultramodern-workspace'], {
    ...expectedPublicExport,
    node: {
      'modern:source': './src/ultramodern-workspace/public-api.ts',
      ...expectedPublicExport.node,
    },
  });
  assert.deepEqual(packageJson.exports['./ultramodern-workspace/codesmith'], {
    ...expectedCodeSmithExport,
    node: {
      'modern:source': './src/ultramodern-workspace/codesmith.ts',
      ...expectedCodeSmithExport.node,
    },
  });
  assert.deepEqual(
    packageJson.publishConfig.exports['./ultramodern-workspace'],
    expectedPublicExport,
  );
  assert.deepEqual(
    packageJson.publishConfig.exports['./ultramodern-workspace/codesmith'],
    expectedCodeSmithExport,
  );
  assert.deepEqual(
    Object.keys(packageJson.exports).sort(),
    Object.keys(packageJson.publishConfig.exports).sort(),
  );
});

test('built public UltraModern subpath imports from an ESM consumer and generates a vertical', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-create-public-api-'),
  );

  try {
    linkCreatePackageIntoConsumer(tempRoot);

    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          import fs from 'node:fs';
          import path from 'node:path';
          import {
            addUltramodernVertical,
            generateUltramodernWorkspace,
            normalizeUltramodernBridgeConfig,
            planUltramodernVertical,
          } from '@modern-js/create/ultramodern-workspace';

          const workspaceRoot = path.join(process.cwd(), 'public-api-workspace');
          const workspaceResult = generateUltramodernWorkspace({
            targetDir: workspaceRoot,
            packageName: 'public-api-workspace',
            modernVersion: '3.2.1',
            enableTailwind: true,
            packageSource: { strategy: 'workspace' },
          });
          const verticalResult = addUltramodernVertical({
            workspaceRoot,
            name: 'catalog',
            modernVersion: '3.2.1',
          });
          const planResult = planUltramodernVertical({
            workspaceRoot,
            name: 'checkout',
            modernVersion: '3.2.1',
          });
          const bridgeConfig = normalizeUltramodernBridgeConfig({
            parentRoot: '..',
            workspacePackages: [{ pattern: '../packages/*' }],
            dependencies: ['@acme/ui'],
            gates: [{ name: 'typecheck', command: 'pnpm nx typecheck @acme/ui' }],
          });

          if (
            workspaceResult.operation !== 'workspace' ||
            !workspaceResult.createdPaths.includes('apps/shell-super-app/package.json')
          ) {
            throw new Error('Expected typed workspace generation result');
          }
          if (
            verticalResult.operation !== 'vertical' ||
            verticalResult.assignedPorts.catalog !== 4101 ||
            verticalResult.apiPrefixes.catalog !== '/catalog-api'
          ) {
            throw new Error('Expected typed MicroVertical generation result');
          }
          if (
            planResult.dryRun !== true ||
            planResult.selectedPort !== 4102 ||
            planResult.moduleFederationRemote.name !== 'verticalCheckout'
          ) {
            throw new Error('Expected typed MicroVertical dry-run plan');
          }
          if (
            bridgeConfig.enabled !== true ||
            bridgeConfig.lockfilePolicy !== 'nested' ||
            bridgeConfig.reactSingletons.join(',') !==
              'react,react-dom,react-dom/client'
          ) {
            throw new Error('Expected typed bridge config normalizer');
          }
          for (const relativePath of [
            '.modernjs/ultramodern.json',
            'apps/shell-super-app/package.json',
            'verticals/catalog/package.json',
            'verticals/catalog/shared/api.ts',
          ]) {
            if (!fs.existsSync(path.join(workspaceRoot, relativePath))) {
              throw new Error(\`Missing generated path: \${relativePath}\`);
            }
          }
        `,
      ],
      {
        cwd: tempRoot,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('built public UltraModern subpath can be required from CommonJS', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-create-public-api-cjs-'),
  );

  try {
    linkCreatePackageIntoConsumer(tempRoot);

    const result = spawnSync(
      process.execPath,
      [
        '--eval',
        `
          const publicApi = require('@modern-js/create/ultramodern-workspace');
          const keys = Object.keys(publicApi).sort();
          const expected = [
            'addUltramodernVertical',
            'generateUltramodernWorkspace',
            'normalizeUltramodernBridgeConfig',
            'planUltramodernVertical',
          ];
          if (JSON.stringify(keys) !== JSON.stringify(expected)) {
            throw new Error(\`Unexpected public API keys: \${keys.join(', ')}\`);
          }
          if (typeof publicApi.generateUltramodernWorkspace !== 'function') {
            throw new Error('Expected generateUltramodernWorkspace function');
          }
          if (typeof publicApi.addUltramodernVertical !== 'function') {
            throw new Error('Expected addUltramodernVertical function');
          }
        `,
      ],
      {
        cwd: tempRoot,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('built CodeSmith UltraModern subpath exposes a default adapter', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-create-codesmith-api-'),
  );

  try {
    linkCreatePackageIntoConsumer(tempRoot);

    const esmResult = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          import adapter from '@modern-js/create/ultramodern-workspace/codesmith';
          if (typeof adapter !== 'function') {
            throw new Error('Expected default CodeSmith adapter function');
          }
        `,
      ],
      {
        cwd: tempRoot,
        encoding: 'utf8',
      },
    );
    assert.equal(esmResult.status, 0, esmResult.stderr);

    const cjsResult = spawnSync(
      process.execPath,
      [
        '--eval',
        `
          const adapterModule = require('@modern-js/create/ultramodern-workspace/codesmith');
          const adapter = adapterModule.default || adapterModule;
          if (typeof adapter !== 'function') {
            throw new Error('Expected default CodeSmith adapter function');
          }
        `,
      ],
      {
        cwd: tempRoot,
        encoding: 'utf8',
      },
    );
    assert.equal(cjsResult.status, 0, cjsResult.stderr);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('built CLI resolves package metadata for --version', () => {
  const result = spawnSync(process.execPath, [builtCliPath, '--version'], {
    cwd: packageRoot,
    encoding: 'utf8',
  });

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  );

  assert.equal(result.status, 0, result.stderr);
  // The version line must identify the package that actually ships this
  // code (package.json name), not a hardcoded publish alias.
  assert.match(
    result.stdout,
    new RegExp(
      `${packageJson.name.replace(/[/\\^$.*+?()[\]{}|]/g, '\\$&')} version: \\d+\\.\\d+\\.\\d+`,
    ),
  );
});

test('built CLI resolves workspace template for default scaffold', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));

  try {
    const result = spawnSync(
      process.execPath,
      [builtCliPath, 'smoke-workspace', '--no-tailwind'],
      {
        cwd: tmpDir,
        encoding: 'utf8',
        env: hermeticEnv,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.existsSync(
        path.join(tmpDir, 'smoke-workspace', '.modernjs/ultramodern.json'),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(tmpDir, 'smoke-workspace', 'apps/shell-super-app'),
      ),
      true,
    );

    const workspacePath = path.join(tmpDir, 'smoke-workspace');
    const appDirectories = fs
      .readdirSync(path.join(workspacePath, 'apps'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);

    assert.notEqual(appDirectories.length, 0);

    for (const appDirectory of appDirectories) {
      linkGeneratedConfigRuntime(workspacePath, appDirectory);
      assert.equal(
        loadGeneratedAssetPrefix(workspacePath, appDirectory, {
          MODERN_ASSET_PREFIX: 'https://modern.example/assets/',
          MODERN_PUBLIC_SITE_URL: 'https://site.example/',
          ULTRAMODERN_ASSET_PREFIX: 'https://ultramodern.example/assets/',
        }),
        'https://modern.example/assets/',
      );
      assert.equal(
        loadGeneratedAssetPrefix(workspacePath, appDirectory, {
          MODERN_ASSET_PREFIX: undefined,
          MODERN_PUBLIC_SITE_URL: 'https://site.example/',
          ULTRAMODERN_ASSET_PREFIX: 'https://ultramodern.example/assets/',
        }),
        'https://ultramodern.example/assets/',
      );
      assert.equal(
        loadGeneratedAssetPrefix(workspacePath, appDirectory, {
          MODERN_ASSET_PREFIX: undefined,
          MODERN_PUBLIC_SITE_URL: 'https://site.example/',
          ULTRAMODERN_ASSET_PREFIX: undefined,
        }),
        '/',
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('built CLI rejects removed workspace flag', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));

  try {
    const result = spawnSync(
      process.execPath,
      [builtCliPath, 'smoke-workspace', '--ultramodern-workspace'],
      {
        cwd: tmpDir,
        encoding: 'utf8',
        env: hermeticEnv,
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Unexpected positional argument: --ultramodern-workspace/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--workspace forces workspace protocol dependencies without registry access', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));
  const fakeBinDir = path.join(tmpDir, 'fake-bin');
  fs.mkdirSync(fakeBinDir);
  // A failing npm proves the registry is never required on this path.
  writeExecutable(path.join(fakeBinDir, 'npm'), '#!/bin/sh\nexit 1\n');

  try {
    const result = spawnSync(
      process.execPath,
      [builtCliPath, 'workspace-flag-smoke', '--workspace'],
      {
        cwd: tmpDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: undefined,
          PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const ultramodernConfig = JSON.parse(
      readGeneratedFile(
        path.join(tmpDir, 'workspace-flag-smoke'),
        '.modernjs/ultramodern.json',
      ),
    );
    assert.equal(ultramodernConfig.packageSource.strategy, 'workspace');
    assert.equal(
      ultramodernConfig.packageSource.modernPackageVersion,
      'workspace:*',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--workspace conflicts with an explicit install package source', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));

  try {
    const result = spawnSync(
      process.execPath,
      [
        builtCliPath,
        'workspace-conflict-smoke',
        '--workspace',
        '--ultramodern-package-source=install',
      ],
      {
        cwd: tmpDir,
        encoding: 'utf8',
        env: hermeticEnv,
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /--workspace conflicts with --ultramodern-package-source=install/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('local source defaults to workspace dependencies without registry lookup', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));
  const fakeBinDir = path.join(tmpDir, 'fake-bin');
  fs.mkdirSync(fakeBinDir);
  writeExecutable(path.join(fakeBinDir, 'npm'), '#!/bin/sh\nexit 1\n');

  try {
    const result = spawnSync(
      process.execPath,
      [builtCliPath, 'offline-fallback-smoke'],
      {
        cwd: tmpDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: undefined,
          PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const ultramodernConfig = JSON.parse(
      readGeneratedFile(
        path.join(tmpDir, 'offline-fallback-smoke'),
        '.modernjs/ultramodern.json',
      ),
    );
    assert.equal(ultramodernConfig.packageSource.strategy, 'workspace');
    assert.equal(
      ultramodernConfig.packageSource.modernPackageVersion,
      'workspace:*',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('local source rejects explicit install before cohort environment validation or registry lookup', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));
  const fakeBinDir = path.join(tmpDir, 'fake-bin');
  const registryLookupMarker = path.join(tmpDir, 'registry-lookup');
  fs.mkdirSync(fakeBinDir);
  writeExecutable(
    path.join(fakeBinDir, 'npm'),
    '#!/bin/sh\n: > "$MODERN_CREATE_REGISTRY_LOOKUP_MARKER"\nexit 1\n',
  );

  try {
    for (const frameworkVersion of ['not-a-semver', undefined]) {
      const result = spawnSync(
        process.execPath,
        [
          builtCliPath,
          'local-install-source-smoke',
          '--ultramodern-package-source=install',
        ],
        {
          cwd: tmpDir,
          encoding: 'utf8',
          env: {
            ...process.env,
            MODERN_CREATE_REGISTRY_LOOKUP_MARKER: registryLookupMarker,
            MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: frameworkVersion,
            PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
          },
        },
      );

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /local @modern-js\/create source checkout cannot satisfy an explicit install/u,
      );
      assert.equal(fs.existsSync(registryLookupMarker), false);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('missing git fails fast without attempting a system package install', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));
  const fakeBinDir = path.join(tmpDir, 'fake-bin');
  const brewMarker = path.join(tmpDir, 'brew-was-invoked');
  fs.mkdirSync(fakeBinDir);
  // PATH contains a fake brew but no git. The old CLI ran package-manager
  // installs (brew/apt-get with sudo) here; the new CLI must fail with an
  // actionable error without ever invoking them.
  writeExecutable(
    path.join(fakeBinDir, 'brew'),
    `#!/bin/sh\ntouch '${brewMarker}'\nexit 0\n`,
  );

  try {
    const result = spawnSync(
      process.execPath,
      [builtCliPath, 'missing-git-smoke'],
      {
        cwd: tmpDir,
        encoding: 'utf8',
        env: {
          ...hermeticEnv,
          PATH: fakeBinDir,
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Git is required for UltraModern setup/);
    assert.equal(
      fs.existsSync(brewMarker),
      false,
      'create must never attempt to install git through a package manager',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
