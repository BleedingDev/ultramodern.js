import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectRunBlockInputInterpolations,
  collectUses,
  validateRenovateConfigObject,
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
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Run
        run: echo ok
`;

const githubExpression = expression => ['${{', expression, '}}'].join(' ');

const workflowRunCheckoutWorkflow = ({
  branchPolicy = '    branches:\n      - main-ultramodern\n',
  ref = githubExpression('github.event.workflow_run.head_sha'),
  permissions = '  contents: read\n  actions: read\n',
} = {}) => `name: Workflow Run Example
on:
  workflow_run:
    workflows:
      - Build
${branchPolicy}permissions:
${permissions}jobs:
  example:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${ref}
`;

test('compliant workflow produces no errors', () => {
  assert.deepEqual(
    validateWorkflowContent('.github/workflows/example.yml', compliantWorkflow),
    [],
  );
});

test('floating action tags are flagged in every workflow, not just sensitive ones', () => {
  const content = compliantWorkflow.replace(
    'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2',
    'jdx/mise-action@v3',
  );
  const errors = validateWorkflowContent(
    '.github/workflows/example.yml',
    content,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must pin jdx\/mise-action@v3 to a full commit SHA/);
});

test('local composite actions are exempt from SHA pinning', () => {
  const content = compliantWorkflow.replace(
    'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2',
    './.github/actions/local@main',
  );
  assert.deepEqual(
    validateWorkflowContent('.github/workflows/example.yml', content),
    [],
  );
});

test('collectUses extracts action and ref', () => {
  assert.deepEqual(collectUses('      - uses: actions/cache@abc123 # v4\n'), [
    { action: 'actions/cache', ref: 'abc123' },
  ]);
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
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must declare a top-level permissions block/);
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
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must not use pull_request_target/);
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

test('workflow_run exact head SHA checkout requires a literal branch restriction', () => {
  for (const branchPolicy of ['', "    branches:\n      - '*'\n"]) {
    const errors = validateWorkflowContent(
      '.github/workflows/workflow-run-example.yml',
      workflowRunCheckoutWorkflow({ branchPolicy }),
    );
    assert.ok(
      errors.some(error =>
        error.includes('must not checkout untrusted event refs'),
      ),
    );
  }
});

test('workflow_run mutable and pull request refs remain rejected', () => {
  for (const ref of [
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

test('workflow_run exact head SHA checkout rejects workflows with write permissions', () => {
  const errors = validateWorkflowContent(
    '.github/workflows/workflow-run-example.yml',
    workflowRunCheckoutWorkflow({
      permissions: '  contents: write\n  actions: read\n',
    }),
  );
  assert.ok(
    errors.some(error => error.includes('must not grant write permissions')),
  );
  assert.ok(
    errors.some(error =>
      error.includes('must not checkout untrusted event refs'),
    ),
  );
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
  assert.equal(errors.length, 1);
  assert.match(errors[0], /npm token/);
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
  assert.equal(errors.length, 1);
  assert.match(
    errors[0],
    /must not interpolate workflow inputs into run blocks/,
  );
});

test('inline run input interpolation is flagged', () => {
  const findings = collectRunBlockInputInterpolations(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression syntax is the fixture under test
    '      - run: echo "${{ inputs.version }}"\n',
  );
  assert.equal(findings.length, 1);
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

const sensitiveBoilerplate = egressPolicy => `name: Sensitive
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  job:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@ab7a9404c0f3da075243ca237b5fac12c98deaa5 # v2
        with:
          egress-policy: ${egressPolicy}
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false
`;

test('sensitive workflows accept both egress-policy audit and block', () => {
  for (const policy of ['audit', 'block']) {
    assert.deepEqual(
      validateWorkflowContent(
        '.github/workflows/sensitive.yml',
        sensitiveBoilerplate(policy),
        { sensitive: true },
      ),
      [],
      `egress-policy: ${policy} must pass`,
    );
  }
});

test('sensitive workflows without harden-runner egress policy are flagged', () => {
  const content = sensitiveBoilerplate('audit').replace(
    /\n {8}with:\n {10}egress-policy: audit/,
    '',
  );
  const errors = validateWorkflowContent(
    '.github/workflows/sensitive.yml',
    content,
    { sensitive: true },
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /egress-policy: audit\|block/);
});

test('publish workflows must use OIDC trusted publishing', () => {
  const errors = validateWorkflowContent(
    '.github/workflows/publish-example.yml',
    sensitiveBoilerplate('audit'),
    { sensitive: true },
  );
  assert.deepEqual(errors, [
    '.github/workflows/publish-example.yml must grant id-token: write for trusted publishing',
    '.github/workflows/publish-example.yml must publish through the npm-publish environment',
  ]);
});

test('allowlist entries suppress only the matching error', () => {
  const content = compliantWorkflow
    .replace(
      'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2',
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
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must declare a top-level permissions block/);
});

const baseRenovateConfig = () => ({
  extends: ['config:recommended', 'helpers:pinGitHubActionDigests'],
  dependencyDashboard: true,
  minimumReleaseAge: '1 day',
  packageRules: [
    { matchUpdateTypes: ['major'], dependencyDashboardApproval: true },
  ],
});

test('renovate config without pin-lattice carve-outs is flagged when required', () => {
  const errors = validateRenovateConfigObject(
    '.github/renovate.json',
    baseRenovateConfig(),
    { requirePinLatticeCarveOuts: true },
  );
  assert.equal(errors.length, 3);
  for (const packageName of [
    '@module-federation/**',
    '@tanstack/**',
    'react-router',
  ]) {
    assert.ok(
      errors.some(error => error.includes(packageName)),
      `expected carve-out error for ${packageName}`,
    );
  }
});

test('renovate config with approval-gated carve-outs passes', () => {
  const config = baseRenovateConfig();
  config.packageRules.push(
    {
      matchPackageNames: ['@module-federation/**'],
      dependencyDashboardApproval: true,
    },
    {
      matchPackageNames: ['@tanstack/**'],
      dependencyDashboardApproval: true,
    },
    {
      matchPackageNames: ['react-router', 'react-router-dom'],
      dependencyDashboardApproval: true,
    },
  );
  assert.deepEqual(
    validateRenovateConfigObject('.github/renovate.json', config, {
      requirePinLatticeCarveOuts: true,
    }),
    [],
  );
});

test('template renovate config is not required to carry repo carve-outs', () => {
  assert.deepEqual(
    validateRenovateConfigObject(
      'packages/toolkit/create/template-workspace/.github/renovate.json',
      baseRenovateConfig(),
      { requirePinLatticeCarveOuts: false },
    ),
    [],
  );
});

test('the real repository tree passes the validator end to end', () => {
  assert.deepEqual(validateRepository(), []);
});
