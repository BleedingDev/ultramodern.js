// Runs the authored fetch-export lifecycle fixture in real workerd. Its test
// gates are released by a different (diagnostic) request; workerd must not
// cancel the gated request as hung before that release arrives.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  bindingVariable,
  candidateHeader,
  controlHeader,
  defaultRoutes,
} from './contract.mjs';
import { createWorkerLifecycleSources } from './fixtures.mjs';

// The worker toolchain (esbuild, miniflare, react) is installed for the
// generator package that owns Cloudflare template execution.
const toolchainRoot = fileURLToPath(
  new URL('../../../packages/toolkit/ultramodern-create/', import.meta.url),
);
const toolchain = createRequire(path.join(toolchainRoot, 'package.json'));

const token = 'gate-regression-token-0001';
const candidateBinding = {
  sourceRevision: 'a'.repeat(40),
  releaseVersion: '0.0.0-gate.1',
  manifestSha256: 'b'.repeat(64),
  frameworkCohortDigest: 'c'.repeat(64),
};
const candidateText = JSON.stringify(candidateBinding);

test('a gated fetch-export request survives until another request releases it', {
  timeout: 60_000,
}, async () => {
  const fetchRoute = defaultRoutes.find(
    route => route.dispatchForm === 'fetch-export',
  );
  const { sources } = createWorkerLifecycleSources({
    runtimeSpecifier: '@modern-js/runtime',
    token,
    candidateBinding,
  });
  const { source } = sources.find(
    route => route.dispatchForm === 'fetch-export',
  );
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-gate-'));
  let miniflare;
  try {
    const entry = path.join(scratch, fetchRoute.filename);
    fs.writeFileSync(entry, source);
    const { buildSync } = toolchain('esbuild');
    const [bundle] = buildSync({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      conditions: ['workerd', 'worker', 'browser'],
      jsx: 'automatic',
      nodePaths: [path.join(toolchainRoot, 'node_modules')],
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    }).outputFiles;
    const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } =
      await import(pathToFileURL(toolchain.resolve('miniflare')).href);
    miniflare = new Miniflare(
      convertV4MiniflareOptions({
        log: new Log(LogLevel.NONE),
        workers: [
          {
            name: 'gate',
            modules: true,
            script: bundle.text,
            compatibilityDate: '2026-06-02',
            bindings: { [bindingVariable]: token },
          },
        ],
      }),
    );
    await miniflare.ready;

    const id = 'gate_a';
    // Identity: Miniflare would otherwise gzip and hold the progressive shell.
    const headers = {
      'accept-encoding': 'identity',
      [controlHeader]: token,
      [candidateHeader]: candidateText,
    };
    const url = action => {
      const target = new URL(fetchRoute.urlPath, 'https://gate.invalid');
      target.searchParams.set('lifecycleRequest', id);
      if (action) target.searchParams.set('lifecycleControl', action);
      return target.href;
    };
    const control = async action => {
      const response = await miniflare.dispatchFetch(url(action), {
        method: 'POST',
        headers,
      });
      const body = await response.text();
      assert.equal(response.status, 200, body);
      return JSON.parse(body);
    };
    const gated = miniflare.dispatchFetch(url(), {
      method: 'POST',
      headers: { ...headers, 'x-lifecycle-request': id },
      body: 'request',
    });
    gated.catch(() => {});
    for (;;) {
      const { observations } = await control('observe');
      if (observations.some(record => record.id === id)) break;
      await delay(25);
    }
    // Long enough for workerd's hang detection to cancel an idle request.
    await delay(250);
    await control('setup');
    const response = await gated;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    if (response.status !== 207) {
      for (let chunk; !(chunk = await reader.read()).done; )
        html += decoder.decode(chunk.value, { stream: true });
    }
    assert.equal(response.status, 207, html);
    while (!html.includes(`${id}:pending`)) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false, 'stream ended before its shell');
      html += decoder.decode(chunk.value, { stream: true });
    }
    await delay(250);
    await control('deferred');
    for (let chunk; !(chunk = await reader.read()).done; )
      html += decoder.decode(chunk.value, { stream: true });
    assert(html.includes(`${token}:${id}:deferred:`), html);

    let observation;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const { observations } = await control('observe');
      observation = observations.find(record => record.id === id);
      if (
        observation.requestCleanups === 1 &&
        observation.waitUntilCompletions === 1
      )
        break;
      await delay(25);
    }
    assert.equal(observation.producerResolutions, 1);
    assert.equal(observation.requestCleanups, 1);
    assert.equal(observation.waitUntilCompletions, 1);
    assert.deepEqual(observation.renderErrors, []);
  } finally {
    await miniflare?.dispose();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
