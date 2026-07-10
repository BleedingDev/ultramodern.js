import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { createWorkspace } from './helpers/workspace-kit';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');

const hermeticEnv = {
  ...process.env,
  MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: '3.2.0-ultramodern.108',
};

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: hermeticEnv,
  });
}

function readJson(workspaceDir: string, relativePath: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  );
}

function createOverlayGenerator(
  tempRoot: string,
  options: { fail?: boolean } = {},
) {
  const generatorDir = path.join(
    tempRoot,
    options.fail ? 'failing-overlay' : 'metadata-overlay',
  );
  fs.mkdirSync(generatorDir, { recursive: true });
  fs.writeFileSync(
    path.join(generatorDir, 'package.json'),
    JSON.stringify(
      {
        name: options.fail
          ? 'test-failing-codesmith-overlay'
          : 'test-metadata-codesmith-overlay',
        version: '0.0.0',
        main: './index.cjs',
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(generatorDir, 'index.cjs'),
    options.fail
      ? "module.exports = async () => { throw new Error('overlay boom'); };\n"
      : `
const fs = require('node:fs');
const path = require('node:path');

module.exports = async context => {
  const config = context.config;
  const app = config.generatedApp;
  const outDir = path.join(config.workspaceRoot, 'overlay-output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, \`\${config.operation}-\${app.id}.json\`),
    JSON.stringify(
      {
        custom: config.custom,
        workspaceRoot: config.workspaceRoot,
        packageScope: config.packageScope,
        operation: config.operation,
        generatedAppId: app.id,
        generatedAppPackage: app.packageName,
        assignedPort: config.assignedPort,
        moduleFederationName: config.moduleFederationName,
        apiPrefix: config.apiPrefix ?? null,
        packageSourceStrategy: config.packageSource.strategy,
        generationResultOperation: config.generationResult.operation,
      },
      null,
      2,
    ),
  );
};
`,
  );
  return generatorDir;
}

test('public API runs explicit CodeSmith overlays and leaves base generation unchanged without overlays', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-overlay-'));

  try {
    const overlayGenerator = createOverlayGenerator(tempRoot);
    const workspaceWithOverlay = path.join(tempRoot, 'workspace-overlay');
    generateUltramodernWorkspace({
      targetDir: workspaceWithOverlay,
      packageName: 'workspace-overlay',
      modernVersion: '3.2.1',
      enableTailwind: true,
      overlays: [
        {
          generator: overlayGenerator,
          config: { custom: 'workspace-overlay' },
        },
      ],
      packageSource: { strategy: 'workspace' },
    });
    assert.deepEqual(
      readJson(
        workspaceWithOverlay,
        'overlay-output/workspace-shell-super-app.json',
      ),
      {
        custom: 'workspace-overlay',
        workspaceRoot: workspaceWithOverlay,
        packageScope: 'workspace-overlay',
        operation: 'workspace',
        generatedAppId: 'shell-super-app',
        generatedAppPackage: '@workspace-overlay/shell-super-app',
        assignedPort: 3020,
        moduleFederationName: 'shellSuperApp',
        apiPrefix: null,
        packageSourceStrategy: 'workspace',
        generationResultOperation: 'workspace',
      },
    );

    const baseWorkspace = path.join(tempRoot, 'base-workspace');
    createWorkspace(baseWorkspace);
    addUltramodernVertical({
      workspaceRoot: baseWorkspace,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    assert.equal(
      fs.existsSync(path.join(baseWorkspace, 'overlay-output')),
      false,
    );

    addUltramodernVertical({
      workspaceRoot: baseWorkspace,
      name: 'checkout',
      modernVersion: '3.2.1',
      overlays: [
        {
          generator: overlayGenerator,
          config: { custom: 'vertical-overlay' },
        },
      ],
    });
    assert.deepEqual(
      readJson(baseWorkspace, 'overlay-output/vertical-checkout.json'),
      {
        custom: 'vertical-overlay',
        workspaceRoot: baseWorkspace,
        packageScope: 'base-workspace',
        operation: 'vertical',
        generatedAppId: 'checkout',
        generatedAppPackage: '@base-workspace/checkout',
        assignedPort: 4102,
        moduleFederationName: 'verticalCheckout',
        apiPrefix: '/checkout-api',
        packageSourceStrategy: 'workspace',
        generationResultOperation: 'vertical',
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI runs explicit CodeSmith overlay for a MicroVertical', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-overlay-'));

  try {
    const overlayGenerator = createOverlayGenerator(tempRoot);
    const workspaceDir = path.join(tempRoot, 'cli-overlay-workspace');
    createWorkspace(path.basename(workspaceDir), { workspaceDir });

    const result = runCli(workspaceDir, [
      '--vertical=checkout',
      '--codesmith-overlay',
      overlayGenerator,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readJson(workspaceDir, 'overlay-output/vertical-checkout.json')
        .generatedAppId,
      'checkout',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI reports CodeSmith overlay failures without the success message', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-overlay-'));

  try {
    const overlayGenerator = createOverlayGenerator(tempRoot, { fail: true });
    const workspaceDir = path.join(tempRoot, 'cli-overlay-failure-workspace');
    createWorkspace(path.basename(workspaceDir), { workspaceDir });

    const result = runCli(workspaceDir, [
      '--vertical=checkout',
      `--codesmith-overlay=${overlayGenerator}`,
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /UltraModern CodeSmith overlay failed/);
    assert.match(result.stderr, /overlay boom/);
    assert.doesNotMatch(result.stdout, /Created successfully/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
