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
  const original = axes.reduce(
    (jobs, [key, values]) =>
      jobs.flatMap(job => values.map(value => ({ ...job, [key]: value }))),
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

test('integration schedules six complete shards on both supported platforms', () => {
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
  }
  assert.equal(jobs.length, 15);
  assert.equal(integration.strategy['fail-fast'], false);
  assert.equal(integration.strategy['max-parallel'], undefined);
});

test('adapter and package utility coverage still runs once per supported platform', () => {
  assert.deepEqual(
    scheduledJobs()
      .filter(job => job.suite !== 'framework')
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

async function listFiles(shard) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'modernjs-shard-list-'));
  const output = path.join(directory, 'files.json');
  const args = [rstestBin, 'list', '--filesOnly', '--json', output];
  if (shard) args.push('--shard', shard);
  try {
    await run(process.execPath, args, {
      cwd: path.join(repoRoot, 'tests'),
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

test('native framework shards run every discovered file exactly once', async () => {
  const [all, ...shards] = await Promise.all([
    listFiles(),
    ...matrix.shard.map(shard => listFiles(shard)),
  ]);
  assert.ok(
    all.length >= matrix.shard.length,
    'Every CI shard must have tests.',
  );
  assert.ok(shards.every(files => files.length > 0));
  const combined = shards.flat();
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
  assert.deepEqual(await listFiles('1/6'), await listFiles('1/6'));
  for (const shard of ['0/6', '7/6', '1/0', 'invalid']) {
    await assert.rejects(listFiles(shard), undefined, shard);
  }
});
