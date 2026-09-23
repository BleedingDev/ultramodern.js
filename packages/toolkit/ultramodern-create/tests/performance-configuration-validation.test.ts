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

test('API-only performance validation requires readiness and Node compatibility without UI routes', () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'performance-api-only-validation-'),
  );
  const topologyPath = path.join(
    workspaceRoot,
    'topology/reference-topology.json',
  );
  const scriptPath = path.resolve(
    __dirname,
    '../templates/workspace-scripts/ultramodern-performance-readiness.mjs',
  );
  const cloudflare = {
    compatibilityFlags: ['nodejs_compat'],
    routes: { apiReadiness: '/inventory-api/inventory/readiness' },
    qualityGates: { assets: { cacheControlRequiredForCss: true } },
  };
  const topology = {
    schemaVersion: 1,
    shell: {
      id: 'shell',
      path: 'apps/shell',
      cloudflare: {
        ...cloudflare,
        routes: { ssr: '/en', mfManifest: '/mf-manifest.json' },
      },
    },
    verticals: [
      {
        id: 'inventory',
        kind: 'vertical',
        surfaceProfile: 'api-only',
        path: 'verticals/inventory',
        api: { runtime: 'effect' },
        cloudflare,
      },
    ],
  };
  const writeTopology = () => {
    fs.mkdirSync(path.dirname(topologyPath), { recursive: true });
    fs.writeFileSync(topologyPath, `${JSON.stringify(topology)}\n`);
  };
  const run = () =>
    execFileSync(process.execPath, [scriptPath], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  try {
    for (const appPath of ['apps/shell', 'verticals/inventory']) {
      const configPath = path.join(workspaceRoot, appPath, 'modern.config.ts');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, 'tanstackRouterPlugin();\n');
    }
    writeTopology();
    run();
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
    const inventory = report.apps.find(app => app.id === 'inventory');
    assert.deepEqual(
      inventory.signals.find(
        signal => signal.id === 'cloudflare-ssr-cache-hints',
      ).evidence,
      ['api-readiness-route-present', 'ui-routes-absent', 'nodejs-compat'],
    );

    delete topology.verticals[0].cloudflare.routes.apiReadiness;
    writeTopology();
    assert.throws(
      run,
      /cloudflare-ssr-cache-hints static configuration invariant failed/u,
    );
    topology.verticals[0].cloudflare.routes.apiReadiness =
      '/inventory-api/inventory/readiness';
    topology.verticals[0].cloudflare.routes.ssr = '/en';
    writeTopology();
    assert.throws(
      run,
      /cloudflare-ssr-cache-hints static configuration invariant failed/u,
    );
    delete topology.verticals[0].cloudflare.routes.ssr;
    topology.verticals[0].cloudflare.compatibilityFlags = [];
    writeTopology();
    assert.throws(
      run,
      /cloudflare-ssr-cache-hints static configuration invariant failed/u,
    );

    topology.verticals[0].cloudflare.compatibilityFlags = ['nodejs_compat'];
    topology.verticals[0].api.protocol = 'rpc';
    topology.verticals[0].cloudflare.routes = {
      rpc: '/inventory-api/inventory/rpc',
    };
    writeTopology();
    run();
    const rpcReport = JSON.parse(
      fs.readFileSync(
        path.join(
          workspaceRoot,
          '.codex/reports/performance-readiness/ultramodern-performance-readiness.json',
        ),
        'utf8',
      ),
    );
    assert.equal(rpcReport.result, 'configuration-valid');
    assert.deepEqual(
      rpcReport.apps
        .find(app => app.id === 'inventory')
        .signals.find(signal => signal.id === 'cloudflare-ssr-cache-hints')
        .evidence,
      ['rpc-route-present', 'ui-routes-absent', 'nodejs-compat'],
    );
    delete topology.verticals[0].cloudflare.routes.rpc;
    topology.verticals[0].cloudflare.routes.apiReadiness =
      '/inventory-api/inventory/readiness';
    writeTopology();
    assert.throws(
      run,
      /cloudflare-ssr-cache-hints static configuration invariant failed/u,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
