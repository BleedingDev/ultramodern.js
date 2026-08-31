import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const reservePort = async () => {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  );
  return port;
};

test('Node backend proof owns the runtime lifecycle for built MicroVerticals', async () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'node-backend-proof-lifecycle-'),
  );
  const appDirectory = path.join(workspaceRoot, 'verticals/catalog/.output');
  const port = await reservePort();
  fs.mkdirSync(appDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(appDirectory, 'index.js'),
    [
      "const http = require('node:http');",
      'const port = Number(process.env.VERTICAL_CATALOG_PORT);',
      'http.createServer((_request, response) => {',
      "  response.writeHead(200, { 'content-type': 'application/json' });",
      '  response.end(JSON.stringify({ port: process.env.PORT }));',
      "}).listen(port, '127.0.0.1');",
      '',
    ].join('\n'),
  );

  const proofModule = (await import(
    pathToFileURL(
      path.resolve(
        __dirname,
        '../templates/workspace-scripts/proof-node-backend-federation.mjs',
      ),
    ).href
  )) as {
    resolveNodeProofServerMode?: (
      env: Record<string, string | undefined>,
    ) => 'existing' | 'owned';
    startNodeRuntime?: (
      app: Record<string, unknown>,
      target: string,
      options: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    stopNodeRuntime?: (runtime: Record<string, unknown>) => Promise<void>;
  };

  try {
    assert.equal(typeof proofModule.resolveNodeProofServerMode, 'function');
    assert.equal(proofModule.resolveNodeProofServerMode!({}), 'owned');
    assert.equal(
      proofModule.resolveNodeProofServerMode!({
        ULTRAMODERN_NODE_PROOF_SERVER_MODE: 'existing',
      }),
      'existing',
    );
    assert.throws(
      () =>
        proofModule.resolveNodeProofServerMode!({
          ULTRAMODERN_NODE_PROOF_SERVER_MODE: 'disabled',
        }),
      /ULTRAMODERN_NODE_PROOF_SERVER_MODE/u,
    );
    assert.equal(typeof proofModule.startNodeRuntime, 'function');
    assert.equal(typeof proofModule.stopNodeRuntime, 'function');
    const runtime = await proofModule.startNodeRuntime!(
      {
        id: 'catalog',
        directory: 'verticals/catalog',
        manifestUrl: `http://127.0.0.1:${port}/backend-mf-manifest.json`,
        port,
        portEnv: 'VERTICAL_CATALOG_PORT',
      },
      '.output',
      {
        startupTimeoutMs: 5_000,
        workspaceRoot,
      },
    );

    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { port: String(port) });

    await proofModule.stopNodeRuntime!(runtime);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Node backend proof executes the exact container bytes it verified', async () => {
  const proofModule = (await import(
    pathToFileURL(
      path.resolve(
        __dirname,
        '../templates/workspace-scripts/proof-node-backend-federation.mjs',
      ),
    ).href
  )) as {
    fetchBoundArtifact?: (
      app: Record<string, unknown>,
      url: string,
      artifact: Record<string, unknown>,
      label: string,
      fetchImpl: typeof fetch,
    ) => Promise<{ bytes: Buffer; evidence: Record<string, unknown> }>;
    loadBackendFromVerifiedArtifacts?: (options: {
      app: Record<string, unknown>;
      buildIdentity: Record<string, unknown>;
      container: { bytes: Buffer };
      loadImpl: (options: Record<string, unknown>) => Promise<unknown>;
      manifest: { bytes: Buffer };
    }) => Promise<unknown>;
  };
  assert.equal(typeof proofModule.fetchBoundArtifact, 'function');
  assert.equal(typeof proofModule.loadBackendFromVerifiedArtifacts, 'function');

  const manifestBytes = Buffer.from(
    JSON.stringify({
      backendFederation: { runtimeFramework: 'effect' },
      entry: { url: 'https://example.test/backendRemoteEntry.cjs' },
    }),
  );
  const verifiedContainerBytes = Buffer.from(
    "module.exports = { verified: 'executed' };",
  );
  const changedSecondFetchBytes = Buffer.from(
    "module.exports = { attacker: 'executed' };",
  );
  const bodies = [
    manifestBytes,
    verifiedContainerBytes,
    changedSecondFetchBytes,
  ];
  let networkFetchCount = 0;
  const fetchImpl = async () => {
    const body = bodies[networkFetchCount];
    networkFetchCount += 1;
    return new Response(body, { status: 200 });
  };
  const digest = (bytes: Buffer) =>
    createHash('sha256').update(bytes).digest('hex');
  const app = {
    backendName: 'verticalCatalogBackend',
    containerEntry: 'https://example.test/backendRemoteEntry.cjs',
    id: 'catalog',
    manifestUrl: 'https://example.test/backend-mf-manifest.json',
  };
  const manifest = await proofModule.fetchBoundArtifact!(
    app,
    app.manifestUrl,
    {
      byteLength: manifestBytes.byteLength,
      logicalPath: 'backend-mf-manifest.json',
      sha256: digest(manifestBytes),
    },
    'backend manifest',
    fetchImpl,
  );
  const container = await proofModule.fetchBoundArtifact!(
    app,
    app.containerEntry,
    {
      byteLength: verifiedContainerBytes.byteLength,
      logicalPath: 'backendRemoteEntry.cjs',
      sha256: digest(verifiedContainerBytes),
    },
    'backend container',
    fetchImpl,
  );
  const loaded = await proofModule.loadBackendFromVerifiedArtifacts!({
    app,
    buildIdentity: {
      buildVersion: 'catalog-build',
      packageName: '@example/catalog',
      unitId: 'catalog',
    },
    container,
    manifest,
    async loadImpl(options) {
      const entryPolicy = options.entryPolicy as {
        fetch: (url: string) => Promise<Response>;
      };
      const response = await entryPolicy.fetch(app.containerEntry);
      return Buffer.from(await response.arrayBuffer()).toString('utf8');
    },
  });

  assert.equal(loaded, verifiedContainerBytes.toString('utf8'));
  assert.equal(networkFetchCount, 2);
  assert.notEqual(loaded, changedSecondFetchBytes.toString('utf8'));
});
