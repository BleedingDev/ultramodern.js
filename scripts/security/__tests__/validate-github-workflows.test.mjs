import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectRunBlockInputInterpolations,
  collectUses,
  validateRenovateConfigObject,
  validateRepository,
  validateWorkflowContent,
} from '../validate-github-workflows.mjs';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const publishWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/publish-bleedingdev.yml',
);
const readinessWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/ultramodern-production-readiness.yml',
);

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
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must pin jdx\/mise-action@v3 to a full commit SHA/);
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

test('workflow_run exact head SHA checkout requires a same-repository guard on its job', () => {
  for (const checkoutJobIf of [
    '',
    "github.event.workflow_run.head_repository.full_name == github.repository || github.event_name == 'workflow_dispatch'",
  ]) {
    const errors = validateWorkflowContent(
      '.github/workflows/workflow-run-provenance.yml',
      workflowRunCheckoutWorkflow({ checkoutJobIf }),
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

test('workflow_run rejects untrusted checkout refs in YAML flow mappings', () => {
  const content = `name: Flow mapping
on: { workflow_run: { workflows: [Build], branches: [main-ultramodern] } }
permissions: { contents: read }
jobs:
  check:
    runs-on: ubuntu-latest
    steps: [{ uses: actions/checkout@9f698171ed81b15d1823a05fc7211befd50c8ae0, with: { ref: "\${{ github.event.workflow_run.head_branch }}" } }]
`;
  const errors = validateWorkflowContent(
    '.github/workflows/workflow-run-flow.yml',
    content,
  );
  assert.ok(
    errors.some(error =>
      error.includes('must not checkout untrusted event refs'),
    ),
  );
});

test('workflow_run rejects untrusted checkout refs in folded and literal scalars', () => {
  for (const scalar of ['>-', '|-']) {
    const content = workflowRunCheckoutWorkflow({
      ref: `${scalar}\n            \${{ github.event.workflow_run.head_branch }}`,
    });
    const errors = validateWorkflowContent(
      '.github/workflows/workflow-run-scalar.yml',
      content,
    );
    assert.ok(
      errors.some(error =>
        error.includes('must not checkout untrusted event refs'),
      ),
      `${scalar} must not hide an untrusted ref`,
    );
  }
});

test('workflow_run resolves environment indirection before allowing a checkout ref', () => {
  const content = workflowRunCheckoutWorkflow({
    ref: githubExpression('env.CHECKOUT_REF'),
  }).replace(
    'permissions:\n',
    `env:
  CHECKOUT_REF: >-
    \${{ github.event.workflow_run.head_branch }}
permissions:
`,
  );
  const errors = validateWorkflowContent(
    '.github/workflows/workflow-run-env.yml',
    content,
  );
  assert.ok(
    errors.some(error =>
      error.includes('must not checkout untrusted event refs'),
    ),
  );
});

test('workflow_run permits an exact head SHA through an environment only in the read-only no-secret model', () => {
  const content = workflowRunCheckoutWorkflow({
    ref: githubExpression('env.CHECKOUT_REF'),
  }).replace(
    'permissions:\n',
    `env:
  CHECKOUT_REF: \${{ github.event.workflow_run.head_sha }}
permissions:
`,
  );
  assert.deepEqual(
    validateWorkflowContent(
      '.github/workflows/workflow-run-env-exact.yml',
      content,
    ),
    [],
  );
});

test('workflow_run ignores secrets in a dispatch-only job guarded by conjunction', () => {
  assert.deepEqual(
    validateWorkflowContent(
      '.github/workflows/workflow-run-dispatch-secret.yml',
      workflowRunWithCloudflareSecretJob(),
    ),
    [],
  );
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

test('workflow_run exact head SHA checkout rejects negated or expression branch policies', () => {
  for (const branchPolicy of [
    "    branches: ['!main-ultramodern']\n",
    `    branches: ['${githubExpression('github.event.repository.default_branch')}']\n`,
  ]) {
    const errors = validateWorkflowContent(
      '.github/workflows/workflow-run-branch-policy.yml',
      workflowRunCheckoutWorkflow({ branchPolicy }),
    );
    assert.ok(
      errors.some(error =>
        error.includes('must not checkout untrusted event refs'),
      ),
    );
  }
});

test('workflow_run exact head SHA checkout remains valid with additional non-privileged triggers', () => {
  const content = workflowRunCheckoutWorkflow().replace(
    'permissions:\n',
    "  push:\n  schedule:\n    - cron: '0 0 * * *'\npermissions:\n",
  );
  assert.deepEqual(
    validateWorkflowContent(
      '.github/workflows/workflow-run-multi-trigger.yml',
      content,
    ),
    [],
  );
});

test('quoted root and job write permissions are elevated under privileged triggers', () => {
  const content = workflowRunCheckoutWorkflow({
    permissions: "  contents: 'write'\n",
  }).replace(
    '    runs-on: ubuntu-latest\n',
    "    permissions: 'write-all'\n    runs-on: ubuntu-latest\n",
  );
  const errors = validateWorkflowContent(
    '.github/workflows/workflow-run-quoted-permissions.yml',
    content,
  );
  assert.equal(
    errors.filter(error => error.includes('must not grant write permissions'))
      .length,
    2,
  );
});

test('dot and bracket secret notation are detected and deny exact SHA checkout trust', () => {
  const content = workflowRunCheckoutWorkflow().replace(
    'permissions:\n',
    `env:
  DOT_SECRET: \${{ secrets.RELEASE_TOKEN }}
  BRACKET_SECRET: \${{ secrets['RELEASE_TOKEN'] }}
permissions:
`,
  );
  const errors = validateWorkflowContent(
    '.github/workflows/workflow-run-secrets.yml',
    content,
  );
  assert.equal(
    errors.filter(error => error.includes('must not expose secrets')).length,
    2,
  );
  assert.ok(
    errors.some(error =>
      error.includes('must not checkout untrusted event refs'),
    ),
  );
});

test('dynamic bracket secret access is detected and denies exact SHA checkout trust', () => {
  const content = workflowRunCheckoutWorkflow().replace(
    'permissions:\n',
    `env:
  SECRET_NAME: RELEASE_TOKEN
  DYNAMIC_SECRET: \${{ secrets[env.SECRET_NAME] }}
permissions:
`,
  );
  const errors = validateWorkflowContent(
    '.github/workflows/workflow-run-dynamic-secret.yml',
    content,
  );
  assert.ok(errors.some(error => error.includes('must not expose secrets')));
  assert.ok(
    errors.some(error =>
      error.includes('must not checkout untrusted event refs'),
    ),
  );
});

test('bare secret contexts are detected and deny exact SHA checkout trust', () => {
  const content = workflowRunCheckoutWorkflow().replace(
    'permissions:\n',
    `env:
  SECRET_DUMP: \${{ toJSON(secrets) }}
permissions:
`,
  );
  const errors = validateWorkflowContent(
    '.github/workflows/workflow-run-bare-secret.yml',
    content,
  );
  assert.ok(errors.some(error => error.includes('must not expose secrets')));
  assert.ok(
    errors.some(error =>
      error.includes('must not checkout untrusted event refs'),
    ),
  );
});

test('checkout action matching is case-insensitive', () => {
  const errors = validateWorkflowContent(
    '.github/workflows/workflow-run-checkout-case.yml',
    workflowRunCheckoutWorkflow({
      ref: githubExpression('github.event.workflow_run.head_branch'),
    }).replace('actions/checkout@', 'AcTiOnS/ChEcKoUt@'),
  );
  assert.ok(
    errors.some(error =>
      error.includes('must not checkout untrusted event refs'),
    ),
  );
});

test('privileged workflows reject local reusable workflow delegation', () => {
  const content = `name: Local reusable delegation
on:
  workflow_run:
    workflows:
      - Build
    branches:
      - main-ultramodern
permissions:
  contents: read
jobs:
  delegated-event-ref:
    uses: ./.github/workflows/event-ref.yml
    with:
      ref: \${{ github.event.workflow_run.head_sha }}
  delegated-secrets:
    uses: ./.github/workflows/secrets.yml
    secrets: inherit
`;
  const errors = validateWorkflowContent(
    '.github/workflows/workflow-run-local-reusable.yml',
    content,
  );
  assert.equal(
    errors.filter(error =>
      error.includes(
        'must not delegate a privileged workflow to a local reusable workflow',
      ),
    ).length,
    2,
  );
});

test('workflow_run rejects an explicitly non-string checkout ref', () => {
  const errors = validateWorkflowContent(
    '.github/workflows/workflow-run-non-string-ref.yml',
    workflowRunCheckoutWorkflow({ ref: '12345' }),
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

test('release receipt verification requires an explicit authenticated run identity', () => {
  const content = compliantWorkflow.replace(
    'run: echo ok',
    `run: |
          node scripts/ultramodern-publish/run-release-acceptance.mjs \\
            --verify-receipt \\
            --manifest manifest.json \\
            --receipt acceptance-receipt.json`,
  );
  const errors = validateWorkflowContent(
    '.github/workflows/receipt-verifier.yml',
    content,
  );
  assert.equal(
    errors.filter(error => error.includes('authenticated --run-identity'))
      .length,
    1,
  );
  assert.deepEqual(
    validateWorkflowContent(
      '.github/workflows/receipt-verifier.yml',
      content.replace(
        '--receipt acceptance-receipt.json',
        [
          '--receipt acceptance-receipt.json \\',
          '            --run-identity "$PRODUCER_RUN_IDENTITY"',
        ].join('\n'),
      ),
    ),
    [],
  );
});

test('publish branches must converge on one deterministic structured outcome', () => {
  const source = fs.readFileSync(publishWorkflowPath, 'utf8');
  assert.deepEqual(
    validateWorkflowContent(
      '.github/workflows/publish-bleedingdev.yml',
      source,
    ),
    [],
  );

  const missing = source.replace(
    /\n {2}record-publish-outcome:[\s\S]*$/u,
    '\n',
  );
  assert.ok(
    validateWorkflowContent(
      '.github/workflows/publish-bleedingdev.yml',
      missing,
    ).some(error => error.includes('must converge on record-publish-outcome')),
  );

  const driftedName = source.replace(
    `name: ${githubExpression('steps.publish-outcome.outputs.artifact_name')}`,
    'name: bleedingdev-publish-outcome-renamed',
  );
  assert.ok(
    validateWorkflowContent(
      '.github/workflows/publish-bleedingdev.yml',
      driftedName,
    ).some(error => error.includes('deterministically named outcome artifact')),
  );
});

test('publish readiness fails closed around paginated authenticated outcome evidence', () => {
  const source = fs.readFileSync(readinessWorkflowPath, 'utf8');
  assert.deepEqual(
    validateWorkflowContent(
      '.github/workflows/ultramodern-production-readiness.yml',
      source,
    ),
    [],
  );

  const unpaginated = source.replace('gh api --paginate --slurp', 'gh api');
  assert.ok(
    validateWorkflowContent(
      '.github/workflows/ultramodern-production-readiness.yml',
      unpaginated,
    ).some(error => error.includes('list every artifact page')),
  );

  const unauthenticatedSkip = source.replace(
    "      needs.resolve-release-identity.outputs.dry_run == 'false' &&\n",
    '',
  );
  assert.ok(
    validateWorkflowContent(
      '.github/workflows/ultramodern-production-readiness.yml',
      unauthenticatedSkip,
    ).some(error =>
      error.includes('may skip only for an authenticated dry-run'),
    ),
  );

  const missingEvidenceSkip = source.replace(
    "fs.appendFileSync(process.env.GITHUB_OUTPUT, 'exists=true\\n');",
    "fs.appendFileSync(process.env.GITHUB_OUTPUT, 'exists=false\\n');\n          console.log('skipping release readiness');",
  );
  assert.ok(
    validateWorkflowContent(
      '.github/workflows/ultramodern-production-readiness.yml',
      missingEvidenceSkip,
    ).some(error => error.includes('must fail rather than skip')),
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
        uses: actions/checkout@9f698171ed81b15d1823a05fc7211befd50c8ae0 # v6.0.3
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
