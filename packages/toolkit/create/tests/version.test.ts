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
