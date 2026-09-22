import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  validateRepository,
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
          echo "\${{ steps.skip-ci.outputs.RESULT }}"
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

test('the real repository tree passes the validator end to end', () => {
  assert.deepEqual(validateRepository(), []);
});

test('release jobs reject inline programs and different Tractor acceptance revisions', () => {
  const workflowPath = '.github/workflows/publish-bleedingdev.yml';
  const content = fs.readFileSync(
    new URL(
      '../../../.github/workflows/publish-bleedingdev.yml',
      import.meta.url,
    ),
    'utf8',
  );
  const pin = /tractor_ref: ([a-f0-9]{40})/u.exec(content)[1];
  const changedPin = content.replace(
    `tractor_ref: ${pin}`,
    `tractor_ref: ${'0'.repeat(40)}`,
  );
  assert.ok(
    validateWorkflowContent(workflowPath, changedPin).some(error =>
      error.includes('same immutable tractor_ref'),
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
