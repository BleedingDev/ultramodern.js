import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';
import { TYPESCRIPT_VERSION } from '../src/ultramodern-workspace/versions';

const packageRoot = path.resolve(__dirname, '..');
function readPackageJson(relativePath = 'package.json'): any {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, relativePath), 'utf-8'),
  );
}

test('create package build and test keep declarations on tsgo:dts', () => {
  const packageJson = readPackageJson();

  assert.match(
    packageJson.scripts.build,
    /rslib build/u,
    'package build must still emit runtime artifacts before declarations',
  );
  assert.match(
    packageJson.scripts.build,
    /pnpm -w tsgo:dts "\$PWD"/u,
    'package build must emit declarations through the repo tsgo:dts flow',
  );
  assert.match(
    packageJson.scripts.test,
    /rslib build/u,
    'package tests must build runtime artifacts before executing tests',
  );
  assert.match(
    packageJson.scripts.test,
    /pnpm -w tsgo:dts "\$PWD"/u,
    'package tests must emit declarations before validating the public surface',
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
    'create build tooling may depend on native-preview as a dev-only compiler',
  );
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
    const pnpmWorkspace = fs.readFileSync(
      path.join(workspaceDir, 'pnpm-workspace.yaml'),
      'utf-8',
    );
    assert.match(
      pnpmWorkspace,
      /^injectWorkspacePackages: true$/mu,
      'source-linked generated workspaces must inject the complete Modern.js dependency graph so generated patches own declaration resolution',
    );
    assert.match(
      pnpmWorkspace,
      /^linkWorkspacePackages: true$/mu,
      'source-linked generated workspaces must resolve explicit workspace protocol framework dependencies',
    );
    assert.doesNotMatch(
      pnpmWorkspace,
      /@module-federation\/dts-plugin>typescript/u,
      'generated workspaces must not override the Module Federation DTS TypeScript peer',
    );
    assert.doesNotMatch(
      pnpmWorkspace,
      /@module-federation\/dts-plugin@[^\n]+:\s*\n\s+(?:dependencies|peerDependencies):\s*\n\s+typescript:/u,
      'generated workspaces must not inject a private TypeScript dependency into the DTS plugin',
    );
    assert.doesNotMatch(
      pnpmWorkspace,
      /\btypescript@6\.0\.3\b/u,
      'generated workspaces must not retain the obsolete TypeScript 6 DTS shim',
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
