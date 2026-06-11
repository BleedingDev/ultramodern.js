import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');

const readGeneratedFile = (workspacePath: string, relativePath: string) =>
  fs.readFileSync(path.join(workspacePath, relativePath), 'utf8');

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

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /@bleedingdev\/modern-js-create version: \d+\.\d+\.\d+/,
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
