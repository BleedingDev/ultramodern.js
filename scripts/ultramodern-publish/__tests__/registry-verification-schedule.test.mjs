import assert from 'node:assert/strict';
import test from 'node:test';
import { registryVerificationRetryDelaysMs } from '../lib/prepare-bleedingdev-packages/registry.mjs';

// The post-publish verifier runs after the unrollbackable publish. If it gives
// up before npm has propagated a freshly published version into the packument,
// a complete cohort is reported as a failed publication (run 34689880072:
// one package's packument lagged for more than the 360s the loop then spent).
test('post-publish verification outlasts npm packument propagation', () => {
  const delays = [...registryVerificationRetryDelaysMs];
  // The loop sleeps only between attempts: the final entry is never spent.
  const spentMs = delays.slice(0, -1).reduce((sum, delay) => sum + delay, 0);
  assert.ok(
    spentMs >= 840_000,
    `verification waits ${spentMs}ms; npm has needed more than 420s`,
  );
  // Front-loaded: a package that is already coherent is accepted in seconds.
  assert.ok(delays[0] <= 2000);
  for (let index = 1; index < delays.length; index += 1) {
    assert.ok(delays[index] >= delays[index - 1], 'delays never shrink');
  }
});

test('registry readers drain concurrent work before reporting the first input failure', async () => {
  const { mapWithConcurrency } = await import(
    '../lib/prepare-bleedingdev-packages/registry-read.mjs'
  );
  const completed = [];
  let release;
  const pending = mapWithConcurrency([0, 1, 2], 2, async index => {
    if (index === 0) throw new Error('first package');
    if (index === 1)
      await new Promise(resolve => {
        release = resolve;
      });
    completed.push(index);
  });
  let settled = false;
  const rejected = assert.rejects(pending, /first package/).then(() => {
    settled = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  await rejected;
  assert.deepEqual(completed.sort(), [1, 2]);
});

test('registry reads distinguish absent, throttled and malformed state', async () => {
  const { lookupRegistryPackument, resolveRegistryPackageDist } = await import(
    '../lib/prepare-bleedingdev-packages/registry-read.mjs'
  );
  const pkg = '@bleedingdev/modern-js-runtime';
  const read = (output, options = {}) =>
    resolveRegistryPackageDist(pkg, '1.0.0', {
      run: async () => {
        if (output instanceof Error) throw output;
        return { stdout: output };
      },
      ...options,
    });
  assert.equal(
    await read(new Error('E404 Not Found'), { optional: true }),
    null,
  );
  await assert.rejects(
    read(new Error('E429 Too Many Requests'), { optional: true }),
    /uncertain/,
  );
  await assert.rejects(read('[]', { optional: true }), /invalid registry dist/);
  const dist = { shasum: 'exact', integrity: 'exact' };
  assert.deepEqual(await read(JSON.stringify(dist)), dist);
  for (const status of [404, 429]) {
    const delays = [];
    let requests = 0;
    await assert.rejects(
      lookupRegistryPackument(pkg, {
        fetchImpl: async () => {
          requests += 1;
          return { ok: false, status };
        },
        wait: async delay => {
          delays.push(delay);
        },
      }),
      status === 404 ? /HTTP 404/ : /stayed throttled/,
    );
    assert.equal(requests, status === 404 ? 1 : 4);
    assert.deepEqual(delays, status === 404 ? [] : [1000, 2000, 3000]);
  }
});
