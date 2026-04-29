const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyCachePolicyMainThread,
  buildBenchmarkApps,
  runWorkerLaneBenchmark,
} = require('../workerLane');

test('applyCachePolicyMainThread pins cache version query key', () => {
  const input = [
    {
      name: 'crm-shell',
      entry: 'https://example.com/remoteEntry.js',
      runtimeDigest: 'digest-crm',
    },
  ];
  const output = applyCachePolicyMainThread(input);
  assert.equal(output.length, 1);
  assert.equal(output[0].entry.includes('mfv='), true);
});

test('buildBenchmarkApps creates deterministic app entries', () => {
  const apps = buildBenchmarkApps(3);
  assert.equal(apps.length, 3);
  assert.equal(apps[0].name, 'benchmark-app-0');
  assert.equal(apps[2].entry.includes('/app-2/'), true);
});

test('runWorkerLaneBenchmark reports gate and usage metadata', async () => {
  const report = await runWorkerLaneBenchmark({
    iterations: 2,
    concurrency: 1,
    appCount: 32,
    timeoutMs: 1_000,
    minAppCount: 1,
    workerLaneEnabled: true,
    maxFallbackRate: 1,
    maxP95Ms: 10_000,
  });

  assert.equal(report.totals.requests, 2);
  assert.equal(report.totals.ok, 2);
  assert.equal(typeof report.gate.passed, 'boolean');
  assert.equal(
    report.totals.workerUsed + report.totals.fallbackToMainThread,
    2,
  );
});
