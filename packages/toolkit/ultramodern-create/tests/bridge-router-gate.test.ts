import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';

const moduleFederationConfigPath =
  'apps/shell-super-app/module-federation.config.ts';

function runValidation(workspaceDir: string) {
  const typescriptPackage = createRequire(import.meta.url).resolve(
    'typescript/package.json',
  );
  const compilerPath = path.join(
    workspaceDir,
    'node_modules/@typescript/native',
  );
  if (!fs.existsSync(compilerPath)) {
    fs.mkdirSync(path.dirname(compilerPath), { recursive: true });
    fs.symlinkSync(
      path.dirname(typescriptPackage),
      compilerPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
  return spawnSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mts'],
    {
      cwd: workspaceDir,
      encoding: 'utf-8',
    },
  );
}

function output(result: ReturnType<typeof runValidation>) {
  return `${result.stdout}\n${result.stderr}`;
}

function rewrite(
  workspaceDir: string,
  relativePath: string,
  transform: (source: string) => string,
) {
  const absolutePath = path.join(workspaceDir, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf-8');
  const next = transform(source);
  assert.notEqual(next, source, `${relativePath} must actually change`);
  fs.writeFileSync(absolutePath, next, 'utf-8');
}

function declareReactRouter(workspaceDir: string) {
  const packagePath = path.join(
    workspaceDir,
    'apps/shell-super-app/package.json',
  );
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  packageJson.dependencies['react-router'] = '7.18.2';
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function generateWorkspace(workspaceDir: string) {
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: path.basename(workspaceDir),
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: { strategy: 'workspace' },
  });
}

test('bridge router gate consumes the declaration and dependency boundary', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-bridge-router-'));
  const baselineDir = path.join(tempRoot, 'baseline');

  try {
    generateWorkspace(baselineDir);
    const baseline = runValidation(baselineDir);
    assert.equal(baseline.status, 0, output(baseline));

    const unauthorizedDir = path.join(tempRoot, 'unauthorized');
    fs.cpSync(baselineDir, unauthorizedDir, { recursive: true });
    rewrite(unauthorizedDir, moduleFederationConfigPath, source =>
      source.replace('enableBridgeRouter: false', 'enableBridgeRouter: true'),
    );
    const unauthorized = runValidation(unauthorizedDir);
    assert.notEqual(unauthorized.status, 0, output(unauthorized));
    assert.match(
      output(unauthorized),
      /declares neither react-router nor react-router-dom/u,
    );

    const authorizedDir = path.join(tempRoot, 'authorized');
    fs.cpSync(baselineDir, authorizedDir, { recursive: true });
    rewrite(authorizedDir, moduleFederationConfigPath, source =>
      source.replace('enableBridgeRouter: false', 'enableBridgeRouter: true'),
    );
    declareReactRouter(authorizedDir);
    const authorized = runValidation(authorizedDir);
    assert.equal(authorized.status, 0, output(authorized));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
