import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';

const shellPath = 'apps/shell-super-app';
const moduleFederationConfigPath = `${shellPath}/module-federation.config.ts`;
const modernConfigPath = `${shellPath}/modern.config.ts`;
const bridgeBlock =
  /\n\s*bridge: \{\s*enableBridgeRouter: (?:false|true),\s*\},/u;

function generateWorkspace(workspaceDir: string) {
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: path.basename(workspaceDir),
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: { strategy: 'workspace' },
  });
}

function runValidation(workspaceDir: string) {
  const typescriptPackage = createRequire(import.meta.url).resolve(
    'typescript/package.json',
  );
  return spawnSync(
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
}

function commandOutput(result: ReturnType<typeof runValidation>) {
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
  const absolutePath = path.join(workspaceDir, `${shellPath}/package.json`);
  const packageJson = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
  packageJson.dependencies['react-router'] = '7.18.2';
  fs.writeFileSync(
    absolutePath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf-8',
  );
}

test('generated validator ties bridge.enableBridgeRouter to the declared react-router dependency', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-bridge-router-'));
  const baselineDir = path.join(tempRoot, 'baseline');
  const scenarios: Array<{
    name: string;
    mutate: (workspaceDir: string) => void;
    expected: RegExp;
  }> = [
    {
      name: 'missing-bridge-declaration',
      mutate: workspaceDir => {
        rewrite(workspaceDir, moduleFederationConfigPath, source =>
          source.replace(bridgeBlock, ''),
        );
      },
      expected: /must declare bridge\.enableBridgeRouter/u,
    },
    {
      name: 'bridge-declaration-outside-bridge-block',
      mutate: workspaceDir => {
        rewrite(workspaceDir, moduleFederationConfigPath, source =>
          source.replace(bridgeBlock, '\n  enableBridgeRouter: false,'),
        );
      },
      expected: /must declare bridge\.enableBridgeRouter/u,
    },
    {
      name: 'unauthorized-bridge-router',
      mutate: workspaceDir => {
        rewrite(workspaceDir, moduleFederationConfigPath, source =>
          source.replace(
            'enableBridgeRouter: false',
            'enableBridgeRouter: true',
          ),
        );
      },
      expected: /declares neither react-router nor react-router-dom/u,
    },
    {
      name: 'stray-bridge-router-flag',
      mutate: workspaceDir => {
        rewrite(
          workspaceDir,
          modernConfigPath,
          source =>
            `${source}\nexport const bridgeDeviation = { enableBridgeRouter: false };\n`,
        );
      },
      expected: /carries forbidden option enableBridgeRouter/u,
    },
  ];

  try {
    generateWorkspace(baselineDir);
    const baseline = runValidation(baselineDir);
    assert.equal(baseline.status, 0, commandOutput(baseline));

    for (const scenario of scenarios) {
      const workspaceDir = path.join(tempRoot, scenario.name);
      fs.cpSync(baselineDir, workspaceDir, { recursive: true });
      scenario.mutate(workspaceDir);

      const result = runValidation(workspaceDir);
      const output = commandOutput(result);
      assert.notEqual(result.status, 0, `${scenario.name}\n${output}`);
      assert.match(output, scenario.expected, scenario.name);
      assert.match(
        output,
        /module federation bridge capability/u,
        scenario.name,
      );
    }

    // The same `true` the previous scenario rejected becomes legal the moment
    // the owning app declares React Router itself — that declaration is the
    // whole opt-in contract.
    const authorizedDir = path.join(tempRoot, 'authorized-bridge-router');
    fs.cpSync(baselineDir, authorizedDir, { recursive: true });
    rewrite(authorizedDir, moduleFederationConfigPath, source =>
      source.replace('enableBridgeRouter: false', 'enableBridgeRouter: true'),
    );
    declareReactRouter(authorizedDir);
    const authorized = runValidation(authorizedDir);
    assert.equal(authorized.status, 0, commandOutput(authorized));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
