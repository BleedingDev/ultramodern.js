import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('performance configuration validation never claims runtime performance', () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'performance-configuration-validation-'),
  );
  const configDirectory = path.join(workspaceRoot, '.modernjs');
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(configDirectory, 'ultramodern.json'),
    `${JSON.stringify({
      topology: {
        apps: [{ id: 'shell-super-app', kind: 'shell' }],
      },
    })}\n`,
  );

  try {
    const scriptPath = path.resolve(
      __dirname,
      '../templates/workspace-scripts/ultramodern-performance-readiness.mjs',
    );
    const stdout = execFileSync(process.execPath, [scriptPath], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    });
    assert.equal(
      stdout.trim(),
      'UltraModern performance configuration validation reported',
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
    assert.equal(report.schemaVersion, 2);
    assert.equal(
      report.profile,
      'ultramodern-performance-configuration-validation-v2',
    );
    assert.equal(report.result, 'configuration-valid');
    assert.deepEqual(report.runtimeMeasurement, {
      performed: false,
      reason: 'static-source-and-configuration-validation-only',
    });
    assert.ok(report.apps.length > 0);
    for (const app of report.apps) {
      for (const signal of app.signals) {
        assert.equal(signal.evidenceKind, 'static-source-and-configuration');
        assert.equal(signal.status, 'configuration-valid');
      }
    }
    const reportText = JSON.stringify(report);
    assert.equal(reportText.includes('"status":"pass"'), false);
    assert.equal(
      reportText.includes(
        'runtime-rum-instrumentation-ready-without-local-collector',
      ),
      false,
    );

    const runtimeSourcePath = path.join(
      workspaceRoot,
      'apps/shell-super-app/src/modern.runtime.ts',
    );
    fs.mkdirSync(path.dirname(runtimeSourcePath), { recursive: true });
    fs.writeFileSync(
      runtimeSourcePath,
      "window.addEventListener('unload', () => undefined);\n",
    );
    assert.throws(
      () =>
        execFileSync(process.execPath, [scriptPath], {
          cwd: workspaceRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      /bfcache static configuration invariant failed/u,
    );

    const readinessConfigPath = path.join(
      workspaceRoot,
      'scripts/ultramodern-performance-readiness.config.mjs',
    );
    fs.mkdirSync(path.dirname(readinessConfigPath), { recursive: true });
    fs.writeFileSync(
      readinessConfigPath,
      "export default { failOn: 'never' };\n",
    );
    execFileSync(process.execPath, [scriptPath], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    });
    const invalidReport = JSON.parse(
      fs.readFileSync(
        path.join(
          workspaceRoot,
          '.codex/reports/performance-readiness/ultramodern-performance-readiness.json',
        ),
        'utf8',
      ),
    );
    assert.equal(invalidReport.result, 'configuration-invalid');
    assert.equal(
      invalidReport.apps[0].signals.find(signal => signal.id === 'bfcache')
        .status,
      'configuration-invalid',
    );

    fs.writeFileSync(
      path.join(configDirectory, 'ultramodern.json'),
      `${JSON.stringify({ topology: { apps: [] } })}\n`,
    );
    assert.throws(
      () =>
        execFileSync(process.execPath, [scriptPath], {
          cwd: workspaceRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      /requires at least one generated app/u,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
