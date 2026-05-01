const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseArgs,
  resolveExecutableValue,
  resolveK6Binary,
} = require('../run-superapp-k6');

const RUNNER_PATH = path.resolve(__dirname, '../run-superapp-k6.js');
const DEFAULT_SCENARIO_SCRIPT_PATH = path.resolve(
  __dirname,
  '../superapp-scenarios.js',
);

test('parseArgs keeps pass-through k6 arguments after --', () => {
  const parsed = parseArgs(
    [
      '--check',
      '--k6-bin',
      './tools/k6',
      '--base-url',
      'http://localhost:9000/',
      '--threshold-profile',
      'release',
      '--',
      '--vus',
      '4',
      '--duration',
      '30s',
    ],
    {},
  );

  assert.equal(parsed.checkOnly, true);
  assert.equal(parsed.baseUrl, 'http://localhost:9000');
  assert.equal(parsed.k6Bin, './tools/k6');
  assert.equal(parsed.thresholdProfile, 'release');
  assert.deepEqual(parsed.passThroughArgs, ['--vus', '4', '--duration', '30s']);
});

test('parseArgs maps built-in scenario selection to the default k6 script', () => {
  const parsed = parseArgs(
    ['--scenario', 'smoke,chat', '--', '--tag', 'lane=ust-load-02'],
    {},
  );

  assert.equal(parsed.scriptPath, DEFAULT_SCENARIO_SCRIPT_PATH);
  assert.equal(parsed.scenario, 'smoke,chat');
  assert.deepEqual(parsed.scenarioIds, ['smoke', 'chat']);
  assert.deepEqual(parsed.passThroughArgs, ['--tag', 'lane=ust-load-02']);
});

test('parseArgs captures autocannon probe controls', () => {
  const parsed = parseArgs(
    [
      '--autocannon-probes',
      'get-bootstrap,post-workflow',
      '--autocannon-bin',
      './tools/autocannon',
      '--autocannon-bin-arg',
      'dlx',
      '--autocannon-workers',
      '3',
      '--autocannon-connections',
      '24',
      '--autocannon-duration-seconds',
      '9',
      '--autocannon-timeout-seconds',
      '4',
      '--autocannon-pipelining',
      '2',
      '--require-autocannon',
    ],
    {},
  );

  assert.equal(parsed.loadGenerator, 'autocannon');
  assert.deepEqual(parsed.autocannonProbeIds, [
    'get-bootstrap',
    'post-workflow',
  ]);
  assert.equal(parsed.autocannonBin, './tools/autocannon');
  assert.deepEqual(parsed.autocannonBinArgs, ['dlx']);
  assert.equal(parsed.autocannonWorkers, 3);
  assert.equal(parsed.autocannonConnections, 24);
  assert.equal(parsed.autocannonDurationSeconds, 9);
  assert.equal(parsed.autocannonTimeoutSeconds, 4);
  assert.equal(parsed.autocannonPipelining, 2);
  assert.equal(parsed.requireAutocannon, true);
});

test('parseArgs captures app-server orchestration controls', () => {
  const parsed = parseArgs(
    [
      '--scenario',
      'smoke',
      '--app-dir',
      'tests/integration/superapp-portfolio',
      '--app-host',
      '127.0.0.1',
      '--app-port',
      '4567',
      '--health-path',
      'health',
      '--startup-timeout-ms',
      '5000',
      '--health-timeout-ms',
      '750',
      '--warmup-ms',
      '11',
      '--cooldown-ms',
      '13',
      '--shutdown-timeout-ms',
      '1500',
      '--skip-build',
      '--server-command',
      'node',
      '--server-arg',
      'fixture-server.js',
      '--server-cpu-affinity',
      'server:0-1',
      '--load-cpu-affinity',
      'load:2-3',
    ],
    {},
  );

  assert.equal(
    parsed.appDir,
    path.resolve(__dirname, '../../../tests/integration/superapp-portfolio'),
  );
  assert.equal(parsed.appPort, 4567);
  assert.equal(parsed.healthPath, '/health');
  assert.equal(parsed.startupTimeoutMs, 5000);
  assert.equal(parsed.healthTimeoutMs, 750);
  assert.equal(parsed.warmupMs, 11);
  assert.equal(parsed.cooldownMs, 13);
  assert.equal(parsed.shutdownTimeoutMs, 1500);
  assert.equal(parsed.skipBuild, true);
  assert.equal(parsed.serverCommand, 'node');
  assert.deepEqual(parsed.serverArgs, ['fixture-server.js']);
  assert.equal(parsed.serverCpuAffinity, 'server:0-1');
  assert.equal(parsed.loadCpuAffinity, 'load:2-3');
});

test('resolveExecutableValue expands home-relative paths', () => {
  assert.equal(
    resolveExecutableValue('~/bin/k6'),
    path.join(os.homedir(), 'bin/k6'),
  );
});

test('missing-k6 scenario command writes a skipped diagnostic artifact', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superapp-k6-'));
  const missingK6 = path.join(tempDir, 'missing-k6');

  try {
    const result = spawnSync(
      process.execPath,
      [
        RUNNER_PATH,
        '--scenario',
        'smoke',
        '--k6-bin',
        missingK6,
        '--output-dir',
        tempDir,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          K6_BIN: '',
          SUPERAPP_K6_BIN: '',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const stdout = JSON.parse(result.stdout);
    assert.equal(stdout.status, 'skipped');
    assert.equal(stdout.scenario, 'smoke');
    assert.deepEqual(stdout.scenarioIds, ['smoke']);

    const summary = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'summary.json'), 'utf8'),
    );
    assert.equal(summary.detail.runner.status, 'skipped');
    assert.equal(summary.parameters.scenario, 'smoke');
    assert.deepEqual(summary.parameters.scenarioIds, ['smoke']);
    assert.equal(summary.parameters.thresholdProfile, 'smoke');
    assert.match(summary.parameters.scriptPath, /superapp-scenarios\.js$/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('missing-autocannon probe command writes a skipped diagnostic artifact', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superapp-ac-'));
  const missingAutocannon = path.join(tempDir, 'missing-autocannon');

  try {
    const result = spawnSync(
      process.execPath,
      [
        RUNNER_PATH,
        '--autocannon-probes',
        'get-bootstrap',
        '--autocannon-bin',
        missingAutocannon,
        '--output-dir',
        tempDir,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          AUTOCANNON_BIN: '',
          SUPERAPP_AUTOCANNON_BIN: '',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const stdout = JSON.parse(result.stdout);
    assert.equal(stdout.status, 'skipped');
    assert.equal(stdout.loadGenerator, 'autocannon');
    assert.deepEqual(stdout.autocannonProbeIds, ['get-bootstrap']);
    assert.equal(stdout.diagnostic.code, 'AUTOCANNON_NOT_AVAILABLE');

    const summary = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'summary.json'), 'utf8'),
    );
    assert.equal(summary.detail.runner.status, 'skipped');
    assert.equal(
      summary.detail.runner.diagnostic.code,
      'AUTOCANNON_NOT_AVAILABLE',
    );
    assert.deepEqual(summary.parameters.autocannonProbeIds, ['get-bootstrap']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('autocannon probe command records multi-worker classification metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superapp-ac-'));
  const fakeAutocannon = writeFakeAutocannon(tempDir);

  try {
    const result = spawnSync(
      process.execPath,
      [
        RUNNER_PATH,
        '--autocannon-probes',
        'get-bootstrap,post-workflow',
        '--autocannon-bin',
        fakeAutocannon,
        '--base-url',
        'http://superapp.example.test/',
        '--autocannon-workers',
        '3',
        '--output-dir',
        tempDir,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          AUTOCANNON_BIN: '',
          SUPERAPP_AUTOCANNON_BIN: '',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const stdout = JSON.parse(result.stdout);
    assert.equal(stdout.status, 'passed');
    assert.equal(stdout.loadGenerator, 'autocannon');
    assert.deepEqual(stdout.autocannonProbeIds, [
      'get-bootstrap',
      'post-workflow',
    ]);
    assert.equal(stdout.autocannon.command, fakeAutocannon);

    const summary = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'summary.json'), 'utf8'),
    );
    assert.equal(summary.detail.runner.status, 'passed');
    assert.equal(summary.detail.runner.autocannon.command, fakeAutocannon);
    assert.equal(summary.detail.runner.loadGenerator.probes.length, 2);

    const artifact = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'autocannon-probes.json'), 'utf8'),
    );
    const bootstrap = artifact.probes.find(
      probe => probe.id === 'get-bootstrap',
    );
    const workflow = artifact.probes.find(
      probe => probe.id === 'post-workflow',
    );

    assert.equal(bootstrap.autocannon.workers, 3);
    assert.equal(bootstrap.endpoint.method, 'GET');
    assert.equal(bootstrap.classification.category, 'none');
    assert.equal(workflow.endpoint.method, 'POST');
    assert.equal(workflow.classification.category, 'mixed');
    assert.equal(workflow.classification.serverFailureCount, 1);
    assert.equal(workflow.classification.clientSocketFailureCount, 3);
    assert.equal(artifact.aggregateClassification.category, 'mixed');
    assert.ok(
      workflow.process.args.includes('--workers'),
      'autocannon worker flag should be present',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('orchestrated scenario launches server, runs fake k6, and captures artifacts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superapp-k6-orch-'));
  const appDir = path.join(tempDir, 'app');
  const outputDir = path.join(tempDir, 'artifacts');
  const serverMarker = path.join(tempDir, 'server-started.json');
  const k6EnvPath = path.join(tempDir, 'k6-env.json');
  fs.mkdirSync(appDir);
  const serverPath = writeFixtureServer(appDir);
  const fakeK6 = writeFakeK6(tempDir);

  try {
    const result = spawnSync(
      process.execPath,
      [
        RUNNER_PATH,
        '--scenario',
        'smoke',
        '--k6-bin',
        fakeK6,
        '--app-dir',
        appDir,
        '--skip-build',
        '--server-command',
        process.execPath,
        '--server-arg',
        serverPath,
        '--health-path',
        '/health',
        '--startup-timeout-ms',
        '5000',
        '--warmup-ms',
        '5',
        '--cooldown-ms',
        '5',
        '--shutdown-timeout-ms',
        '2000',
        '--server-cpu-affinity',
        'server:0',
        '--load-cpu-affinity',
        'load:1',
        '--output-dir',
        outputDir,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          K6_BIN: '',
          SUPERAPP_K6_BIN: '',
          SUPERAPP_K6_TEST_SERVER_MARKER: serverMarker,
          SUPERAPP_K6_TEST_K6_ENV: k6EnvPath,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const stdout = JSON.parse(result.stdout);
    assert.equal(stdout.status, 'passed');
    assert.equal(stdout.artifactStatus, 'passed');
    assert.equal(stdout.orchestration.server.readiness.ok, true);

    const summary = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'summary.json'), 'utf8'),
    );
    const k6Env = JSON.parse(fs.readFileSync(k6EnvPath, 'utf8'));
    assert.equal(summary.detail.runner.status, 'passed');
    assert.equal(summary.detail.runner.loadGenerator.command, fakeK6);
    assert.equal(summary.detail.orchestration.server.readiness.ok, true);
    assert.equal(summary.detail.orchestration.server.stop.stopped, true);
    assert.equal(summary.detail.orchestration.warmup.requestedMs, 5);
    assert.equal(summary.detail.orchestration.cooldown.requestedMs, 5);
    assert.equal(summary.detail.orchestration.cpuAffinity.server, 'server:0');
    assert.equal(summary.detail.orchestration.cpuAffinity.load, 'load:1');
    assert.match(k6Env.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(summary.parameters.baseUrl, k6Env.baseUrl);
    assert.equal(k6Env.scenario, 'smoke');
    assert.equal(k6Env.thresholdProfile, 'smoke');
    assert.ok(fs.existsSync(path.join(outputDir, 'app-server-stdout.log')));
    assert.ok(fs.existsSync(path.join(outputDir, 'app-server-stderr.log')));
    assert.ok(fs.existsSync(path.join(outputDir, 'k6-stdout.log')));
    assert.ok(fs.existsSync(path.join(outputDir, 'k6-stderr.log')));
    assert.ok(fs.existsSync(path.join(outputDir, 'k6-summary.json')));
    assert.ok(fs.existsSync(path.join(outputDir, 'orchestration.json')));
    assert.ok(fs.existsSync(serverMarker));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('orchestrated missing-k6 fallback writes diagnostics without launching server', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superapp-k6-orch-'));
  const appDir = path.join(tempDir, 'app');
  const outputDir = path.join(tempDir, 'artifacts');
  const serverMarker = path.join(tempDir, 'server-started.json');
  fs.mkdirSync(appDir);
  const serverPath = writeFixtureServer(appDir);
  const missingK6 = path.join(tempDir, 'missing-k6');

  try {
    const result = spawnSync(
      process.execPath,
      [
        RUNNER_PATH,
        '--scenario',
        'smoke',
        '--k6-bin',
        missingK6,
        '--app-dir',
        appDir,
        '--skip-build',
        '--server-command',
        process.execPath,
        '--server-arg',
        serverPath,
        '--output-dir',
        outputDir,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          K6_BIN: '',
          SUPERAPP_K6_BIN: '',
          SUPERAPP_K6_TEST_SERVER_MARKER: serverMarker,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const stdout = JSON.parse(result.stdout);
    assert.equal(stdout.status, 'skipped');
    assert.equal(stdout.artifactStatus, 'unknown');
    assert.equal(stdout.diagnostic.code, 'K6_NOT_AVAILABLE');

    const summary = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'summary.json'), 'utf8'),
    );
    assert.equal(summary.detail.runner.status, 'skipped');
    assert.match(
      summary.detail.orchestration.skippedReason,
      /k6 is unavailable/,
    );
    assert.equal(summary.detail.orchestration.server, undefined);
    assert.equal(fs.existsSync(serverMarker), false);
    assert.ok(fs.existsSync(path.join(outputDir, 'orchestration.json')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function writeFixtureServer(appDir) {
  const serverPath = path.join(appDir, 'fixture-server.js');
  fs.writeFileSync(
    serverPath,
    `
const fs = require('node:fs');
const http = require('node:http');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT);
const marker = process.env.SUPERAPP_K6_TEST_SERVER_MARKER;
const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(204);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('fixture');
});

server.listen(port, host, () => {
  console.log(\`fixture ready \${host}:\${port}\`);
  if (marker) {
    fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, port }));
  }
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
`,
  );
  return serverPath;
}

function writeFakeK6(tempDir) {
  const fakeK6 = path.join(tempDir, 'fake-k6');
  fs.writeFileSync(
    fakeK6,
    `#!/usr/bin/env node
const fs = require('node:fs');

const args = process.argv.slice(2);
if (args[0] === 'version') {
  console.log('k6 v0.0.0-test');
  process.exit(0);
}

if (args[0] === 'run') {
  const summaryIndex = args.indexOf('--summary-export');
  if (summaryIndex !== -1) {
    fs.writeFileSync(
      args[summaryIndex + 1],
      JSON.stringify({
        fake: true,
        baseUrl: process.env.SUPERAPP_K6_BASE_URL,
      }),
    );
  }
  if (process.env.SUPERAPP_K6_TEST_K6_ENV) {
    fs.writeFileSync(
      process.env.SUPERAPP_K6_TEST_K6_ENV,
      JSON.stringify({
        baseUrl: process.env.SUPERAPP_K6_BASE_URL,
        scenario: process.env.SUPERAPP_K6_SCENARIO,
        thresholdProfile: process.env.SUPERAPP_K6_THRESHOLD_PROFILE,
      }),
    );
  }
  console.log(\`fake k6 run \${process.env.SUPERAPP_K6_BASE_URL}\`);
  process.exit(0);
}

console.error(\`unexpected fake k6 args: \${args.join(' ')}\`);
process.exit(2);
`,
  );
  fs.chmodSync(fakeK6, 0o755);
  return fakeK6;
}

function writeFakeAutocannon(tempDir) {
  const fakeAutocannon = path.join(tempDir, 'fake-autocannon');
  fs.writeFileSync(
    fakeAutocannon,
    `#!/usr/bin/env node
const args = process.argv.slice(2);

if (args.includes('--version')) {
  console.log('autocannon v0.0.0-test');
  process.exit(0);
}

const method = args[args.indexOf('--method') + 1];
const url = args[args.length - 1];
const isWorkflow = url.includes('/workflow');
const report = {
  duration: 1,
  errors: isWorkflow ? 2 : 0,
  non2xx: isWorkflow ? 1 : 0,
  timeouts: isWorkflow ? 1 : 0,
  requests: {
    average: isWorkflow ? 99 : 120,
    total: isWorkflow ? 98 : 120,
  },
  latency: {
    average: isWorkflow ? 23 : 7,
    p95: isWorkflow ? 51 : 12,
    p99: isWorkflow ? 75 : 18,
  },
  throughput: {
    average: isWorkflow ? 2048 : 4096,
    total: isWorkflow ? 2048 : 4096,
  },
  statusCodeStats: isWorkflow
    ? { '200': { count: 97 }, '503': { count: 1 } }
    : { '200': { count: 120 } },
  method,
  url,
};
console.log(JSON.stringify(report));
process.exit(0);
`,
  );
  fs.chmodSync(fakeAutocannon, 0o755);
  return fakeAutocannon;
}

test('resolveK6Binary reports missing explicit binary without throwing', () => {
  const resolution = resolveK6Binary(
    {
      k6Bin: '/definitely/missing/k6',
    },
    () => ({
      error: new Error('spawn ENOENT'),
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
    }),
  );

  assert.equal(resolution.found, false);
  assert.equal(resolution.attempts.length, 1);
  assert.equal(resolution.attempts[0].source, 'explicit');
  assert.match(resolution.attempts[0].error, /ENOENT/);
});

test('missing-k6 smoke command writes a skipped diagnostic artifact', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superapp-k6-'));
  const missingK6 = path.join(tempDir, 'missing-k6');

  try {
    const result = spawnSync(
      process.execPath,
      [RUNNER_PATH, '--check', '--k6-bin', missingK6, '--output-dir', tempDir],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          K6_BIN: '',
          SUPERAPP_K6_BIN: '',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const stdout = JSON.parse(result.stdout);
    assert.equal(stdout.status, 'skipped');
    assert.equal(stdout.artifactStatus, 'unknown');
    assert.match(stdout.diagnostic.message, /Configured k6 binary/);

    const summary = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'summary.json'), 'utf8'),
    );
    assert.equal(summary.status, 'unknown');
    assert.equal(summary.detail.runner.status, 'skipped');
    assert.equal(summary.detail.runner.diagnostic.code, 'K6_NOT_AVAILABLE');
    assert.equal(summary.detail.runner.attempts[0].command, missingK6);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
