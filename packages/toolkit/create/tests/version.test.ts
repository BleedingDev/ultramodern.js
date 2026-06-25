import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');
const packagedVersion: string = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
).version;

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

const linkCreatePackageIntoConsumer = (consumerDir: string) => {
  const scopeDir = path.join(consumerDir, 'node_modules/@modern-js');
  fs.mkdirSync(scopeDir, { recursive: true });
  fs.symlinkSync(packageRoot, path.join(scopeDir, 'create'), 'dir');
};

const assertGeneratedModernConfigAssetPrefixContract = (
  modernConfig: string,
  label: string,
) => {
  const indexOfAny = (source: string, needles: string[]) => {
    const indexes = needles
      .map(needle => source.indexOf(needle))
      .filter(index => index >= 0);

    return indexes.length > 0 ? Math.min(...indexes) : -1;
  };

  const assetPrefixMatch = modernConfig.match(
    /const assetPrefix =\n(?<expression>[\s\S]*?);/,
  );

  assert.ok(
    assetPrefixMatch?.groups?.expression,
    `${label} derives assetPrefix`,
  );

  const assetPrefixExpression = assetPrefixMatch.groups.expression;

  assert.doesNotMatch(
    assetPrefixExpression,
    /configuredSiteUrl|MODERN_PUBLIC_SITE_URL/,
    `${label} assetPrefix must not use MODERN_PUBLIC_SITE_URL`,
  );
  assert.match(
    modernConfig,
    /MODERN_ASSET_PREFIX/,
    `${label} modern.config.ts must read MODERN_ASSET_PREFIX`,
  );
  assert.match(
    modernConfig,
    /ULTRAMODERN_ASSET_PREFIX/,
    `${label} modern.config.ts must read ULTRAMODERN_ASSET_PREFIX`,
  );
  assert.match(
    assetPrefixExpression,
    /configuredModernAssetPrefix|MODERN_ASSET_PREFIX/,
    `${label} assetPrefix must prefer MODERN_ASSET_PREFIX`,
  );
  assert.match(
    assetPrefixExpression,
    /configuredUltramodernAssetPrefix|ULTRAMODERN_ASSET_PREFIX/,
    `${label} assetPrefix must fall back to ULTRAMODERN_ASSET_PREFIX`,
  );
  assert.ok(
    indexOfAny(assetPrefixExpression, [
      'configuredModernAssetPrefix',
      'MODERN_ASSET_PREFIX',
    ]) <
      indexOfAny(assetPrefixExpression, [
        'configuredUltramodernAssetPrefix',
        'ULTRAMODERN_ASSET_PREFIX',
      ]),
    `${label} assetPrefix must prefer MODERN_ASSET_PREFIX before ` +
      'ULTRAMODERN_ASSET_PREFIX',
  );
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

  assert.deepEqual(packageJson.typesVersions['*']['ultramodern-workspace'], [
    './dist/types/ultramodern-workspace/public-api.d.ts',
  ]);
  assert.deepEqual(packageJson.exports['./ultramodern-workspace'], {
    ...expectedPublicExport,
    node: {
      'modern:source': './src/ultramodern-workspace/public-api.ts',
      ...expectedPublicExport.node,
    },
  });
  assert.deepEqual(
    packageJson.publishConfig.exports['./ultramodern-workspace'],
    expectedPublicExport,
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
          } from '@modern-js/create/ultramodern-workspace';

          const workspaceRoot = path.join(process.cwd(), 'public-api-workspace');
          generateUltramodernWorkspace({
            targetDir: workspaceRoot,
            packageName: 'public-api-workspace',
            modernVersion: '3.2.1',
            enableTailwind: true,
            packageSource: {
              strategy: 'install',
              modernPackageVersion: '3.2.0-ultramodern.108',
            },
          });
          addUltramodernVertical({
            workspaceRoot,
            name: 'catalog',
            modernVersion: '3.2.1',
          });

          for (const relativePath of [
            '.modernjs/ultramodern-workspace-template-manifest.json',
            'apps/shell-super-app/package.json',
            'verticals/catalog/package.json',
            'verticals/catalog/shared/effect/api.ts',
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
      [builtCliPath, 'smoke-workspace'],
      {
        cwd: tmpDir,
        encoding: 'utf8',
        env: hermeticEnv,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.existsSync(
        path.join(
          tmpDir,
          'smoke-workspace',
          '.modernjs/ultramodern-workspace-template-manifest.json',
        ),
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
      assertGeneratedModernConfigAssetPrefixContract(
        readGeneratedFile(
          workspacePath,
          `apps/${appDirectory}/modern.config.ts`,
        ),
        appDirectory,
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
    const packageSource = JSON.parse(
      readGeneratedFile(
        path.join(tmpDir, 'workspace-flag-smoke'),
        '.modernjs/ultramodern-package-source.json',
      ),
    );
    assert.equal(packageSource.strategy, 'workspace');
    assert.equal(packageSource.modernPackages.specifier, 'workspace:*');
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

test('registry lookup failure falls back to the packaged framework version', () => {
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
    assert.match(
      result.stderr,
      /Falling back to the packaged framework version/,
    );
    const packageSource = JSON.parse(
      readGeneratedFile(
        path.join(tmpDir, 'offline-fallback-smoke'),
        '.modernjs/ultramodern-package-source.json',
      ),
    );
    assert.equal(packageSource.strategy, 'install');
    assert.equal(packageSource.modernPackages.specifier, packagedVersion);
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
