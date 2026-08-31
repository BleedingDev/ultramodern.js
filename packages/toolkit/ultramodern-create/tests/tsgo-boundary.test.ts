import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { yaml } from '@modern-js/utils';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';
import { TYPESCRIPT_VERSION } from '../src/ultramodern-workspace/versions';

const packageRoot = path.resolve(__dirname, '..');
function readPackageJson(relativePath = 'package.json'): any {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, relativePath), 'utf-8'),
  );
}

function writeExecutable(filePath: string, lines: string[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
  fs.chmodSync(filePath, 0o755);
}

function createPackageScriptWorkspace(
  workspaceRoot: string,
  scripts: Record<string, string>,
) {
  const createPackageDir = path.join(workspaceRoot, 'packages/create');
  const binDir = path.join(createPackageDir, 'node_modules/.bin');
  fs.mkdirSync(createPackageDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({
      private: true,
    }),
  );
  fs.writeFileSync(
    path.join(workspaceRoot, 'pnpm-workspace.yaml'),
    yaml.dump({ packages: ['packages/*'] }),
  );
  fs.writeFileSync(
    path.join(createPackageDir, 'package.json'),
    JSON.stringify({
      name: '@fixture/create',
      private: true,
      scripts,
    }),
  );
  writeExecutable(path.join(binDir, 'rslib'), [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "fs.mkdirSync('dist/esm-node', { recursive: true });",
    "fs.mkdirSync('dist/types', { recursive: true });",
    "fs.writeFileSync('dist/esm-node/index.js', 'export const runtime = true;\\n');",
    "fs.writeFileSync('dist/types/index.d.ts', 'export declare const runtime: true;\\n');",
  ]);
  writeExecutable(path.join(binDir, 'rstest'), [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "if (!fs.existsSync('dist/esm-node/index.js')) throw new Error('runtime artifact missing');",
    "if (!fs.existsSync('dist/types/index.d.ts')) throw new Error('declaration artifact missing');",
    "fs.writeFileSync('dist/test-evidence.json', JSON.stringify({ declarations: true, runtime: true }));",
  ]);

  return createPackageDir;
}

test('create package scripts emit runtime and declarations before testing', () => {
  const packageJson = readPackageJson();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-create-scripts-'));

  try {
    const createPackageDir = createPackageScriptWorkspace(tempRoot, {
      build: packageJson.scripts.build,
      test: packageJson.scripts.test,
    });

    execFileSync('pnpm', ['run', 'build'], {
      cwd: createPackageDir,
      stdio: 'pipe',
    });
    assert.equal(
      fs.existsSync(path.join(createPackageDir, 'dist/esm-node/index.js')),
      true,
      'package build must emit its runtime artifact',
    );
    assert.equal(
      fs.existsSync(path.join(createPackageDir, 'dist/types/index.d.ts')),
      true,
      'the Rslib package build must emit TypeScript 7 declarations',
    );

    execFileSync('pnpm', ['run', 'test'], {
      cwd: createPackageDir,
      stdio: 'pipe',
    });
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(
          path.join(createPackageDir, 'dist/test-evidence.json'),
          'utf-8',
        ),
      ),
      { declarations: true, runtime: true },
      'package tests must execute only after runtime and declaration artifacts exist',
    );
    assert.equal(
      packageJson.dependencies?.typescript,
      undefined,
      'published create runtime must not depend on the stable TypeScript package',
    );
    assert.equal(
      packageJson.dependencies?.['@typescript/native-preview'],
      undefined,
      'published create runtime must not depend on native-preview compiler internals',
    );
    assert.equal(
      typeof packageJson.devDependencies?.typescript,
      'string',
      'create tests may use the stable TypeScript package explicitly',
    );
    assert.equal(
      typeof packageJson.devDependencies?.['@typescript/native-preview'],
      'string',
      'create compatibility tests may depend on native-preview as a dev-only compiler',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated package module scopes keep Module Federation apps CommonJS-compatible', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-ts7-package-'));
  const workspaceDir = path.join(tempRoot, 'ts7-package-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'ts7-package-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: {
        strategy: 'workspace',
      },
    });
    const rootPackageJson = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf-8'),
    );
    const shellPackageJson = JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, 'apps/shell-super-app/package.json'),
        'utf-8',
      ),
    );
    const sharedContractsPackageJson = JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, 'packages/shared-contracts/package.json'),
        'utf-8',
      ),
    );
    const ultramodernConfig = JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, '.modernjs/ultramodern.json'),
        'utf-8',
      ),
    );
    const shellConfig = ultramodernConfig.topology.apps.find(
      (app: { id: string }) => app.id === 'shell-super-app',
    );

    assert.equal(rootPackageJson.type, 'module');
    assert.equal(
      sharedContractsPackageJson.type,
      'module',
      'generated shared packages should stay ESM-native',
    );
    assert.equal(
      shellPackageJson.type,
      undefined,
      'generated MF app packages should not opt into package-level ESM',
    );
    assert.equal(
      shellPackageJson.devDependencies?.['@typescript/native'],
      `npm:typescript@${TYPESCRIPT_VERSION}`,
      "generated apps must install stable TypeScript 7 as tsgo's @typescript/native backend",
    );
    assert.equal(
      shellPackageJson.devDependencies?.typescript,
      TYPESCRIPT_VERSION,
      'generated apps and the Module Federation DTS plugin must use TypeScript 7',
    );
    assert.equal(
      shellPackageJson.devDependencies?.['@typescript/native-preview'],
      undefined,
      'generated apps must not install native-preview when stable TypeScript 7 is available',
    );
    const pnpmWorkspace = yaml.load(
      fs.readFileSync(path.join(workspaceDir, 'pnpm-workspace.yaml'), 'utf-8'),
    ) as Record<string, any>;
    assert.equal(
      pnpmWorkspace.injectWorkspacePackages,
      true,
      'source-linked generated workspaces must inject the complete Modern.js dependency graph so generated patches own declaration resolution',
    );
    assert.equal(
      pnpmWorkspace.linkWorkspacePackages,
      true,
      'source-linked generated workspaces must resolve explicit workspace protocol framework dependencies',
    );
    assert.equal(
      pnpmWorkspace.overrides?.['@module-federation/dts-plugin>typescript'],
      undefined,
      'generated workspaces must not override the Module Federation DTS TypeScript peer',
    );
    const dtsPluginExtensions = Object.entries(
      pnpmWorkspace.packageExtensions ?? {},
    ).filter(
      ([selector]) =>
        selector === '@module-federation/dts-plugin' ||
        selector.startsWith('@module-federation/dts-plugin@'),
    );
    for (const [, extension] of dtsPluginExtensions) {
      assert.equal(
        extension.dependencies?.typescript,
        undefined,
        'generated workspaces must not inject a private TypeScript dependency into the DTS plugin',
      );
      assert.equal(
        extension.peerDependencies?.typescript,
        undefined,
        'generated workspaces must not replace the DTS plugin TypeScript peer',
      );
    }
    assert.equal(
      pnpmWorkspace.overrides?.typescript,
      undefined,
      'workspace policy must not redirect the app-level stable TypeScript 7 compiler dependency',
    );
    assert.equal(
      shellConfig?.moduleFederation?.dts?.compilerInstance,
      'effect-tsgo',
      'compact metadata should keep MF DTS generation on the effect-tsgo lane',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
