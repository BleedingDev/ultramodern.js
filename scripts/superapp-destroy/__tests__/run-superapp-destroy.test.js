const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const {
  createDestroyPlan,
  DESTROY_PROFILES,
  parseArgs,
  REQUIRED_THRESHOLD_KEYS,
  runDestroyPlan,
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
  assert.match(commandText, /scripts\/superapp-k6\/run-superapp-k6\.js/);
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

test('plan status scope only changes ust-destroy-01 when marked externally', () => {
  const plan = createDestroyPlan(planOptions(['--no-soak']));
  const ids = plan.phaseOrder;

  assert.equal(plan.schemaVersion, 'superapp-destroy-plan-v1');
  assert.equal(ids.includes('soak-stability-evidence'), false);
  assert.equal(ids.at(-1), 'teardown');
});
