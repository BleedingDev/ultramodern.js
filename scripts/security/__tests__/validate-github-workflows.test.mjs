import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yaml from '../../../packages/toolkit/utils/compiled/js-yaml/index.js';
import { evaluateJobSchedule } from '../github-job-condition.mjs';
import { listTrackedFiles } from '../static-import-closure.mjs';
import {
  repoRoot,
  validateRepository,
  validateTractorBaselinePin,
  validateWorkflowContent,
} from '../validate-github-workflows.mjs';

const compliantWorkflow = `name: Example
on:
  push:
permissions:
  contents: read
jobs:
  example:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@9f698171ed81b15d1823a05fc7211befd50c8ae0 # v6.0.3
      - name: Run
        run: echo ok
`;

const githubExpression = expression => ['${{', expression, '}}'].join(' ');

const workflowRunCheckoutWorkflow = ({
  branchPolicy = '    branches:\n      - main-ultramodern\n',
  ref = githubExpression('github.event.workflow_run.head_sha'),
  permissions = '  contents: read\n  actions: read\n',
  checkoutJobIf = 'github.event.workflow_run.head_repository.full_name == github.repository',
} = {}) => `name: Workflow Run Example
on:
  workflow_run:
    workflows:
      - Build
${branchPolicy}permissions:
${permissions}jobs:
  example:
${checkoutJobIf ? `    if: ${checkoutJobIf}\n` : ''}    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@9f698171ed81b15d1823a05fc7211befd50c8ae0 # v6.0.3
        with:
          ref: ${ref}
`;

const workflowRunWithCloudflareSecretJob = ({
  condition = "github.event_name == 'workflow_dispatch' && inputs.deploy_cloudflare == 'true'",
} = {}) => `${workflowRunCheckoutWorkflow()}
  cloudflare:
    runs-on: ubuntu-latest
${condition ? `    if: ${condition}\n` : ''}    env:
      CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
    steps:
      - run: echo deploy
`;

test('compliant workflow produces no errors', () => {
  assert.deepEqual(
    validateWorkflowContent('.github/workflows/example.yml', compliantWorkflow),
    [],
  );
});

test('floating action tags are flagged in every workflow, not just sensitive ones', () => {
  const content = compliantWorkflow.replace(
    'actions/checkout@9f698171ed81b15d1823a05fc7211befd50c8ae0 # v6.0.3',
    'jdx/mise-action@v3',
  );
  const errors = validateWorkflowContent(
    '.github/workflows/example.yml',
    content,
  );
  assert.ok(
    errors.some(error =>
      /must pin jdx\/mise-action@v3 to a full commit SHA/.test(error),
    ),
  );
});

test('local composite actions are exempt from SHA pinning', () => {
  const content = compliantWorkflow.replace(
    'actions/checkout@9f698171ed81b15d1823a05fc7211befd50c8ae0 # v6.0.3',
    './.github/actions/local@main',
  );
  assert.deepEqual(
    validateWorkflowContent('.github/workflows/example.yml', content),
    [],
  );
});

test('missing top-level permissions block is flagged', () => {
  const content = compliantWorkflow.replace(
    'permissions:\n  contents: read\n',
    '',
  );
  const errors = validateWorkflowContent(
    '.github/workflows/example.yml',
    content,
  );
  assert.ok(
    errors.some(error =>
      /must declare a top-level permissions block/.test(error),
    ),
  );
});

test('pull_request_target is rejected', () => {
  const content = compliantWorkflow.replace(
    'on:\n  push:',
    'on:\n  pull_request_target:',
  );
  const errors = validateWorkflowContent(
    '.github/workflows/example.yml',
    content,
  );
  assert.ok(
    errors.some(error => /must not use pull_request_target/.test(error)),
  );
});

test('workflow_run may checkout its exact head SHA from literal restricted branches', () => {
  assert.deepEqual(
    validateWorkflowContent(
      '.github/workflows/workflow-run-example.yml',
      workflowRunCheckoutWorkflow(),
    ),
    [],
  );
});

test('workflow_run mutable and pull request refs remain rejected', () => {
  for (const ref of [
    'main-ultramodern',
    githubExpression('github.event.workflow_run.head_branch'),
    githubExpression('github.event.pull_request.head.sha'),
  ]) {
    const errors = validateWorkflowContent(
      '.github/workflows/workflow-run-example.yml',
      workflowRunCheckoutWorkflow({ ref }),
    );
    assert.ok(
      errors.some(error =>
        error.includes('must not checkout untrusted event refs'),
      ),
    );
  }
});

test('workflow_run treats secret guard removal and OR broadening as reachable', () => {
  for (const condition of [
    null,
    "github.event_name == 'workflow_dispatch' || github.event_name == 'workflow_run'",
    'github.event_name == inputs.expected_event',
  ]) {
    const errors = validateWorkflowContent(
      '.github/workflows/workflow-run-secret-guard.yml',
      workflowRunWithCloudflareSecretJob({ condition }),
    );
    assert.ok(errors.some(error => error.includes('must not expose secrets')));
    assert.ok(
      errors.some(error =>
        error.includes('must not checkout untrusted event refs'),
      ),
    );
  }
});

test('npm token references are rejected', () => {
  const content = compliantWorkflow.replace(
    'run: echo ok',
    'run: echo "$NPM_TOKEN"',
  );
  const errors = validateWorkflowContent(
    '.github/workflows/example.yml',
    content,
  );
  assert.ok(errors.some(error => /npm token/.test(error)));
});

test('dispatch input interpolation inside a run block scalar is flagged', () => {
  const content = compliantWorkflow.replace(
    'run: echo ok',
    `run: |
          node tool.mjs \\
            --package "\${{ github.event.inputs.create_package }}"`,
  );
  const errors = validateWorkflowContent(
    '.github/workflows/example.yml',
    content,
  );
  assert.ok(
    errors.some(error =>
      /must not interpolate workflow inputs into run blocks/.test(error),
    ),
  );
});

test('inputs routed through env and non-input expressions in run are fine', () => {
  const content = `name: Example
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  example:
    runs-on: ubuntu-latest
    steps:
      - name: Safe
        env:
          CREATE_PACKAGE_INPUT: \${{ github.event.inputs.create_package }}
        run: |
          echo "$CREATE_PACKAGE_INPUT"
          echo "\${{ matrix.command }}"
          echo "\${{ steps.pnpm-store.outputs.path }}"
`;
  assert.deepEqual(
    validateWorkflowContent('.github/workflows/example.yml', content),
    [],
  );
});

test('allowlist entries suppress only the matching error', () => {
  const content = compliantWorkflow
    .replace(
      'actions/checkout@9f698171ed81b15d1823a05fc7211befd50c8ae0 # v6.0.3',
      'jdx/mise-action@v3',
    )
    .replace('permissions:\n  contents: read\n', '');
  const errors = validateWorkflowContent(
    '.github/workflows/example.yml',
    content,
    {
      allowlist: [
        {
          file: '.github/workflows/example.yml',
          rule: 'sha-pinned-actions',
          match: 'jdx/mise-action@v3',
          reason: 'test fixture',
        },
      ],
    },
  );
  assert.ok(errors.every(error => !/full commit SHA/.test(error)));
  assert.ok(
    errors.some(error =>
      /must declare a top-level permissions block/.test(error),
    ),
  );
});

test('the Tractor baseline pin file must hold one immutable commit SHA', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tractor-pin-'));
  try {
    const pinPath = path.join(
      rootDir,
      'scripts/ultramodern-publish/tractor-baseline-revision',
    );
    assert.equal(validateTractorBaselinePin(rootDir).length, 1);
    fs.mkdirSync(path.dirname(pinPath), { recursive: true });
    for (const invalid of [
      'main\n',
      `${'a'.repeat(40)}`,
      `${'A'.repeat(40)}\n`,
    ]) {
      fs.writeFileSync(pinPath, invalid);
      assert.equal(validateTractorBaselinePin(rootDir).length, 1, invalid);
    }
    fs.writeFileSync(pinPath, `${'a'.repeat(40)}\n`);
    assert.deepEqual(validateTractorBaselinePin(rootDir), []);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('the real repository tree passes the validator end to end', () => {
  assert.deepEqual(validateRepository(), []);
});

test('release jobs reject inline programs and a Tractor baseline pinned in workflow YAML', () => {
  const workflowPath = '.github/workflows/publish-bleedingdev.yml';
  const content = fs.readFileSync(
    new URL(
      '../../../.github/workflows/publish-bleedingdev.yml',
      import.meta.url,
    ),
    'utf8',
  );
  // Regression: 3.9.0-ultramodern.24 lost its release record because the
  // post-publish Tractor pin advance edited this workflow mid-run, and GitHub
  // refuses GITHUB_TOKEN a tag whose commit's workflows differ from the
  // default branch.
  const workflowPinned = content.replace(
    '      wait_for_registry_cohort: true\n',
    `      wait_for_registry_cohort: true\n      tractor_ref: ${'0'.repeat(40)}\n`,
  );
  assert.notEqual(workflowPinned, content);
  assert.ok(
    validateWorkflowContent(workflowPath, workflowPinned).some(error =>
      error.includes(
        'job tractor-downstream must call ultramodern-tractor-downstream.yml without a tractor_ref',
      ),
    ),
  );
  for (const inline of [
    'node -e "require(\'unreviewed\')"',
    "node <<'NODE'",
    'node --input-type=module --eval "await import(\'unreviewed\')"',
  ]) {
    const mutated = content.replace(
      'node scripts/ultramodern-publish/workflow.mjs create-published-identity',
      inline,
    );
    assert.ok(
      validateWorkflowContent(workflowPath, mutated).some(error =>
        error.includes('fixed Node script entrypoints'),
      ),
      inline,
    );
  }
});

test('release gates keep their fail-fast needs edges', () => {
  const workflowPath = '.github/workflows/publish-bleedingdev.yml';
  const content = fs.readFileSync(
    new URL(`../../../${workflowPath}`, import.meta.url),
    'utf8',
  );
  const edgeErrors = source =>
    validateWorkflowContent(workflowPath, source).filter(
      error =>
        error.includes('must need') || error.includes('--check-registry'),
    );
  assert.deepEqual(edgeErrors(content), []);
  for (const [edge, job, need] of [
    [
      '      - reconcile-sidecars\n    outputs:',
      'accept-release',
      'reconcile-sidecars',
    ],
    [
      '      - prepare-release\n    steps:',
      'reconcile-sidecars',
      'prepare-release',
    ],
    [
      '      - accept-release\n      # A dry run is green only when the Tractor rehearsal is.\n      - rehearse-tractor\n',
      'validate-release',
      'rehearse-tractor',
    ],
  ]) {
    assert.equal(content.split(edge).length, 2, edge);
    const kept = edge.replace(`      - ${need}\n`, '');
    assert.deepEqual(edgeErrors(content.replace(edge, kept)), [
      `${workflowPath} job ${job} must need ${need} so a registry or rehearsal failure stops the release before the expensive jobs finish`,
    ]);
  }
  const check =
    'run: node scripts/ultramodern-publish/publish-sidecars.mjs --check-registry';
  assert.ok(content.includes(check));
  assert.equal(
    edgeErrors(content.replace(check, 'run: echo skipped')).length,
    1,
  );
});

test('release qualification needs integration on its own commit', () => {
  const workflowPath = '.github/workflows/publish-bleedingdev.yml';
  const content = fs.readFileSync(
    new URL(`../../../${workflowPath}`, import.meta.url),
    'utf8',
  );
  const integrationErrors = source =>
    validateWorkflowContent(workflowPath, source).filter(error =>
      error.includes('must need an integration job'),
    );
  assert.deepEqual(integrationErrors(content), []);
  const edge =
    '    needs:\n      - integration\n      - qualify-source-compute\n';
  assert.equal(content.split(edge).length, 2);
  assert.equal(integrationErrors(content.replace(edge, '')).length, 1);
  const uses = 'uses: ./.github/workflows/integration-test.yml';
  assert.equal(content.split(uses).length, 2);
  assert.equal(
    integrationErrors(
      content.replace(uses, 'uses: ./.github/workflows/ut-Linux.yml'),
    ).length,
    1,
  );
});

test('release qualification overlaps integration and issues no receipt before both pass', () => {
  const workflowPath = '.github/workflows/publish-bleedingdev.yml';
  const content = fs.readFileSync(
    new URL(`../../../${workflowPath}`, import.meta.url),
    'utf8',
  );
  const workflow = yaml.load(content);
  const results = Object.fromEntries(
    Object.keys(workflow.jobs).map(jobId => [jobId, 'success']),
  );
  const context = {
    github: {
      actor: 'BleedingDev',
      triggering_actor: 'BleedingDev',
      repository_owner: 'BleedingDev',
      ref: 'refs/heads/main-ultramodern',
    },
    inputs: { dry_run: false, recovery_run_id: '' },
    vars: {},
  };
  const schedules = (jobId, overrides = {}, inputs = context.inputs) =>
    evaluateJobSchedule({
      workflow,
      jobId,
      results: { ...results, ...overrides },
      context: { ...context, inputs },
    });
  assert.equal(workflow.jobs['qualify-source-compute'].needs, undefined);
  assert.deepEqual(workflow.jobs['qualify-source'].needs, [
    'integration',
    'qualify-source-compute',
  ]);
  for (const jobId of ['qualify-source', 'publish', 'publish-sidecars']) {
    assert.equal(schedules(jobId), true, jobId);
  }
  for (const prerequisite of ['integration', 'qualify-source-compute']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.equal(
        schedules('qualify-source-compute', { [prerequisite]: result }),
        true,
        `compute remains independent of ${prerequisite} ${result}`,
      );
      for (const jobId of ['qualify-source', 'publish', 'publish-sidecars']) {
        assert.equal(
          schedules(jobId, { [prerequisite]: result }),
          false,
          `${jobId} rejects ${prerequisite} ${result}`,
        );
      }
    }
  }
  for (const result of ['failure', 'cancelled', 'skipped']) {
    for (const jobId of ['publish', 'publish-sidecars']) {
      assert.equal(schedules(jobId, { 'qualify-source': result }), false);
    }
  }
  assert.equal(
    schedules(
      'qualify-source',
      {},
      {
        dry_run: true,
        recovery_run_id: '',
      },
    ),
    true,
    'dry runs still qualify',
  );
  assert.equal(
    schedules(
      'qualify-source',
      {},
      {
        dry_run: false,
        recovery_run_id: '77',
      },
    ),
    true,
    'recovery still qualifies its current publication tooling',
  );
});

test('release validator rejects unsafe qualification splits and receipt shortcuts', () => {
  const workflowPath = '.github/workflows/publish-bleedingdev.yml';
  const content = fs.readFileSync(
    new URL(`../../../${workflowPath}`, import.meta.url),
    'utf8',
  );
  const errors = source => validateWorkflowContent(workflowPath, source);
  const joinStart = content.indexOf('  qualify-source:\n');
  const joinEnd = content.indexOf('  prepare-release:\n', joinStart);
  const join = content.slice(joinStart, joinEnd);
  const mutateJoin = replacement =>
    content.slice(0, joinStart) + replacement + content.slice(joinEnd);
  assert.ok(joinStart > 0 && joinEnd > joinStart);
  for (const need of ['integration', 'qualify-source-compute']) {
    assert.ok(
      errors(mutateJoin(join.replace(`      - ${need}\n`, ''))).some(error =>
        error.includes('must join integration'),
      ),
    );
  }
  const conditionStart = join.indexOf('    if: >-\n');
  const conditionEnd = join.indexOf('    steps:\n', conditionStart);
  const unsafeCondition = mutateJoin(
    join.slice(0, conditionStart) +
      '    if: always()\n' +
      join.slice(conditionEnd),
  );
  assert.ok(
    errors(unsafeCondition).some(error =>
      error.includes('failure, cancellation or skip'),
    ),
  );
  const movedCreate = content.replace(
    '  qualify-source-compute:\n',
    '  qualify-source-compute:\n    # No receipt authority in this job.\n',
  );
  const movedReceipt = movedCreate.replace(
    '      - name: Qualify the release publication tooling\n',
    `      - name: Unsafe early receipt
        if: inputs.recovery_run_id == ''
        run: node scripts/ultramodern-publish/source-qualification.mjs create
      - name: Qualify the release publication tooling
`,
  );
  assert.ok(
    errors(movedReceipt).some(error =>
      error.includes('receipts must be created and uploaded only'),
    ),
  );
  const receiptStep =
    "      - name: Record the qualified source commit\n        if: inputs.recovery_run_id == ''\n";
  assert.ok(content.includes(receiptStep));
  assert.ok(
    errors(
      content.replace(
        receiptStep,
        '      - name: Record the qualified source commit\n        if: always()\n',
      ),
    ).some(error =>
      error.includes('receipts must be created and uploaded only'),
    ),
  );
  for (const jobId of ['validate-release', 'publish', 'publish-sidecars']) {
    const begin = content.indexOf(`  ${jobId}:\n`);
    const next = content.slice(begin + 3).search(/\n {2}[\w-]+:\n/u);
    const end = next === -1 ? -1 : begin + 3 + next;
    const section = content.slice(begin, end === -1 ? undefined : end);
    assert.ok(section.includes('      - qualify-source\n'), jobId);
    const mutated = content.replace(
      section,
      section.replace('      - qualify-source\n', ''),
    );
    assert.ok(
      errors(mutated).some(error =>
        error.includes(`job ${jobId} must need qualify-source`),
      ),
      jobId,
    );
  }
});

test('integration gates pull requests with one job per suite', () => {
  const workflowPath = '.github/workflows/integration-test.yml';
  const content = fs.readFileSync(
    new URL(`../../../${workflowPath}`, import.meta.url),
    'utf8',
  );
  const gateErrors = source =>
    validateWorkflowContent(workflowPath, source).filter(
      error =>
        error.includes('must trigger on') ||
        error.includes('must not filter paths') ||
        error.includes('one suite per job') ||
        error.includes('has no step gated') ||
        error.includes('must schedule shards'),
    );
  assert.deepEqual(gateErrors(content), []);
  for (const trigger of ['pull_request', 'merge_group', 'workflow_call']) {
    const line = new RegExp(`^  ${trigger}:.*\n(?:    .*\n)*`, 'mu');
    assert.match(content, line, trigger);
    assert.deepEqual(gateErrors(content.replace(line, '')), [
      `${workflowPath} must trigger on ${trigger}: integration gates pull requests, the merge queue and the release`,
    ]);
  }
  assert.equal(
    gateErrors(
      content.replace(
        '  merge_group:\n',
        "  merge_group:\n  push:\n    paths-ignore: ['docs/**']\n",
      ),
    ).length,
    1,
  );
  // A second suite chained in the same job runs only if the first passed.
  // Each mutation also leaves the rstest-adapter suite without its step.
  const adapterGate = "        if: matrix.suite == 'rstest-adapter'\n";
  assert.ok(content.includes(adapterGate));
  for (const mutated of [
    '',
    "        if: matrix.suite == 'framework'\n",
    "        if: matrix.suite == 'e2e'\n",
  ]) {
    const errors = gateErrors(content.replace(adapterGate, mutated));
    assert.equal(errors.length, 2, mutated);
    assert.ok(errors[0].includes('step Test - Adapter Rstest must run one'));
    assert.ok(errors[1].includes('matrix suite rstest-adapter has no step'));
  }
  // A suite whose step was deleted would be a green job that tests nothing.
  const utilsStart = content.indexOf(
    '      - name: Test - Published package surfaces',
  );
  const utilsCommand = '        run: pnpm run test:utils\n';
  const utilsStep = content.slice(
    utilsStart,
    content.indexOf(utilsCommand, utilsStart) + utilsCommand.length,
  );
  assert.match(utilsStep, /run: pnpm run test:utils\n$/u);
  assert.deepEqual(gateErrors(content.replace(utilsStep, '')), [
    `${workflowPath} job integration matrix suite utils has no step gated by if: matrix.suite == 'utils', so that job would pass without testing anything`,
  ]);
  // Removing any native shard must fail the completeness gate.
  const workflow = yaml.load(content);
  const matrix = workflow.jobs.integration.strategy.matrix;
  matrix.include = matrix.include.filter(
    entry => !(entry.platform === 'Windows' && entry.shard === '2/6'),
  );
  const coverageErrors = validateWorkflowContent(
    workflowPath,
    yaml.dump(workflow),
  );
  assert.ok(
    coverageErrors.some(error =>
      error.includes('must schedule six core shards'),
    ),
    'Dropping a Windows shard must fail framework partition completeness.',
  );
  assert.ok(
    coverageErrors.some(error =>
      error.includes('must schedule exactly 19 jobs'),
    ),
    'Dropping a Windows shard must fail the complete integration job inventory.',
  );
});

// These cases mutate YAML, not repository membership. Reuse the tracked-file
// snapshot while checking the eager import closure on every mutated workflow.
const integrationValidationOptions = {
  trackedFiles: listTrackedFiles(repoRoot),
};

const integrationPartitionErrors = mutate => {
  const workflowPath = '.github/workflows/integration-test.yml';
  const content = fs.readFileSync(
    new URL(`../../../${workflowPath}`, import.meta.url),
    'utf8',
  );
  const workflow = yaml.load(content);
  mutate?.(workflow);
  return validateWorkflowContent(
    workflowPath,
    yaml.dump(workflow),
    integrationValidationOptions,
  ).filter(
    error =>
      error.includes('integration must schedule six core shards') ||
      error.includes('integration must schedule exactly 19 jobs') ||
      error.includes('integration must select each framework partition') ||
      error.includes(
        'integration concurrency must cancel only direct pull requests',
      ) ||
      error.includes('required-framework must preserve all six'),
  );
};

test('integration include-only matrix runs every core, generator and side suite exactly once', () => {
  assert.deepEqual(integrationPartitionErrors(), []);
  const workflowPath = '.github/workflows/integration-test.yml';
  const workflow = yaml.load(
    fs.readFileSync(
      new URL(`../../../${workflowPath}`, import.meta.url),
      'utf8',
    ),
  );
  const matrix = workflow.jobs.integration.strategy.matrix;
  assert.deepEqual(Object.keys(matrix), ['include']);
  const identity = entry =>
    JSON.stringify([
      entry.platform,
      entry.suite,
      entry.runner,
      entry.framework_suite ?? null,
      entry.shard ?? null,
    ]);
  const expected = [];
  for (const [platform, runner] of [
    ['Linux', 'ubuntu-24.04'],
    ['Windows', 'windows-latest'],
  ]) {
    for (let shard = 1; shard <= 6; shard++) {
      expected.push({
        platform,
        runner,
        suite: 'framework',
        framework_suite: 'core',
        shard: `${shard}/6`,
      });
    }
    for (const fixture of ['workspace', 'bff']) {
      expected.push({
        platform,
        runner,
        suite: `framework-generator-${fixture}`,
        framework_suite: `generator-${fixture}`,
      });
    }
    expected.push({ platform, runner, suite: 'rstest-adapter' });
  }
  expected.push({ platform: 'Linux', runner: 'ubuntu-24.04', suite: 'utils' });
  assert.equal(matrix.include.length, 19);
  assert.deepEqual(
    matrix.include.map(identity).sort(),
    expected.map(identity).sort(),
  );
  assert.deepEqual(
    matrix.include.slice(0, 6).map(entry => [entry.platform, entry.shard]),
    ['4/6', '3/6', '2/6', '1/6', '6/6', '5/6'].map(shard => ['Windows', shard]),
  );

  const matrixErrors = mutate =>
    integrationPartitionErrors(workflow =>
      mutate(workflow.jobs.integration.strategy.matrix),
    ).filter(
      error =>
        error.includes('must schedule six core shards') ||
        error.includes('must schedule exactly 19 jobs'),
    );
  for (const [index, entry] of matrix.include.entries()) {
    const label = `${entry.platform} ${entry.suite} ${entry.shard ?? ''}`;
    assert.ok(
      matrixErrors(matrix => {
        matrix.include.splice(index, 1);
      }).length > 0,
      `${label} missing`,
    );
    assert.ok(
      matrixErrors(matrix => {
        matrix.include.push({ ...matrix.include[index] });
      }).length > 0,
      `${label} duplicate`,
    );
    for (const [field, value] of [
      [
        'runner',
        entry.platform === 'Linux' ? 'windows-latest' : 'ubuntu-24.04',
      ],
      ['platform', 'macOS'],
      ['framework_suite', 'full'],
      ['shard', entry.shard ? '1/5' : '1/1'],
    ]) {
      assert.ok(
        matrixErrors(matrix => {
          matrix.include[index][field] = value;
        }).length > 0,
        `${label} invalid ${field}`,
      );
    }
  }
  for (const extra of [
    { platform: 'Linux', runner: 'ubuntu-24.04', suite: 'unrecognized' },
    { platform: 'Windows', runner: 'windows-latest', suite: 'utils' },
    {
      platform: 'Linux',
      runner: 'ubuntu-24.04',
      suite: 'framework',
      framework_suite: 'core',
      shard: '7/6',
    },
  ]) {
    assert.ok(
      matrixErrors(matrix => matrix.include.push(extra)).length > 0,
      `extra ${identity(extra)}`,
    );
  }
});

test('integration cancels earlier direct PR commits without cancelling callers or trusted runs', () => {
  const workflow = yaml.load(
    fs.readFileSync(
      new URL(
        '../../../.github/workflows/integration-test.yml',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(typeof workflow.concurrency.group, 'string');
  assert.equal(typeof workflow.concurrency['cancel-in-progress'], 'string');
  const group = workflow.concurrency.group.replace(
    /^\s*\$\{\{\s*|\s*\}\}\s*$/gu,
    '',
  );
  const github = {
    repository: 'BleedingDev/ultramodern.js',
    repository_id: '123',
    workflow: 'Integration Test',
    event_name: 'pull_request',
    ref: 'refs/pull/17/merge',
    workflow_ref:
      'BleedingDev/ultramodern.js/.github/workflows/integration-test.yml@refs/pull/17/merge',
    head_ref: 'speed-ci',
    sha: 'first-commit',
    run_id: '100',
    run_attempt: '1',
    event: {
      pull_request: {
        number: 17,
        head: { ref: 'speed-ci', repo: { full_name: 'first/ultramodern.js' } },
      },
    },
  };
  const assertConcurrency = (context, expectedGroup, cancel, label) => {
    const probe = {
      jobs: {
        cancel: { if: workflow.concurrency['cancel-in-progress'] },
        group: { if: githubExpression(`${group} == '${expectedGroup}'`) },
      },
    };
    assert.equal(
      evaluateJobSchedule({ workflow: probe, jobId: 'cancel', context }),
      cancel,
      `${label} cancellation`,
    );
    assert.equal(
      evaluateJobSchedule({ workflow: probe, jobId: 'group', context }),
      true,
      `${label} group`,
    );
  };
  assertConcurrency(
    { github },
    'integration-test-123-pr-17',
    true,
    'direct PR',
  );
  assertConcurrency(
    {
      github: {
        ...github,
        sha: 'second-commit',
        run_id: '101',
        run_attempt: '2',
      },
    },
    'integration-test-123-pr-17',
    true,
    'another commit on the same PR',
  );
  assertConcurrency(
    {
      github: {
        ...github,
        ref: 'refs/pull/18/merge',
        workflow_ref:
          'BleedingDev/ultramodern.js/.github/workflows/integration-test.yml@refs/pull/18/merge',
        event: {
          pull_request: {
            number: 18,
            head: {
              ref: 'speed-ci',
              repo: { full_name: 'second/ultramodern.js' },
            },
          },
        },
      },
    },
    'integration-test-123-pr-18',
    true,
    'different fork PR with the same branch name',
  );
  for (const eventName of ['workflow_dispatch', 'merge_group', 'push']) {
    for (const [runId, attempt] of [
      ['100', '1'],
      ['101', '1'],
      ['100', '2'],
    ]) {
      assertConcurrency(
        {
          github: {
            ...github,
            event_name: eventName,
            event: {},
            ref: 'refs/heads/main-ultramodern',
            workflow_ref:
              'BleedingDev/ultramodern.js/.github/workflows/integration-test.yml@refs/heads/main-ultramodern',
            run_id: runId,
            run_attempt: attempt,
          },
        },
        `integration-test-123-run-${runId}-attempt-${attempt}`,
        false,
        `${eventName} run ${runId} attempt ${attempt}`,
      );
    }
  }
  assertConcurrency(
    {
      github: {
        ...github,
        workflow_ref:
          'BleedingDev/ultramodern.js/.github/workflows/publish-bleedingdev.yml@refs/pull/17/merge',
      },
    },
    'integration-test-123-run-100-attempt-1',
    false,
    'PR-triggered release caller with the same workflow display name',
  );
});

test('integration validator rejects unsafe cancellation and shared trusted-run groups', () => {
  const concurrencyErrors = mutate =>
    integrationPartitionErrors(mutate).filter(error =>
      error.includes(
        'integration concurrency must cancel only direct pull requests',
      ),
    );
  assert.deepEqual(concurrencyErrors(), []);
  for (const [label, mutate] of [
    ['missing policy', workflow => delete workflow.concurrency],
    [
      'unconditional cancellation',
      workflow => {
        workflow.concurrency['cancel-in-progress'] = true;
      },
    ],
    [
      'PR event without caller guard',
      workflow => {
        workflow.concurrency['cancel-in-progress'] = githubExpression(
          "github.event_name == 'pull_request'",
        );
      },
    ],
    [
      'shared fork branch names',
      workflow => {
        workflow.concurrency.group = githubExpression(
          "format('integration-test-{0}-{1}', github.repository_id, github.head_ref)",
        );
      },
    ],
    [
      'trusted reruns share a group',
      workflow => {
        workflow.concurrency.group = workflow.concurrency.group.replace(
          "format('run-{0}-attempt-{1}', github.run_id, github.run_attempt)",
          "format('run-{0}', github.run_id)",
        );
      },
    ],
  ]) {
    assert.ok(concurrencyErrors(mutate).length > 0, label);
  }
});

test('integration generator commands cannot override their partition or shard a fixture', () => {
  const commandErrors = mutate =>
    integrationPartitionErrors(mutate).filter(error =>
      error.includes('must select each framework partition'),
    );
  assert.deepEqual(commandErrors(), []);
  assert.equal(
    commandErrors(workflow => {
      delete workflow.jobs.integration.env.MODERN_TEST_FRAMEWORK_SUITE;
    }).length,
    1,
  );
  assert.equal(
    commandErrors(workflow => {
      workflow.jobs.integration['continue-on-error'] = true;
    }).length,
    1,
  );
  assert.equal(
    commandErrors(workflow => {
      workflow.jobs.integration.steps.find(
        step => step.if === "matrix.suite == 'framework'",
      )['continue-on-error'] = true;
    }).length,
    1,
  );
  for (const suite of ['generator-workspace', 'generator-bff']) {
    const mutateStep = mutate => workflow => {
      const step = workflow.jobs.integration.steps.find(
        step => step.if === `matrix.suite == 'framework-${suite}'`,
      );
      assert.ok(step, suite);
      mutate(step);
    };
    for (const mutate of [
      step => {
        step.env = { MODERN_TEST_FRAMEWORK_SUITE: 'full' };
      },
      step => {
        step.run += ' --shard 1/2';
      },
      step => {
        step.run += ' --shard=1/2';
      },
      step => {
        step.run = `MODERN_TEST_FRAMEWORK_SUITE=core ${step.run}`;
      },
      step => {
        step['continue-on-error'] = true;
      },
      step => {
        step['continue-on-error'] = githubExpression('true');
      },
    ]) {
      assert.equal(commandErrors(mutateStep(mutate)).length, 1, suite);
    }
  }
});

test('protected integration checks fail closed over every generator and core matrix job', () => {
  const aggregateErrors = mutate =>
    integrationPartitionErrors(mutate).filter(error =>
      error.includes('required-framework must preserve all six'),
    );
  assert.deepEqual(aggregateErrors(), []);
  for (const mutate of [
    workflow => {
      delete workflow.jobs['required-framework'];
    },
    workflow => {
      workflow.jobs['required-framework'].strategy.matrix.platform = ['Linux'];
    },
    workflow => {
      workflow.jobs['required-framework'].strategy.matrix.required_shard = [
        1, 2,
      ];
    },
    workflow => {
      workflow.jobs['required-framework'].strategy.matrix.required_shard = [
        1, 2, 3, 3,
      ];
    },
    workflow => {
      workflow.jobs['required-framework'].name = 'Integration passed';
    },
    workflow => {
      workflow.jobs['required-framework'].needs = [];
    },
    workflow => {
      workflow.jobs['required-framework'].if = 'success()';
    },
    workflow => {
      workflow.jobs['required-framework']['continue-on-error'] = true;
    },
    workflow => {
      workflow.jobs['required-framework'].steps[0].if =
        "needs.integration.result == 'success'";
    },
    workflow => {
      workflow.jobs['required-framework'].steps[0].run = 'echo success';
    },
    workflow => {
      workflow.jobs['required-framework'].steps[0].env.INTEGRATION_RESULT =
        'success';
    },
    workflow => {
      workflow.jobs['required-framework'].steps[0]['continue-on-error'] = true;
    },
  ]) {
    assert.equal(aggregateErrors(mutate).length, 1);
  }
});

test('release gates reject node:test filter flags', () => {
  const workflowPath = '.github/workflows/publish-bleedingdev.yml';
  const content = fs.readFileSync(
    new URL(`../../../${workflowPath}`, import.meta.url),
    'utf8',
  );
  const gate = 'mise exec -- pnpm run test:scripts:after-build';
  assert.ok(content.includes(gate));
  const filterErrors = source =>
    validateWorkflowContent(workflowPath, source).filter(error =>
      error.includes('must not filter node:test cases'),
    );

  assert.deepEqual(filterErrors(content), []);
  for (const filtered of [
    `NODE_OPTIONS='--test-skip-pattern=^flaky$' \\\n            ${gate}`,
    `${gate} -- --test-name-pattern=happy`,
    `${gate} -- --test-only`,
    `${gate} -- --test-shard=1/2`,
  ]) {
    assert.equal(
      filterErrors(content.replace(gate, () => filtered)).length,
      1,
      filtered,
    );
  }
  assert.deepEqual(
    filterErrors(content.replace(gate, `${gate} # --test-skip-pattern`)),
    [],
  );

  const envFiltered = compliantWorkflow.replace(
    '        run: echo ok',
    "        env:\n          NODE_OPTIONS: '--test-skip-pattern=slow'\n        run: node --test",
  );
  assert.equal(
    validateWorkflowContent(workflowPath, envFiltered, {
      sensitive: true,
    }).filter(error => error.includes('must not filter node:test cases'))
      .length,
    1,
  );
});

test('release jobs and steps reject continue-on-error', () => {
  const workflowPath = '.github/workflows/publish-bleedingdev.yml';
  const content = fs.readFileSync(
    new URL(`../../../${workflowPath}`, import.meta.url),
    'utf8',
  );
  const masked = source =>
    validateWorkflowContent(workflowPath, source).filter(error =>
      error.includes('must not set continue-on-error'),
    );
  const jobHeader = '    name: Publish the cohort change record\n';
  const stepHeader = '      - name: Create or update the GitHub release\n';
  assert.ok(content.includes(jobHeader));
  assert.ok(content.includes(stepHeader));

  assert.deepEqual(masked(content), []);
  assert.equal(
    masked(
      content.replace(jobHeader, `${jobHeader}    continue-on-error: true\n`),
    ).length,
    1,
  );
  assert.equal(
    masked(
      content.replace(
        stepHeader,
        `${stepHeader}        continue-on-error: true\n`,
      ),
    ).length,
    1,
  );
});

test('cache paths must be normalized', () => {
  const cacheWorkflow = cachePath => `name: Cache
on:
  push:
permissions:
  contents: read
jobs:
  example:
    runs-on: ubuntu-latest
    steps:
      - name: Restore browsers
        uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: ${cachePath}
          key: browsers
`;
  const flagged = cachePath =>
    validateWorkflowContent(
      '.github/workflows/cache.yml',
      cacheWorkflow(cachePath),
    ).filter(error => error.includes('contains a .. or . segment'));

  assert.deepEqual(flagged('/home/runner/ms-playwright'), []);
  assert.deepEqual(flagged(githubExpression('steps.b.outputs.cache_path')), []);
  assert.equal(
    flagged(`${githubExpression('github.workspace')}/../ms-playwright`).length,
    1,
  );
  assert.equal(flagged('/home/runner/./ms-playwright').length, 1);
  assert.equal(flagged('/home/runner/..').length, 1);
  for (const leading of ['../ms-playwright', './cache', '..', '.']) {
    assert.equal(flagged(leading).length, 1, leading);
  }
  assert.deepEqual(flagged('.cache/ms-playwright'), []);
  assert.deepEqual(flagged('~/.cache/ms-playwright'), []);
});

test('workflow and job env reject the runner context', () => {
  const envWorkflow = ({ workflowEnv = '', jobEnv = '' }) => `name: Env
on:
  push:
permissions:
  contents: read
${workflowEnv}jobs:
  example:
    runs-on: ubuntu-latest
${jobEnv}    steps:
      - name: Run
        run: echo ok
`;
  const flagged = options =>
    validateWorkflowContent(
      '.github/workflows/env.yml',
      envWorkflow(options),
    ).filter(error => error.includes('reads the runner context'));

  assert.deepEqual(
    flagged({
      jobEnv: `    env:\n      BROWSERS: ${githubExpression('github.workspace')}/ms-playwright\n`,
    }),
    [],
  );
  assert.equal(
    flagged({
      jobEnv: `    env:\n      BROWSERS: ${githubExpression('runner.temp')}/ms-playwright\n`,
    }).length,
    1,
  );
  assert.equal(
    flagged({
      workflowEnv: `env:\n  BROWSERS: ${githubExpression('runner.temp')}\n`,
    }).length,
    1,
  );
});

test('workflows reject runtime skip-CI gates', () => {
  const skipErrors = source =>
    validateWorkflowContent('.github/workflows/example.yml', source).filter(
      error => error.includes('must not gate jobs on a runtime skip-CI diff'),
    );
  assert.deepEqual(skipErrors(compliantWorkflow), []);
  for (const gated of [
    '        run: echo "RESULT=$(node ./scripts/skipCI.js)" >> "$GITHUB_OUTPUT"',
    `        if: ${githubExpression("steps.skip-ci.outputs.RESULT != 'true'")}\n        run: echo ok`,
    '        run: git diff origin/main... --name-only',
    `        id: docs-only\n        run: echo "skip=$(git diff HEAD^ --name-only | grep -qv '^docs/' || echo true)" >> "$GITHUB_OUTPUT"\n      - name: Test\n        if: ${githubExpression("steps.docs-only.outputs.skip != 'true'")}\n        run: echo ok`,
    `        id: docs-only\n        run: git diff HEAD^ --name-only > changed.txt\n      - name: Test\n        if: ${githubExpression("steps['docs-only'].outputs.skip != 'true'")}\n        run: echo ok`,
    `        id: docs-only\n        run: git diff HEAD^ --name-only > changed.txt\n      - name: Test\n        if: ${githubExpression("steps['docs-only']['outputs'].skip != 'true'")}\n        run: echo ok`,
    `        id: filter\n        uses: dorny/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36\n      - name: Test\n        if: ${githubExpression("steps.filter.outputs.src == 'true'")}\n        run: echo ok`,
  ]) {
    assert.equal(
      skipErrors(compliantWorkflow.replace('        run: echo ok', gated))
        .length,
      1,
      gated,
    );
  }
  assert.deepEqual(
    skipErrors(
      compliantWorkflow.replace(
        '        run: echo ok',
        '        run: git diff origin/main-ultramodern... --name-only',
      ),
    ),
    [],
  );
  assert.deepEqual(
    skipErrors(
      compliantWorkflow.replace(
        '        run: echo ok',
        `        id: inspect\n        run: git diff --name-only HEAD^\n      - name: Report\n        if: ${githubExpression("failure() && steps.inspect.outcome == 'failure'")}\n        run: echo ok`,
      ),
    ),
    [],
  );
});

test('trigger path filters must run an edit of the workflow itself', () => {
  const pathErrors = source =>
    validateWorkflowContent('.github/workflows/example.yml', source).filter(
      error =>
        error.includes('a workflow edit has to run the checks it changes'),
    );
  const withFilter = filter =>
    compliantWorkflow.replace('  push:\n', `  push:\n${filter}`);
  for (const filter of [
    "    paths-ignore:\n      - 'docs/**'\n      - '**/*.md'\n      - '.changeset/**'\n",
    "    paths:\n      - 'packages/**'\n      - '.github/workflows/example.yml'\n",
    "    paths:\n      - '.github/**'\n",
    "    paths:\n      - '**'\n",
    "    paths:\n      - '*/workflows/*.yml'\n",
    "    paths:\n      - '!.github/**'\n      - '.github/workflows/example.yml'\n",
  ]) {
    assert.deepEqual(pathErrors(withFilter(filter)), [], filter);
  }
  for (const filter of [
    "    paths-ignore:\n      - '.github/**'\n",
    "    paths-ignore:\n      - '**/.github/**'\n",
    "    paths-ignore:\n      - '**/*.yml'\n",
    "    paths-ignore:\n      - '[.]github/**'\n",
    "    paths-ignore:\n      - '.githu?b/**'\n",
    "    paths:\n      - 'packages/**'\n",
    "    paths:\n      - '.github/**'\n      - '!.github/**'\n",
  ]) {
    assert.equal(pathErrors(withFilter(filter)).length, 1, filter);
  }
  assert.deepEqual(
    validateWorkflowContent(
      '.github/workflows/build+test.yml',
      withFilter("    paths:\n      - '.github/workflows/build\\+test.yml'\n"),
    ).filter(error =>
      error.includes('a workflow edit has to run the checks it changes'),
    ),
    [],
  );
});
