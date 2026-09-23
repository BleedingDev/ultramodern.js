import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('performance configuration validation never claims runtime performance', () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'performance-configuration-validation-'),
  );
  const appPath = 'apps/shell-super-app';
  const topologyPath = path.join(
    workspaceRoot,
    'topology/reference-topology.json',
  );
  fs.mkdirSync(path.dirname(topologyPath), { recursive: true });
  fs.writeFileSync(
    topologyPath,
    `${JSON.stringify({
      schemaVersion: 1,
      shell: {
        id: 'shell-super-app',
        kind: 'shell',
        path: appPath,
        cloudflare: {
          compatibilityFlags: ['nodejs_compat'],
          routes: { ssr: '/en', mfManifest: '/mf-manifest.json' },
          qualityGates: { assets: { cacheControlRequiredForCss: true } },
        },
      },
      verticals: [],
    })}\n`,
  );

  try {
    const modernConfigPath = path.join(
      workspaceRoot,
      appPath,
      'modern.config.ts',
    );
    fs.mkdirSync(path.dirname(modernConfigPath), { recursive: true });
    fs.writeFileSync(modernConfigPath, 'tanstackRouterPlugin();\n');
    const scriptPath = path.resolve(
      __dirname,
      '../templates/workspace-scripts/ultramodern-performance-readiness.mjs',
    );
    execFileSync(process.execPath, [scriptPath], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    });
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
    assert.equal(report.runtimeMeasurement.performed, false);
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
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
