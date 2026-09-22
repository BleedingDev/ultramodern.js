import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeWorkspaceInputs } from '../src/ultramodern-tooling/config';
import { addUltramodernVertical } from '../src/ultramodern-workspace';
import { formatGeneratedWorkspaceFiles } from '../src/ultramodern-workspace/fs-io';
import {
  createWorkspaceScriptArtifacts,
  writeGeneratedWorkspaceScripts,
} from '../src/ultramodern-workspace/workspace-scripts';
import {
  createWorkspace,
  linkWorkspaceFormatterDependencies,
} from './helpers/workspace-kit';

const configPath = '.modernjs/ultramodern.json';
const topologyPath = 'topology/reference-topology.json';
const overlayPath = 'topology/local-overlays/development.json';
const primaryDirectory = 'apps/shell-super-app';

function readJson(root: string, relativePath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function writeJson(root: string, relativePath: string, value: unknown) {
  fs.writeFileSync(
    path.join(root, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

test('fresh/add-vertical share script bytes for api-bearing inputs', () => {
  const { tempRoot, workspaceDir } = createWorkspace('artifact-parity', {
    tempPrefix: 'um-artifact-parity-',
  });
  linkWorkspaceFormatterDependencies(workspaceDir);
  const freshRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-script-projection-'),
  );
  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'orders',
      modernVersion: '3.2.1',
    });
    const config = readJson(workspaceDir, configPath);
    const overlay = readJson(workspaceDir, overlayPath);
    const view = normalizeWorkspaceInputs(workspaceDir, {
      config,
      topology: readJson(workspaceDir, topologyPath),
      overlay,
    });
    writeGeneratedWorkspaceScripts(freshRoot, view.verticals);
    const artifacts = createWorkspaceScriptArtifacts({
      shellOnly: view.verticals.length === 0,
      hasBackendSurface: view.verticals.some(app => app.api !== undefined),
    });
    const paths = artifacts.map(artifact => artifact.relativePath);
    formatGeneratedWorkspaceFiles(freshRoot, paths);
    // Every thin runtime wrapper, including validation, comes from the installed CLI.
    for (const relativePath of paths) {
      assert.equal(
        fs.readFileSync(path.join(workspaceDir, relativePath), 'utf8'),
        fs.readFileSync(path.join(freshRoot, relativePath), 'utf8'),
        relativePath,
      );
    }
    // An api-bearing vertical materializes both backend runtime wrappers.
    assert.equal(
      fs.existsSync(
        path.join(workspaceDir, 'scripts/materialize-zerops-runtime.mjs'),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(workspaceDir, 'scripts/generate-node-backend-federation.mts'),
      ),
      true,
    );
    const validation = spawnSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mts'],
      { cwd: workspaceDir, encoding: 'utf8' },
    );
    assert.equal(validation.status, 0, validation.stdout + validation.stderr);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(freshRoot, { recursive: true, force: true });
  }
});

test('add-vertical conserves authored config, script segments and live ports', () => {
  const { tempRoot, workspaceDir } = createWorkspace('artifact-custom', {
    tempPrefix: 'um-artifact-custom-',
  });
  linkWorkspaceFormatterDependencies(workspaceDir);
  try {
    const config = readJson(workspaceDir, configPath);
    config.consumer = { custom: ['keep'] };
    config.workspace.consumerWorkspace = true;
    config.workspace.packageManager.consumerPackageManager = true;
    config.moduleFederation.apps[0].consumerProjection = true;
    config.features.consumerFeature = false;
    config.topology.consumerTopology = true;
    config.topology.apps[0].consumerApp = true;
    config.topology.apps[0].moduleFederation.consumerMf = true;
    writeJson(workspaceDir, configPath, config);
    const topology = readJson(workspaceDir, topologyPath);
    topology.consumerTopology = { keep: true };
    writeJson(workspaceDir, topologyPath, topology);
    const overlay = readJson(workspaceDir, overlayPath);
    overlay.ports['shell-super-app'] = 3120;
    overlay.ports.consumerPort = 9999;
    overlay.consumerOverlay = { keep: true };
    writeJson(workspaceDir, overlayPath, overlay);
    const rootPackage = readJson(workspaceDir, 'package.json');
    rootPackage.scripts['consumer:check'] = 'echo consumer';
    rootPackage.scripts.check = `pnpm consumer:check && ${rootPackage.scripts.check}`;
    rootPackage.scripts.build += ' && echo consumer-build';
    writeJson(workspaceDir, 'package.json', rootPackage);
    const shellPackage = readJson(
      workspaceDir,
      `${primaryDirectory}/package.json`,
    );
    shellPackage.consumerPackage = true;
    shellPackage.scripts.build += ' && echo consumer-shell';
    shellPackage.scripts['consumer:task'] = 'echo task';
    writeJson(workspaceDir, `${primaryDirectory}/package.json`, shellPackage);
    const authoredPaths = [
      `${primaryDirectory}/modern.config.ts`,
      `${primaryDirectory}/module-federation.config.ts`,
      `${primaryDirectory}/src/routes/[lang]/page.tsx`,
      'scripts/bootstrap-agent-skills.mts',
    ];
    const authored = Object.fromEntries(
      authoredPaths.map(relativePath => {
        const content = `${fs.readFileSync(path.join(workspaceDir, relativePath), 'utf8')}\n// Consumer extension.\n`;
        fs.writeFileSync(path.join(workspaceDir, relativePath), content);
        return [relativePath, content];
      }),
    );
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'orders',
      modernVersion: '3.2.1',
    });
    for (const phase of ['add']) {
      for (const [relativePath, content] of Object.entries(authored)) {
        assert.equal(
          fs.readFileSync(path.join(workspaceDir, relativePath), 'utf8'),
          content,
          `${phase}: ${relativePath}`,
        );
      }
      const current = readJson(workspaceDir, configPath);
      assert.deepEqual(current.consumer, config.consumer);
      assert.equal(current.workspace.consumerWorkspace, true);
      assert.equal(
        current.workspace.packageManager.consumerPackageManager,
        true,
      );
      assert.equal(current.moduleFederation.apps[0].consumerProjection, true);
      assert.equal(current.features.consumerFeature, false);
      assert.equal(current.topology.consumerTopology, true);
      assert.equal(current.topology.apps[0].consumerApp, true);
      assert.equal(current.topology.apps[0].port, config.topology.apps[0].port);
      assert.equal(current.topology.apps[0].moduleFederation.consumerMf, true);
      assert.deepEqual(
        readJson(workspaceDir, topologyPath).consumerTopology,
        topology.consumerTopology,
      );
      assert.equal(
        readJson(workspaceDir, overlayPath).ports['shell-super-app'],
        3120,
      );
      assert.equal(
        readJson(workspaceDir, overlayPath).ports.consumerPort,
        9999,
      );
      const scripts = readJson(workspaceDir, 'package.json').scripts;
      assert.equal(scripts['consumer:check'], 'echo consumer');
      assert.match(scripts.check, /pnpm consumer:check/);
      assert.match(scripts.build, /echo consumer-build/);
      const currentShell = readJson(
        workspaceDir,
        `${primaryDirectory}/package.json`,
      );
      assert.equal(currentShell.consumerPackage, true);
      assert.match(currentShell.scripts.build, /echo consumer-shell/);
      assert.equal(currentShell.scripts['consumer:task'], 'echo task');
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
