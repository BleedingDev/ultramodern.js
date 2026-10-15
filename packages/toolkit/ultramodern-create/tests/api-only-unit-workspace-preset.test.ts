import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadUltramodernConfigFile } from '@modern-js/ultramodern-app-tools';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

// The generated API-only config imports only these packages; link the
// producer's own copies so the real config evaluates in the temp workspace.
function linkConfigDependencies(workspaceRoot: string) {
  for (const name of [
    '@modern-js/ultramodern-app-tools',
    '@modern-js/plugin-bff-build-extensions',
  ]) {
    const destination = path.join(workspaceRoot, 'node_modules', name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(
      fs.realpathSync(path.resolve(__dirname, '../node_modules', name)),
      destination,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
}

test('a generated API-only unit builds through presetUltramodernWorkspace and passes performance readiness', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-api-only-preset-'),
  );
  const workspaceRoot = path.join(tempRoot, 'workspace');
  try {
    await generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'api-only-preset',
      modernVersion: '3.8.3',
      enableTailwind: false,
      generateAgentFiles: false,
      packageSource: { strategy: 'workspace' },
    });
    await addUltramodernVertical({
      workspaceRoot,
      name: 'tax',
      modernVersion: '3.8.3',
      preset: 'api-only',
    });

    const topology = JSON.parse(
      fs.readFileSync(
        path.join(workspaceRoot, 'topology/reference-topology.json'),
        'utf8',
      ),
    );
    const tax = topology.verticals.find(
      (app: { id: string }) => app.id === 'tax',
    );
    assert.equal(tax.renderer, 'none');
    assert.equal(tax.moduleFederation, undefined);

    const appDirectory = path.join(workspaceRoot, 'verticals/tax');
    // Topology owns the headless renderer; the config selects none.
    assert.doesNotMatch(
      fs.readFileSync(path.join(appDirectory, 'modern.config.ts'), 'utf8'),
      /\brenderer\b/u,
    );

    linkConfigDependencies(workspaceRoot);
    const loaded = await loadUltramodernConfigFile({
      appDirectory,
      env: 'production',
      command: 'build',
    });
    assert.equal(loaded.config.bff?.prefix, '/tax-api');
    assert.ok(
      !loaded.config.plugins?.some(
        plugin => plugin.name === 'ultramodern-zephyr-rspack-plugin',
      ),
    );

    const readiness = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../bin/run.js'),
        'ultramodern',
        'performance-readiness',
      ],
      { cwd: workspaceRoot, encoding: 'utf8' },
    );
    assert.equal(
      readiness.status,
      0,
      `${readiness.stdout}\n${readiness.stderr}`,
    );
    const report = JSON.parse(
      fs.readFileSync(
        path.join(
          workspaceRoot,
          '.codex/reports/performance-readiness/ultramodern-performance-readiness.json',
        ),
        'utf8',
      ),
    );
    assert.equal(report.result, 'configuration-valid');
    assert.deepEqual(
      report.apps
        .find((app: { id: string }) => app.id === 'tax')
        .signals.find(
          (signal: { id: string }) => signal.id === 'save-data-behavior',
        ).evidence,
      ['ui-router-absent', 'runtime-save-data-behavior-not-measured'],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
