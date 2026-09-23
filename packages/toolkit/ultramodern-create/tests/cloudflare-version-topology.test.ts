import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scriptPath = path.resolve(
  __dirname,
  '../templates/workspace-scripts/proof-cloudflare-version.mjs',
);

test('Cloudflare proof consumes authored topology routes and JSON probes', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'cloudflare-topology-proof-'),
  );
  const topologyPath = path.join(root, 'topology/reference-topology.json');
  const overlayPath = path.join(
    root,
    'topology/local-overlays/development.json',
  );
  const reportPath = path.join(root, 'proof.json');
  const cloudflare = {
    workerName: 'fixture-shell',
    publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_FIXTURE_SHELL',
    routes: { ssr: '/cs', mfManifest: '/mf-manifest.json' },
    jsonSmokeChecks: [{ route: '/health', expect: { ok: true } }],
  };
  fs.mkdirSync(path.dirname(topologyPath), { recursive: true });
  fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
  fs.writeFileSync(
    topologyPath,
    `${JSON.stringify({
      schemaVersion: 1,
      shell: {
        id: 'fixture-shell',
        kind: 'shell',
        path: 'apps/fixture-shell',
        cloudflare,
        deliveryUnit: { unitId: 'fixture-shell', buildMarker: 'build-1' },
      },
      verticals: [
        {
          id: 'catalog',
          kind: 'vertical',
          surfaceProfile: 'api-only',
          path: 'verticals/catalog',
          domain: 'catalog',
          api: { protocol: 'rest', bff: { prefix: '/catalog-api' } },
          cloudflare: {
            workerName: 'fixture-catalog',
            publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_CATALOG',
            routes: { apiReadiness: '/catalog-api/catalog/readiness' },
            jsonSmokeChecks: [
              { route: '/catalog-api/catalog/readiness', expect: { ok: true } },
            ],
          },
          deliveryUnit: { unitId: 'catalog', buildMarker: 'build-1' },
        },
      ],
    })}\n`,
  );
  fs.writeFileSync(
    overlayPath,
    `${JSON.stringify({ schemaVersion: 1, ports: { 'fixture-shell': 3020 } })}\n`,
  );
  const writeRoute = (appPath: string, route: string) => {
    const file = path.join(root, appPath, 'src/routes/[lang]/route.meta.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, route);
  };
  writeRoute(
    'apps/fixture-shell',
    `export default {
    id: 'shell-home', ownerAppId: 'fixture-shell', canonicalPath: '/',
    public: true, indexable: true, localisedPaths: { en: '/', cs: '/' }
  } as const;`,
  );
  fs.mkdirSync(path.join(root, 'verticals/catalog'), { recursive: true });
  try {
    execFileSync(process.execPath, [scriptPath, '--out', reportPath], {
      env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: root },
    });
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.contractPath, topologyPath);
    assert.deepEqual(
      report.proofTargets[0].cloudflare.routes,
      cloudflare.routes,
    );
    assert.deepEqual(
      report.proofTargets[0].cloudflare.jsonSmokeChecks,
      cloudflare.jsonSmokeChecks,
    );
    assert.equal(
      report.proofTargets[0].publicSurface.routeEntries[0].localeUrlPaths.en,
      '/en',
    );
    assert.deepEqual(report.proofTargets[0].publicSurface.concreteUrlPaths, [
      '/cs',
      '/en',
    ]);
    assert.equal(
      report.proofTargets[0].cloudflare.serviceBindings[0].route,
      '/catalog-api/catalog/readiness',
    );
    assert.equal(
      report.proofTargets[0].cloudflare.serviceBindings[0].service,
      'fixture-catalog',
    );
    assert.equal(
      report.proofTargets[1].cloudflare.jsonSmokeChecks[0].route,
      '/catalog-api/catalog/readiness',
    );
    assert.equal(report.skipped.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
