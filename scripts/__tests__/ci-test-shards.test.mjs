import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import yaml from '../../packages/toolkit/utils/compiled/js-yaml/index.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const workflow = yaml.load(
  readFileSync(
    path.join(repoRoot, '.github/workflows/integration-test.yml'),
    'utf8',
  ),
);
const integration = workflow.jobs.integration;
const matrix = integration.strategy.matrix;

// Apply GitHub's include semantics to the original Cartesian combinations.
function scheduledJobs() {
  const axes = Object.entries(matrix).filter(
    ([key]) => key !== 'include' && key !== 'exclude',
  );
  const original =
    axes.length === 0
      ? []
      : axes.reduce(
          (jobs, [key, values]) =>
            jobs.flatMap(job =>
              values.map(value => ({ ...job, [key]: value })),
            ),
          [{}],
        );
  const jobs = original.map(job => ({ ...job }));
  for (const entry of matrix.include ?? []) {
    let matched = false;
    for (let index = 0; index < original.length; index += 1) {
      if (
        Object.entries(entry).every(
          ([key, value]) =>
            !(key in original[index]) || original[index][key] === value,
        )
      ) {
        Object.assign(jobs[index], entry);
        matched = true;
      }
    }
    if (!matched) jobs.push({ ...entry });
  }
  return jobs.filter(
    job =>
      !(matrix.exclude ?? []).some(entry =>
        Object.entries(entry).every(([key, value]) => job[key] === value),
      ),
  );
}

test('integration schedules six core shards and isolated generators on both platforms', () => {
  const jobs = scheduledJobs();
  for (const platform of ['Linux', 'Windows']) {
    const framework = jobs.filter(
      job => job.platform === platform && job.suite === 'framework',
    );
    assert.deepEqual(framework.map(job => job.shard).sort(), [
      '1/6',
      '2/6',
      '3/6',
      '4/6',
      '5/6',
      '6/6',
    ]);
    assert.ok(framework.every(job => job.runner));
    assert.ok(framework.every(job => job.framework_suite === 'core'));
    const generators = jobs.filter(
      job =>
        job.platform === platform &&
        job.suite.startsWith('framework-generator-'),
    );
    assert.deepEqual(
      generators.map(job => `${job.suite}:${job.framework_suite}`).sort(),
      [
        'framework-generator-bff:generator-bff',
        'framework-generator-workspace:generator-workspace',
      ],
    );
    assert.ok(generators.every(job => job.runner && job.shard === undefined));
  }
  assert.equal(jobs.length, 19);
  assert.equal(integration.strategy['fail-fast'], false);
  assert.equal(integration.strategy['max-parallel'], undefined);
});

test('adapter and package utility coverage still runs once per supported platform', () => {
  assert.deepEqual(
    scheduledJobs()
      .filter(job => !job.suite.startsWith('framework'))
      .map(job => `${job.platform}:${job.suite}`)
      .sort(),
    ['Linux:rstest-adapter', 'Linux:utils', 'Windows:rstest-adapter'],
  );
});

test('existing required framework checks reject failure, cancellation, and skips', () => {
  const gate = workflow.jobs['required-framework'];
  assert.equal(gate.needs, 'integration');
  assert.equal(gate.if, 'always()');
  assert.equal(gate.strategy['fail-fast'], false);
  assert.deepEqual(gate.strategy.matrix.platform, ['Linux', 'Windows']);
  assert.deepEqual(gate.strategy.matrix.required_shard, [1, 2, 3]);
  assert.equal(
    gate.name,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expands these expressions.
    'integration-${{ matrix.platform }} (framework ${{ matrix.required_shard }}/3)',
  );
  assert.equal(gate.steps.length, 1);
  assert.equal(
    gate.steps[0].env.INTEGRATION_RESULT,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expands this expression.
    '${{ needs.integration.result }}',
  );
  assert.equal(gate.steps[0].run, 'test "$INTEGRATION_RESULT" = success');
  assert.equal(gate.steps[0]['continue-on-error'], undefined);
});

const run = promisify(execFile);
const rstestPackage = createRequire(import.meta.url).resolve(
  '@rstest/core/package.json',
);
const rstestBin = path.join(
  path.dirname(rstestPackage),
  JSON.parse(readFileSync(rstestPackage, 'utf8')).bin.rstest,
);

async function listFiles(shard, suite) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'modernjs-shard-list-'));
  const output = path.join(directory, 'files.json');
  const args = [rstestBin, 'list', '--filesOnly', '--json', output];
  if (shard) args.push('--shard', shard);
  const env = { ...process.env };
  // Default discovery must remain the complete suite even if this regression
  // runs inside a matrix job that selected a framework subset.
  delete env.MODERN_TEST_FRAMEWORK_SUITE;
  if (suite !== undefined) env.MODERN_TEST_FRAMEWORK_SUITE = suite;
  try {
    await run(process.execPath, args, {
      cwd: path.join(repoRoot, 'tests'),
      env,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    // Sharding prints a banner even in JSON mode. The file contains only JSON.
    return JSON.parse(readFileSync(output, 'utf8'))
      .map(entry => entry.file)
      .sort();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('native core shards and generator runners run every discovered file exactly once', async () => {
  const coreShards = [
    ...new Set(
      scheduledJobs()
        .filter(job => job.suite === 'framework')
        .map(job => job.shard),
    ),
  ];
  const [all, core, workspace, bff, ...shards] = await Promise.all([
    listFiles(),
    listFiles(undefined, 'core'),
    listFiles(undefined, 'generator-workspace'),
    listFiles(undefined, 'generator-bff'),
    ...coreShards.map(shard => listFiles(shard, 'core')),
  ]);
  assert.ok(all.length >= coreShards.length, 'Every CI shard must have tests.');
  assert.ok(shards.every(files => files.length > 0));
  assert.deepEqual(
    workspace.map(file => file.replaceAll('\\', '/').split('/integration/')[1]),
    ['create-ultramodern-workspace/tests/index.test.ts'],
  );
  assert.deepEqual(
    bff.map(file => file.replaceAll('\\', '/').split('/integration/')[1]),
    ['create-bff-runtime/tests/index.test.ts'],
  );
  assert.equal(core.length, all.length - workspace.length - bff.length);
  assert.deepEqual(shards.flat().sort(), core, 'Core shards must cover core.');
  const combined = [...shards.flat(), ...workspace, ...bff];
  assert.equal(new Set(combined).size, combined.length, 'Shards overlap.');
  assert.deepEqual(
    combined.sort(),
    all,
    'The shard union must equal live discovery.',
  );
  // Discovery comes from Rstest, so new matching files enter the union without
  // updating a checked-in test manifest.
});

test('native shard discovery is deterministic and rejects invalid shard inputs', async () => {
  assert.deepEqual(
    await listFiles('1/6', 'core'),
    await listFiles('1/6', 'core'),
  );
  for (const shard of ['0/6', '7/6', '1/0', 'invalid']) {
    await assert.rejects(listFiles(shard, 'core'), undefined, shard);
  }
});

test('framework suite defaults to full and rejects unknown selectors', async () => {
  assert.deepEqual(await listFiles(), await listFiles(undefined, 'full'));
  for (const suite of ['', 'unknown', 'generator', 'Core']) {
    await assert.rejects(listFiles(undefined, suite), undefined, suite);
  }
});

test('all framework matrix jobs keep prepared commands, browsers, and timing reports', () => {
  const browserIndex = integration.steps.findIndex(
    step => step.name === 'Install Playwright browsers',
  );
  assert.ok(browserIndex >= 0);
  for (const suite of [
    'framework',
    'framework-generator-workspace',
    'framework-generator-bff',
  ]) {
    const stepIndex = integration.steps.findIndex(
      step => step.if === `matrix.suite == '${suite}'`,
    );
    assert.ok(stepIndex > browserIndex, `${suite} needs browser provisioning`);
    const step = integration.steps[stepIndex];
    assert.match(step.run, /test:framework:prepared/u);
    assert.match(step.run, /--reporters default --reporters blob/u);
    if (suite === 'framework') assert.match(step.run, /--shard/u);
    else assert.doesNotMatch(step.run, /--shard/u);
  }
  const timing = integration.steps.find(
    step => step.name === 'Upload framework test timings',
  );
  assert.match(timing.if, /always\(\)/u);
  assert.match(timing.if, /matrix\.suite == 'framework'/u);
  assert.match(timing.if, /matrix\.suite == 'framework-generator-workspace'/u);
  assert.match(timing.if, /matrix\.suite == 'framework-generator-bff'/u);
  assert.equal(timing.with.path, 'tests/.rstest-reports/');
});
