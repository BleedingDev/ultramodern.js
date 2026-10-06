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

test('Cloudflare proof expects the release marker of the proven source revision', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'cloudflare-release-marker-proof-'),
  );
  const reportPath = path.join(root, 'proof.json');
  const generationBuildMarker = '26e7bfcc7c19d1d4';
  const sourceRevision = '42d9606f9556053f96c8c694660ded1811b6d149';
  // Marker observed on the live app/assortment worker built at sourceRevision.
  const releaseBuildMarker = 'ecaecb8391528f91';
  fs.mkdirSync(path.join(root, 'topology/local-overlays'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'topology/reference-topology.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      shell: {
        id: 'fixture-shell',
        kind: 'shell',
        path: 'apps/fixture-shell',
        cloudflare: {
          workerName: 'fixture-shell',
          publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_FIXTURE_SHELL',
          routes: { ssr: '/cs' },
        },
        deliveryUnit: {
          unitId: 'app/shell',
          buildMarker: generationBuildMarker,
        },
      },
      verticals: [
        {
          id: 'assortment',
          kind: 'vertical',
          surfaceProfile: 'api-only',
          path: 'verticals/assortment',
          domain: 'assortment',
          api: { protocol: 'rest', bff: { prefix: '/assortment-api' } },
          cloudflare: {
            workerName: 'fixture-assortment',
            publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_ASSORTMENT',
            routes: { apiReadiness: '/assortment-api/readiness' },
          },
          deliveryUnit: {
            unitId: 'app/assortment',
            buildMarker: generationBuildMarker,
          },
        },
      ],
    })}\n`,
  );
  fs.writeFileSync(
    path.join(root, 'topology/local-overlays/development.json'),
    `${JSON.stringify({ schemaVersion: 1 })}\n`,
  );
  const shellRoute = path.join(
    root,
    'apps/fixture-shell/src/routes/[lang]/route.meta.ts',
  );
  fs.mkdirSync(path.dirname(shellRoute), { recursive: true });
  fs.writeFileSync(
    shellRoute,
    `export default {
    id: 'shell-home', ownerAppId: 'fixture-shell', canonicalPath: '/',
    public: true, indexable: true, localisedPaths: { en: '/', cs: '/' }
  } as const;`,
  );
  fs.mkdirSync(path.join(root, 'verticals/assortment'), { recursive: true });
  const runProof = (revision?: string) => {
    const env = { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: root };
    delete env.ULTRAMODERN_SOURCE_REVISION;
    execFileSync(process.execPath, [scriptPath, '--out', reportPath], {
      env: revision ? { ...env, ULTRAMODERN_SOURCE_REVISION: revision } : env,
    });
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return {
      shell: report.proofTargets[0],
      assortment: report.proofTargets[1],
    };
  };
  try {
    const released = runProof(sourceRevision);
    const releaseIdentity = {
      unitId: 'app/assortment',
      buildMarker: releaseBuildMarker,
      sourceRevision,
    };
    assert.equal(released.assortment.marker.build, releaseBuildMarker);
    assert.equal(
      released.assortment.deliveryUnit.buildMarker,
      releaseBuildMarker,
    );
    assert.equal(
      released.assortment.deliveryUnit.sourceRevision,
      sourceRevision,
    );
    assert.deepEqual(released.assortment.deliveryUnit.surfaces, {
      api: { ...releaseIdentity, surface: 'api' },
    });
    assert.equal(
      released.shell.cloudflare.serviceBindings[0].expectedMarker,
      releaseBuildMarker,
    );
    assert.notEqual(released.shell.marker.build, generationBuildMarker);
    assert.equal(
      released.shell.deliveryUnit.surfaces.ui.buildMarker,
      released.shell.marker.build,
    );

    const workspace = runProof();
    assert.equal(workspace.assortment.marker.build, generationBuildMarker);
    assert.equal(workspace.assortment.deliveryUnit.sourceRevision, 'workspace');
    assert.equal(
      workspace.shell.cloudflare.serviceBindings[0].expectedMarker,
      generationBuildMarker,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
