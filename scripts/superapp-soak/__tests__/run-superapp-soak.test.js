const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  REQUIRED_WORKLOAD_CLASSES,
  buildSoakPlan,
  parseArgs,
  runSoak,
} = require('../run-superapp-soak');

test('parseArgs supports dry-run planning and short runner overrides', () => {
  const parsed = parseArgs(
    [
      '--dry-run',
      '--profile',
      'local-15m',
      '--base-url',
      'http://localhost:9000/',
      '--duration-seconds',
      '2',
      '--warmup-seconds',
      '0',
      '--cooldown-seconds',
      '0',
      '--concurrency',
      '2',
      '--max-operations',
      '12',
      '--window-ms',
      '250',
      '--run-id',
      'soak-test-run',
      '--output-dir',
      '.modern/test-soak',
    ],
    {},
  );

  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.profileId, 'local-15m');
  assert.equal(parsed.baseUrl, 'http://localhost:9000');
  assert.equal(parsed.durationSeconds, 2);
  assert.equal(parsed.warmupSeconds, 0);
  assert.equal(parsed.cooldownSeconds, 0);
  assert.equal(parsed.concurrency, 2);
  assert.equal(parsed.maxOperations, 12);
  assert.equal(parsed.windowMs, 250);
  assert.match(parsed.outputDir, /\.modern\/test-soak$/);
});

test('dry-run plan materializes local soak scenarios, requests, cadence, chaos-lite, and artifacts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superapp-soak-plan-'));

  try {
    const options = parseArgs(
      [
        '--dry-run',
        '--profile',
        'local-15m',
        '--base-url',
        'http://localhost:9100',
        '--duration-seconds',
        '3',
        '--warmup-seconds',
        '0',
        '--cooldown-seconds',
        '0',
        '--run-id',
        'plan-only',
        '--output-dir',
        tempDir,
      ],
      {},
    );
    const plan = buildSoakPlan(options);

    assert.deepEqual(plan.selectedScenarios, [
      'smoke',
      'mixed-read-write',
      'chat',
      'tenant-boundary',
      'reset',
      'chaos-triggering',
    ]);
    for (const workloadClass of REQUIRED_WORKLOAD_CLASSES) {
      assert.ok(plan.expectedOperationClasses.includes(workloadClass));
    }
    assert.deepEqual(plan.missingWorkloadClasses, []);
    assert.equal(plan.resetCadence.mode, 'fixed-interval');
    assert.equal(plan.chaosLite.enabled, true);
    assert.equal(plan.chaosLite.targetScenarioIds[0], 'chaos-triggering');
    assert.equal(plan.tenantBoundaryCoverage.required, true);

    const tenantOperation = plan.scenarioPlans
      .find(scenario => scenario.id === 'tenant-boundary')
      .operations.find(operation => operation.tenantBoundaryProbeId);
    assert.equal(tenantOperation.method, 'POST');
    assert.equal(tenantOperation.path, '/bff-api/effect/security/probe');
    assert.equal(
      tenantOperation.headers['x-superapp-soak-scenario'],
      'tenant-boundary',
    );
    assert.equal(tenantOperation.body.requestId.includes('plan-only'), true);
    assert.equal(tenantOperation.body.targetTenant, 'security-root');

    const deniedTenantOperation = plan.scenarioPlans
      .find(scenario => scenario.id === 'tenant-boundary')
      .operations.find(
        operation =>
          operation.tenantBoundaryProbeId === 'city-ops-to-security-denied',
      );
    assert.deepEqual(deniedTenantOperation.expectedStatus, [200, 403, 500]);

    const resetOperation = plan.scenarioPlans
      .find(scenario => scenario.id === 'reset')
      .operations.find(operation => operation.kind === 'reset');
    assert.equal(resetOperation.body.resetSeed.tenantId, 'security-root');

    assert.match(plan.artifactPaths.plan, /soak-plan\.json$/);
    assert.match(
      plan.artifactPaths.windowSummary,
      /soak-window-summary\.json$/,
    );
    assert.match(plan.artifactPaths.errorSamples, /soak-error-samples\.json$/);
    assert.match(plan.artifactPaths.resetLedger, /soak-reset-ledger\.json$/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('short mock-server run records requests, resets, chaos-lite errors, tenant probes, latency, and artifacts', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superapp-soak-run-'));
  const observed = [];
  const server = http.createServer(async (request, response) => {
    const body = await readRequestBody(request);
    observed.push({
      body,
      headers: request.headers,
      method: request.method,
      url: request.url,
    });

    if (request.url.startsWith('/bff-api/effect/failure/')) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, chaos: true }));
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });

  try {
    const baseUrl = await listen(server);
    const options = parseArgs(
      [
        '--profile',
        'local-15m',
        '--base-url',
        baseUrl,
        '--duration-seconds',
        '1',
        '--warmup-seconds',
        '0',
        '--cooldown-seconds',
        '0',
        '--concurrency',
        '1',
        '--max-operations',
        '25',
        '--operation-interval-ms',
        '0',
        '--window-ms',
        '100',
        '--run-id',
        'mock-short',
        '--output-dir',
        tempDir,
      ],
      {},
    );

    const result = await runSoak(options);

    assert.equal(result.status, 'warning');
    assert.equal(result.summary.totals.requests.total, 25);
    assert.equal(result.summary.totals.requests.ok, 24);
    assert.equal(result.summary.totals.requests.failed, 1);
    assert.equal(result.summary.totals.errors.byClass['chaos-lite'].count, 1);
    assert.equal(result.summary.totals.resets.attempts, 1);
    assert.equal(result.summary.totals.resets.succeeded, 1);
    assert.ok(result.summary.totals.latency.count >= 25);
    assert.ok(result.summary.totals.sampleCount > 0);

    assert.ok(
      observed.some(entry =>
        entry.url.startsWith('/bff-api/effect/security/probe'),
      ),
    );
    assert.ok(
      observed.some(entry =>
        entry.url.startsWith('/bff-api/effect/failure/api-timeout'),
      ),
    );
    assert.ok(observed.some(entry => entry.url === '/bff-api/effect/reset'));

    const tenantProbeBodies = observed
      .filter(entry => entry.url.startsWith('/bff-api/effect/security/probe'))
      .map(entry => JSON.parse(entry.body));
    assert.ok(
      tenantProbeBodies.some(body => body.targetTenant === 'security-root'),
    );
    assert.ok(
      tenantProbeBodies.some(body => body.targetTenant === 'platform-shell'),
    );

    const summary = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'summary.json'), 'utf8'),
    );
    const windowSummary = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'soak-window-summary.json'), 'utf8'),
    );
    const errorSamples = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'soak-error-samples.json'), 'utf8'),
    );
    const resetLedger = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'soak-reset-ledger.json'), 'utf8'),
    );

    assert.equal(summary.suite, 'superapp-soak');
    assert.equal(summary.status, 'warning');
    assert.equal(summary.metrics.totals.requests.total, 25);
    assert.equal(windowSummary.totals.requests.total, 25);
    assert.equal(errorSamples.samples.length, 1);
    assert.equal(errorSamples.samples[0].class, 'chaos-lite');
    assert.equal(errorSamples.samples[0].source, 'request');
    assert.equal(resetLedger.attempts, 1);
    assert.equal(resetLedger.succeeded, 1);
  } finally {
    await closeServer(server);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
