import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createWorkspace,
  linkInstalledCompiler,
  runValidation,
} from './helpers/workspace-kit';

const moduleFederationConfigPath =
  'apps/shell-super-app/module-federation.config.ts';

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

test('bridge router gate consumes the declaration and dependency boundary', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-bridge-router-'));
  const baselineDir = path.join(tempRoot, 'baseline');

  try {
    createWorkspace(baselineDir);
    linkInstalledCompiler(baselineDir);
    const baseline = runValidation(baselineDir);
    assert.equal(baseline.status, 0, output(baseline));

    const unauthorizedDir = path.join(tempRoot, 'unauthorized');
    fs.cpSync(baselineDir, unauthorizedDir, {
      recursive: true,
      filter: source => path.basename(source) !== 'node_modules',
    });
    linkInstalledCompiler(unauthorizedDir);
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
    fs.cpSync(baselineDir, authorizedDir, {
      recursive: true,
      filter: source => path.basename(source) !== 'node_modules',
    });
    linkInstalledCompiler(authorizedDir);
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
