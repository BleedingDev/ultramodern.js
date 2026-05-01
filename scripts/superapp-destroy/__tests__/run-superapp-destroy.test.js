const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createDestroyPlan,
  DESTROY_PROFILES,
  parseArgs,
  REQUIRED_THRESHOLD_KEYS,
  runDestroyPlan,
  writeObservedDestroySummary,
} = require('../run-superapp-destroy');

const repoRoot = path.resolve(__dirname, '../../..');
const runnerPath = path.resolve(__dirname, '../run-superapp-destroy.js');
const fixedNow = new Date('2026-01-02T03:04:05.000Z');

function planOptions(extraArgs = []) {
  return parseArgs(
    [
      '--dry-run',
      '--run-id',
      'destroy-test',
      '--output-dir',
      '.modern/superapp-destroy/destroy-test',
      ...extraArgs,
    ],
    {},
    fixedNow,
  );
}

test('release, nightly, and manual-torture profiles define every threshold budget', () => {
  for (const profileId of ['release', 'nightly', 'manual-torture']) {
    const profile = DESTROY_PROFILES[profileId];

    assert.ok(profile, `${profileId} profile exists`);
    assert.deepEqual(
      Object.keys(profile.thresholds).sort(),
      [...REQUIRED_THRESHOLD_KEYS].sort(),
    );
  }
});

test('manual-torture profile is explicitly manual and expensive', () => {
  const profile = DESTROY_PROFILES['manual-torture'];

  assert.equal(profile.usage, 'manual');
  assert.equal(profile.cost, 'expensive');
  assert.equal(profile.defaultPrBlocker, false);
});

test('invalid destroy profile fails during option parsing', () => {
  assert.throws(
    () => planOptions(['--profile', 'surprise-prod-load']),
    /Invalid --profile "surprise-prod-load"/,
  );
});

test('dry-run plan includes selected profile threshold budget', () => {
  const plan = createDestroyPlan(planOptions(['--profile', 'release']));
  const commands = plan.phases.flatMap(phase => phase.commands);

  assert.equal(plan.profile, 'release');
  assert.equal(plan.profileDefinition.usage, 'release');
  assert.deepEqual(plan.thresholdBudget, DESTROY_PROFILES.release.thresholds);
  assert.deepEqual(plan.executionModel.selectedProfile, {
    id: 'release',
    usage: 'release',
    cost: 'moderate',
    defaultPrBlocker: false,
  });
  for (const command of commands) {
    assert.deepEqual(
      command.metadata.thresholdBudget,
      DESTROY_PROFILES.release.thresholds,
    );
  }
});

test('destroy plan lists the required phase order with teardown last', () => {
  const plan = createDestroyPlan(planOptions());

  assert.deepEqual(plan.phaseOrder, [
    'build',
    'serve',
    'warmup',
    'load',
    'browser-smoke-during-load',
    'chaos',
    'contracts',
    'runtime-matrix',
    'soak-stability-evidence',
    'teardown',
  ]);
  assert.equal(plan.phases.at(-1).alwaysRun, true);
  assert.equal(plan.phases.at(-1).scheduledAfterFailure, true);
  assert.match(plan.executionModel.teardownPolicy, /always scheduled/);
});

test('destroy plan reuses existing superapp command paths and artifact roots', () => {
  const plan = createDestroyPlan(planOptions());
  const commands = plan.phases.flatMap(phase => phase.commands);
  const commandText = commands.map(command => command.command).join('\n');

  assert.match(commandText, /scripts\/superapp-load\/run-superapp-load\.js/);
  assert.match(commandText, /scripts\/superapp-soak\/run-superapp-soak\.js/);
  assert.match(commandText, /scripts\/superapp-soak\/stability-report\.js/);
  assert.match(
    commandText,
    /scripts\/superapp-certification\/validate-harness-contract\.js/,
  );
  assert.match(
    commandText,
    /integration\/superapp-portfolio\/tests\/browser-runtime\.test\.ts/,
  );
  assert.match(
    commandText,
    /integration\/superapp-portfolio\/tests\/browser-runtime-matrix\.test\.ts/,
  );
  assert.ok(
    commands.every(command =>
      command.artifactDir?.includes(
        path.join('.modern', 'superapp-destroy', 'destroy-test', 'artifacts'),
      ),
    ),
  );
});

test('destroy plan reuses the lifecycle server for pilot chaos and uses k6-free load fallbacks', () => {
  const plan = createDestroyPlan(
    planOptions(['--port', '9123', '--warmup-ms', '0']),
  );
  const commands = plan.phases.flatMap(phase => phase.commands);
  const warmup = commands.find(command => command.id === 'warmup-superapp');
  const pilotChaos = commands.find(
    command => command.id === 'superapp-pilot-chaos',
  );
  const chaosLoad = commands.find(
    command => command.id === 'superapp-chaos-triggering-load',
  );

  assert.ok(warmup);
  assert.match(warmup.command, /scripts\/superapp-load\/run-superapp-load\.js/);
  assert.match(warmup.command, /--target portfolio/);
  assert.match(warmup.command, /--scenario bootstrap/);
  assert.match(warmup.command, /--duration-ms 1/);
  assert.doesNotMatch(warmup.command, /scripts\/superapp-k6\/run-superapp-k6/);

  assert.ok(pilotChaos);
  assert.equal(
    pilotChaos.env.SUPERAPP_PILOT_CHAOS_BASE_URL,
    'http://127.0.0.1:9123',
  );

  assert.ok(chaosLoad);
  assert.match(
    chaosLoad.command,
    /scripts\/superapp-load\/run-superapp-load\.js/,
  );
  assert.match(chaosLoad.command, /--scenario chaos/);
  assert.doesNotMatch(
    chaosLoad.command,
    /scripts\/superapp-k6\/run-superapp-k6/,
  );
  assert.match(chaosLoad.artifactDir, /chaos-triggering-load$/);
});

test('destroy plan runs bounded soak evidence instead of a summary-less dry run', () => {
  const plan = createDestroyPlan(planOptions());
  const soak = plan.phases
    .flatMap(phase => phase.commands)
    .find(command => command.id === 'superapp-soak-plan');
  const stability = plan.phases
    .flatMap(phase => phase.commands)
    .find(command => command.id === 'superapp-soak-stability-report');

  assert.ok(soak);
  assert.match(soak.command, /scripts\/superapp-soak\/run-superapp-soak\.js/);
  assert.doesNotMatch(soak.command, /--dry-run/);
  assert.match(soak.command, /--duration-seconds 3/);
  assert.match(soak.command, /--warmup-seconds 0/);
  assert.match(soak.command, /--cooldown-seconds 0/);
  assert.match(soak.command, /--max-operations 18/);
  assert.match(soak.command, /--window-ms 1000/);

  assert.ok(stability);
  assert.match(stability.command, /--summary .+\/soak\/summary\.json/);
  assert.match(stability.command, /--json .+\/soak-stability\.json/);
});

test('CLI dry-run emits a machine-readable plan and writes destroy-plan artifact', () => {
  const output = execFileSync(
    process.execPath,
    [
      runnerPath,
      '--dry-run',
      '--run-id',
      'cli-plan',
      '--output-dir',
      '.modern/superapp-destroy/cli-plan',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  const parsed = JSON.parse(output);

  assert.equal(parsed.schemaVersion, 'superapp-destroy-plan-v1');
  assert.equal(parsed.mode, 'plan');
  assert.equal(parsed.runId, 'cli-plan');
  assert.match(parsed.planPath, /destroy-plan\.json$/);
  assert.deepEqual(parsed.phaseOrder.slice(0, 4), [
    'build',
    'serve',
    'warmup',
    'load',
  ]);
});

test('runner schedules teardown after a failed phase and skips later non-teardown phases', async () => {
  const plan = createDestroyPlan(planOptions());
  const attempted = [];
  const execution = await runDestroyPlan(plan, {
    executeCommand(command, phase) {
      attempted.push(`${phase.id}:${command.id}`);
      if (phase.id === 'load') {
        return {
          status: 'failed',
          exitCode: 7,
          error: 'simulated load failure',
        };
      }
      return {
        status: 'passed',
        exitCode: 0,
      };
    },
  });

  assert.equal(execution.status, 'failed');
  assert.equal(execution.teardownScheduled, true);
  assert.ok(attempted.includes('load:superapp-portfolio-load'));
  assert.ok(attempted.includes('teardown:teardown-superapp-server'));
  assert.equal(
    execution.results.find(result => result.phaseId === 'contracts').status,
    'skipped',
  );
  assert.equal(
    execution.results.find(result => result.phaseId === 'teardown').status,
    'teardown-after-failure',
  );
});

test('runner executes tracked lifecycle server and captures command logs', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'destroy-lifecycle-'));
  const port = await reserveTestPort();
  const serverPath = path.join(tempDir, 'fixture-server.js');
  fs.writeFileSync(
    serverPath,
    `
const http = require('node:http');
const host = '127.0.0.1';
const port = Number(process.env.PORT);
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('ok');
});
server.listen(port, host, () => {
  console.log('fixture ready');
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
`,
  );
  const artifactRoot = path.join(tempDir, 'artifacts');
  const baseUrl = `http://127.0.0.1:${port}`;
  const plan = {
    artifactRoot,
    baseUrl,
    healthPath: '/',
    outputDir: tempDir,
    phaseOrder: ['serve', 'warmup', 'teardown'],
    phases: [
      {
        id: 'serve',
        kind: 'lifecycle',
        lifecycle: 'start-server',
        commands: [
          {
            id: 'serve-superapp-portfolio',
            artifactDir: path.join(artifactRoot, 'serve'),
            command: `${JSON.stringify(process.execPath)} ${JSON.stringify(
              serverPath,
            )}`,
            cwd: tempDir,
            env: {
              PORT: String(port),
            },
            metadata: {
              healthUrl: baseUrl,
            },
          },
        ],
      },
      {
        id: 'warmup',
        kind: 'command',
        commands: [
          {
            id: 'fixture-warmup',
            artifactDir: path.join(artifactRoot, 'warmup'),
            command: `${JSON.stringify(process.execPath)} -e "console.log('warmup ok')"`,
            cwd: tempDir,
            env: {},
          },
        ],
      },
      {
        id: 'teardown',
        kind: 'lifecycle',
        lifecycle: 'stop-server',
        alwaysRun: true,
        commands: [
          {
            id: 'teardown-superapp-server',
            artifactDir: path.join(artifactRoot, 'teardown'),
            command: 'stop tracked fixture server',
            cwd: tempDir,
            env: {},
          },
        ],
      },
    ],
    runId: 'lifecycle-test',
  };

  const execution = await runDestroyPlan(plan);

  assert.equal(execution.status, 'passed');
  assert.equal(execution.teardownScheduled, true);
  assert.ok(
    fs.existsSync(path.join(artifactRoot, 'serve', 'server-lifecycle.json')),
  );
  assert.ok(
    fs.existsSync(path.join(artifactRoot, 'teardown', 'server-teardown.json')),
  );
  assert.match(
    fs.readFileSync(
      path.join(artifactRoot, 'warmup', 'fixture-warmup.stdout.log'),
      'utf8',
    ),
    /warmup ok/,
  );
});

test('runner starts adjacent concurrency-group phases together', async () => {
  const plan = createDestroyPlan(planOptions(['--no-soak']));
  const events = [];
  const execution = await runDestroyPlan(plan, {
    async executeCommand(command, phase) {
      if (phase.concurrencyGroup === 'load-and-browser-smoke') {
        events.push(`start:${phase.id}`);
        await new Promise(resolve => setTimeout(resolve, 20));
        events.push(`finish:${phase.id}`);
      }
      return {
        status: 'passed',
        exitCode: 0,
      };
    },
  });

  assert.equal(execution.status, 'passed');
  assert.deepEqual(events.slice(0, 2).sort(), [
    'start:browser-smoke-during-load',
    'start:load',
  ]);
});

test('observed destroy summary preserves unknown artifact status', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'destroy-observed-'));
  const artifactRoot = path.join(tempDir, 'artifacts');
  fs.mkdirSync(path.join(artifactRoot, 'warmup'), { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, 'portfolio-load'), { recursive: true });
  fs.writeFileSync(
    path.join(artifactRoot, 'warmup', 'summary.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        status: 'unknown',
        suite: 'superapp-k6-load',
        unknowns: ['k6 binary unavailable'],
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(artifactRoot, 'portfolio-load', 'summary.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        status: 'passed',
        suite: 'superapp-portfolio-load',
      },
      null,
      2,
    )}\n`,
  );

  const observed = writeObservedDestroySummary(
    {
      artifactRoot,
      outputDir: tempDir,
      phaseOrder: ['warmup', 'load'],
      profile: 'smoke',
      runId: 'observed-test',
      thresholdBudget: DESTROY_PROFILES.smoke.thresholds,
    },
    {
      results: [],
      status: 'passed',
    },
    {
      executionPath: path.join(tempDir, 'destroy-execution.json'),
      planPath: path.join(tempDir, 'destroy-plan.json'),
    },
  );

  assert.equal(observed.observedLimits.lanes.load.status, 'unknown');
  assert.match(
    observed.observedLimits.lanes.load.unknowns.join('\n'),
    /k6 binary unavailable/,
  );
});

test('plan status scope only changes ust-destroy-01 when marked externally', () => {
  const plan = createDestroyPlan(planOptions(['--no-soak']));
  const ids = plan.phaseOrder;

  assert.equal(plan.schemaVersion, 'superapp-destroy-plan-v1');
  assert.equal(ids.includes('soak-stability-evidence'), false);
  assert.equal(ids.at(-1), 'teardown');
});

function reserveTestPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}
