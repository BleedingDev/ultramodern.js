import assert from 'node:assert/strict';
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
    startNodeRuntime?: (
      app: Record<string, unknown>,
      target: string,
      options: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    stopNodeRuntime?: (runtime: Record<string, unknown>) => Promise<void>;
  };

  try {
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
