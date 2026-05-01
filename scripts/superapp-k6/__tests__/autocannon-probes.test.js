const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAutocannonCliArgs,
  buildAutocannonProbeRequest,
  getAutocannonProbeCatalog,
  getAutocannonProbeDefinition,
  getAutocannonProbeIds,
  normalizeAutocannonProbeSelection,
  validateAutocannonProbeCatalog,
} = require('../autocannon-probes');

test('autocannon catalog covers key GET and POST endpoints with multi-worker metadata', () => {
  const catalog = getAutocannonProbeCatalog();

  assert.equal(validateAutocannonProbeCatalog(catalog), true);
  assert.deepEqual(catalog.defaultProbeIds, getAutocannonProbeIds());

  const methods = new Set(catalog.probes.map(probe => probe.endpoint.method));
  assert.ok(methods.has('GET'));
  assert.ok(methods.has('POST'));

  for (const probe of catalog.probes) {
    assert.equal(probe.autocannon.workerModel, 'multi-worker');
    assert.ok(probe.autocannon.workers >= 2);
    assert.ok(probe.autocannon.connections > 0);
    assert.match(probe.endpoint.path, /^\//);
    assert.ok(probe.scenarioId);
    assert.ok(probe.operationId);
  }
});

test('autocannon probe selection expands all and deduplicates explicit ids', () => {
  assert.deepEqual(
    normalizeAutocannonProbeSelection('all'),
    getAutocannonProbeIds(),
  );
  assert.deepEqual(
    normalizeAutocannonProbeSelection(
      'get-bootstrap,get-bootstrap,post-workflow',
    ),
    ['get-bootstrap', 'post-workflow'],
  );
});

test('autocannon requests materialize operation templates and SuperApp headers', () => {
  const probe = getAutocannonProbeDefinition('post-workflow');
  const request = buildAutocannonProbeRequest(probe, {
    runId: 'run-123',
  });

  assert.equal(request.method, 'POST');
  assert.match(request.path, /^\/bff-api\/effect\/apps\//);
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.headers['x-superapp-autocannon-probe'], 'post-workflow');
  assert.equal(
    request.headers['x-superapp-autocannon-worker-model'],
    'multi-worker',
  );
  assert.equal(request.headers['x-request-id'], 'run-123-post-workflow');
  assert.match(request.body, /run-123-post-workflow/);
  assert.ok(request.bodyBytes > 0);
});

test('autocannon CLI args include worker controls, JSON output, headers, and body', () => {
  const probe = getAutocannonProbeDefinition('post-pilot-run');
  const run = buildAutocannonCliArgs(probe, {
    baseUrl: 'http://localhost:4321/',
    runId: 'run-456',
    workers: 5,
    connections: 11,
    durationSeconds: 7,
    timeoutSeconds: 3,
    pipelining: 2,
  });

  assert.deepEqual(run.args.slice(0, 2), ['--json', '--method']);
  assert.ok(run.args.includes('--workers'));
  assert.ok(run.args.includes('5'));
  assert.ok(run.args.includes('--connections'));
  assert.ok(run.args.includes('11'));
  assert.ok(run.args.includes('--body'));
  assert.match(
    run.args.at(-1),
    /^http:\/\/localhost:4321\/bff-api\/effect\/pilot\//,
  );
  assert.equal(run.autocannon.workers, 5);
  assert.equal(run.autocannon.connections, 11);
});
