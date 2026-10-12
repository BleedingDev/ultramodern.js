import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { withFederatedWireDiagnostics } from '../browser-smoke/federated-wire-diagnostics.mjs';

test('records decoded native HTTP bytes while preserving response identity and fetch errors', async t => {
  const root = await fs.mkdtemp(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'federated-wire-test-',
    ),
  );
  const raw = Buffer.from('exports.modules = { cs: "Čeština" };');
  const compressed = gzipSync(raw);
  const server = http.createServer((_, response) => {
    response.writeHead(200, {
      'content-type': 'text/javascript',
      'content-encoding': 'gzip',
      'content-length': compressed.length,
      'set-cookie': 'private=excluded',
    });
    response.end(compressed);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/bundles/locale.js`;
  let original;
  const diagnosticFetch = withFederatedWireDiagnostics(async (...args) => {
    original = await fetch(...args);
    return original;
  }, root);
  const result = await diagnosticFetch(url);
  assert.equal(result, original);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), raw);
  const filename = path.join(
    root,
    `1-${createHash('sha256').update(url).digest('hex')}.json`,
  );
  let evidence;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      evidence = JSON.parse(await fs.readFile(filename, 'utf8'));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError))
        throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  assert.ok(evidence);
  assert.equal(evidence.url, url);
  assert.equal(evidence.byteLength, raw.length);
  assert.deepEqual(
    await fs.readFile(path.join(root, evidence.decodedBodyFile)),
    raw,
  );
  assert.deepEqual(Object.keys(evidence.headers), [
    'content-type',
    'content-encoding',
    'content-length',
  ]);
  const failure = new Error('native fetch rejected');
  await assert.rejects(
    withFederatedWireDiagnostics(() => Promise.reject(failure), root)(url),
    error => error === failure,
  );
});

test('records only credential-free loopback bundle URLs', async t => {
  const root = await fs.mkdtemp(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'federated-wire-test-',
    ),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fetch = withFederatedWireDiagnostics(
    async () => new Response('unchanged'),
    root,
  );
  for (const url of [
    'https://example.com/bundles/app.js',
    'http://localhost/api/private.js',
    'http://localhost/bundles/app.js?token=private',
    'http://user:secret@localhost/bundles/app.js',
  ]) {
    assert.equal(await (await fetch(url)).text(), 'unchanged');
  }
  assert.deepEqual(await fs.readdir(root), []);
});

test('labels bounded capture without truncating the original response', async t => {
  const root = await fs.mkdtemp(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'federated-wire-test-',
    ),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = '0123456789';
  const url = 'http://localhost/bundles/oversize.js';
  const fetch = withFederatedWireDiagnostics(
    async () => new Response(raw),
    root,
    { maxResponseBytes: 4 },
  );
  assert.equal(await (await fetch(url)).text(), raw);
  const filename = path.join(
    root,
    `1-${createHash('sha256').update(url).digest('hex')}.json`,
  );
  let evidence;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      evidence = JSON.parse(await fs.readFile(filename, 'utf8'));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError))
        throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  assert.equal(evidence.truncated, true);
  assert.equal(evidence.byteLength, 4);
  assert.equal(
    (await fs.readFile(path.join(root, evidence.decodedBodyFile))).toString(),
    '0123',
  );
});
