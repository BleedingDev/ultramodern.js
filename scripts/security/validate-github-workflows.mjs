#!/usr/bin/env node
/**
 * Repo-wide GitHub workflow security gate.
 *
 * Every workflow (plus the template-workspace handlebars workflow) is checked
 * for:
 *   - actions pinned to a full 40-hex commit SHA (local `./` actions exempt)
 *   - a top-level `permissions:` block (least privilege by default)
 *   - no `pull_request_target` trigger
 *   - no privileged trigger (`pull_request_target` / `workflow_run`) combined
 *     with write permissions, secrets exposure, or checkout of untrusted refs
 *   - no npm token environment variables
 *   - no `${{ inputs.* }}` / `${{ github.event.inputs.* }}` interpolation
 *     inside `run:` blocks (shell-injection vector; route through `env:`)
 *
 * Sensitive workflows (publish/nightly/production-readiness/...) additionally
 * require persist-credentials: false, timeout-minutes, harden-runner egress
 * policy (audit or block), and the publish workflow must use OIDC trusted
 * publishing through the npm-publish environment.
 *
 * Intentional exceptions go into ALLOWLIST below with a written reason.
 *
 * Zero dependencies (node builtins only) so it runs before any install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const workflowDirs = [
  '.github/workflows',
  'packages/toolkit/create/template-workspace/.github/workflows',
];

const sensitiveWorkflowPaths = new Set([
  '.github/workflows/contract-gates.yml',
  '.github/workflows/publish-bleedingdev.yml',
  '.github/workflows/ultramodern-nightly.yml',
  '.github/workflows/ultramodern-production-readiness.yml',
  '.github/workflows/workflow-security.yml',
  '.github/workflows/superapp-certification.yml',
  'packages/toolkit/create/template-workspace/.github/workflows/ultramodern-workspace-gates.yml.handlebars',
]);

/**
 * Intentional, reviewed exceptions. Every entry MUST explain why the
 * exception is safe. `match` (optional) narrows the entry to error messages
 * containing that substring; without it the whole rule is waived for the
 * file.
 *
 * @type {Array<{ file: string, rule: string, match?: string, reason: string }>}
 */
export const ALLOWLIST = [
  {
    file: '.github/workflows/ultramodern-production-readiness.yml',
    rule: 'privileged-trigger-secrets',
    match: 'secrets.CLOUDFLARE',
    reason:
      "The Cloudflare deploy job that reads these secrets is guarded by `if: github.event_name == 'workflow_dispatch' && github.event.inputs.deploy_cloudflare == 'true'`, so the secrets are never reachable under the workflow_run trigger. The workflow_run path runs read-only proof steps on default-branch code and performs no untrusted-ref checkout.",
  },
];

const shaPattern = /^[a-f0-9]{40}$/;

function isAllowed(allowlist, relativePath, rule, message) {
  return allowlist.some(
    entry =>
      entry.file === relativePath &&
      entry.rule === rule &&
      (entry.match === undefined || message.includes(entry.match)),
  );
}

export function collectWorkflowFiles(rootDir = repoRoot) {
  const files = [];
  for (const workflowDir of workflowDirs) {
    const absoluteDir = path.join(rootDir, workflowDir);
    if (!fs.existsSync(absoluteDir)) {
      continue;
    }
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        /\.(?:ya?ml|ya?ml\.handlebars)$/u.test(entry.name)
      ) {
        files.push(path.posix.join(workflowDir, entry.name));
      }
    }
  }
  return files.sort();
}

export function collectUses(content) {
  return Array.from(
    content.matchAll(/^\s*(?:-\s+)?uses:\s*([^@\s]+)@([^\s#]+)/gmu),
  ).map(match => ({
    action: match[1],
    ref: match[2],
  }));
}

const runInputPattern =
  /\$\{\{[^}]*\b(?:github\.event\.inputs|inputs)\s*\.[^}]*\}\}/;

const privilegedTriggerNames = ['pull_request_target', 'workflow_run'];
const untrustedCheckoutRefPattern =
  /\$\{\{\s*(?:github\.head_ref|github\.event\.pull_request\.head\.(?:ref|sha)|github\.event\.workflow_run\.(?:head_branch|head_sha|pull_requests))/;
const exactWorkflowRunHeadShaRefPattern =
  /^\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}\s*(?:#.*)?$/u;

/**
 * Find `${{ inputs.* }}` / `${{ github.event.inputs.* }}` interpolations
 * inside `run:` scalars (inline or block). `env:`-routed inputs and `if:`
 * expressions are fine — only shell text is an injection vector.
 */
export function collectRunBlockInputInterpolations(content) {
  const findings = [];
  const lines = content.split('\n');
  let runKeyColumn = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (runKeyColumn >= 0) {
      if (line.trim() === '') {
        continue;
      }
      const indent = line.length - line.trimStart().length;
      if (indent > runKeyColumn) {
        if (runInputPattern.test(line)) {
          findings.push({ line: index + 1, text: line.trim() });
        }
        continue;
      }
      runKeyColumn = -1;
    }
    const match = line.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!match) {
      continue;
    }
    const rest = match[2].trim();
    if (/^[|>][+-]?\d*$/.test(rest) || rest === '') {
      runKeyColumn = line.indexOf('run:');
    } else if (runInputPattern.test(rest)) {
      findings.push({ line: index + 1, text: rest });
    }
  }
  return findings;
}

const collectPrivilegedTriggers = content =>
  privilegedTriggerNames.filter(trigger =>
    new RegExp(`\\b${trigger}\\b`, 'u').test(content),
  );

const collectElevatedPermissionLines = content => {
  const findings = [];
  const lines = content.split('\n');
  let permissionsColumn = -1;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (permissionsColumn >= 0) {
      const indent = line.length - line.trimStart().length;
      if (indent <= permissionsColumn) {
        permissionsColumn = -1;
      } else {
        const permission = trimmed.match(/^([a-z-]+):\s*([^#\s]+)/iu);
        if (permission && /^write\b/iu.test(permission[2])) {
          findings.push({ line: index + 1, text: trimmed });
        }
        continue;
      }
    }

    const match = line.match(/^(\s*)permissions:\s*(.*)$/u);
    if (!match) {
      continue;
    }

    const rest = match[2].trim();
    if (/^write-all\b/iu.test(rest) || /\b[a-z-]+\s*:\s*write\b/iu.test(rest)) {
      findings.push({ line: index + 1, text: trimmed });
    }

    if (rest === '') {
      permissionsColumn = match[1].length;
    }
  }

  return findings;
};

const isLiteralWorkflowRunBranch = value => {
  const literal = value.trim();
  const quote = literal.at(0);
  const quoted = quote === '"' || quote === "'";
  if (quoted && !literal.endsWith(quote)) {
    return false;
  }
  const branch = quoted ? literal.slice(1, -1) : literal;

  return branch.length > 0 && !/[\s#!$*?[\]{}\\]/u.test(branch);
};

/**
 * Check only the literal `on.workflow_run.branches` form that can bind an
 * event SHA to a reviewed branch. Unsupported YAML shapes fail closed.
 */
const hasLiteralWorkflowRunBranchRestriction = content => {
  const lines = content.split('\n');
  const onIndex = lines.findIndex(line => /^on:\s*(?:#.*)?$/u.test(line));
  if (onIndex === -1) {
    return false;
  }

  const onColumn = lines[onIndex].length - lines[onIndex].trimStart().length;
  let triggerColumn = -1;

  for (let index = onIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const column = line.length - line.trimStart().length;
    if (column <= onColumn) {
      break;
    }
    if (triggerColumn === -1) {
      triggerColumn = column;
    }
    if (
      column !== triggerColumn ||
      !/^workflow_run:\s*(?:#.*)?$/u.test(trimmed)
    ) {
      continue;
    }

    for (index += 1; index < lines.length; index++) {
      const branchLine = lines[index];
      const branchTrimmed = branchLine.trim();
      if (!branchTrimmed || branchTrimmed.startsWith('#')) {
        continue;
      }

      const branchColumn = branchLine.length - branchLine.trimStart().length;
      if (branchColumn <= column) {
        return false;
      }
      if (!/^branches:\s*$/u.test(branchTrimmed)) {
        continue;
      }

      const branches = [];
      let branchItemColumn = -1;
      for (index += 1; index < lines.length; index++) {
        const itemLine = lines[index];
        const itemTrimmed = itemLine.trim();
        if (!itemTrimmed || itemTrimmed.startsWith('#')) {
          continue;
        }

        const itemColumn = itemLine.length - itemLine.trimStart().length;
        if (itemColumn <= branchColumn) {
          break;
        }
        if (branchItemColumn === -1) {
          branchItemColumn = itemColumn;
        }
        const item = itemTrimmed.match(/^-\s+(.+)$/u);
        if (itemColumn !== branchItemColumn || !item) {
          return false;
        }
        branches.push(item[1]);
      }
      return branches.length > 0 && branches.every(isLiteralWorkflowRunBranch);
    }
  }

  return false;
};

const collectSecretExposures = content =>
  content
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(
      finding =>
        finding.text &&
        !finding.text.startsWith('#') &&
        (/\$\{\{\s*secrets\./u.test(finding.text) ||
          /^secrets:\s*inherit\b/iu.test(finding.text)),
    );

const collectUntrustedCheckoutRefs = content => {
  const findings = [];
  const lines = content.split('\n');
  let inCheckoutStep = false;
  let currentStepColumn = -1;
  const allowsExactWorkflowRunHeadSha =
    hasLiteralWorkflowRunBranchRestriction(content) &&
    collectElevatedPermissionLines(content).length === 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    const stepStart = line.match(/^(\s*)-\s+/u);

    if (stepStart) {
      currentStepColumn = stepStart[1].length;
      inCheckoutStep = /(?:^|\s)uses:\s*actions\/checkout@[^\s#]+/u.test(line);
      if (inCheckoutStep) {
        continue;
      }
    } else if (
      currentStepColumn >= 0 &&
      trimmed &&
      line.length - line.trimStart().length <= currentStepColumn
    ) {
      inCheckoutStep = false;
      currentStepColumn = -1;
    }

    if (
      currentStepColumn >= 0 &&
      /^\s*uses:\s*actions\/checkout@[^\s#]+/u.test(line)
    ) {
      inCheckoutStep = true;
      continue;
    }

    if (!inCheckoutStep) {
      continue;
    }

    const ref = line.match(/^\s*ref:\s*(.*)$/u);
    if (
      ref &&
      untrustedCheckoutRefPattern.test(ref[1]) &&
      !(
        allowsExactWorkflowRunHeadSha &&
        exactWorkflowRunHeadShaRefPattern.test(ref[1])
      )
    ) {
      findings.push({ line: index + 1, text: line.trim() });
    }
  }

  return findings;
};

const requiredSensitiveChecks = [
  {
    label: 'permissions: contents: read',
    test: content => content.includes('permissions:\n  contents: read'),
  },
  {
    label: 'persist-credentials: false',
    test: content => content.includes('persist-credentials: false'),
  },
  {
    label: 'timeout-minutes:',
    test: content => content.includes('timeout-minutes:'),
  },
  {
    // Accept either egress mode: `block` is the stronger posture and must
    // never fail the gate.
    label: 'egress-policy: audit|block',
    test: content => /egress-policy:\s*(?:audit|block)\b/.test(content),
  },
];

export function validateWorkflowContent(relativePath, content, options = {}) {
  const allowlist = options.allowlist ?? ALLOWLIST;
  const sensitive =
    options.sensitive ?? sensitiveWorkflowPaths.has(relativePath);
  const privilegedTriggers = collectPrivilegedTriggers(content);
  const errors = [];
  const push = (rule, message) => {
    if (!isAllowed(allowlist, relativePath, rule, message)) {
      errors.push(message);
    }
  };

  if (content.includes('pull_request_target')) {
    push(
      'pull-request-target',
      `${relativePath} must not use pull_request_target`,
    );
  }
  if (privilegedTriggers.length > 0) {
    const triggerList = privilegedTriggers.join(', ');
    for (const finding of collectElevatedPermissionLines(content)) {
      push(
        'privileged-trigger-permissions',
        `${relativePath}:${finding.line} must not grant write permissions with privileged trigger (${triggerList}): ${finding.text}`,
      );
    }
    for (const finding of collectSecretExposures(content)) {
      push(
        'privileged-trigger-secrets',
        `${relativePath}:${finding.line} must not expose secrets with privileged trigger (${triggerList}): ${finding.text}`,
      );
    }
    for (const finding of collectUntrustedCheckoutRefs(content)) {
      push(
        'privileged-trigger-checkout-ref',
        `${relativePath}:${finding.line} must not checkout untrusted event refs with privileged trigger (${triggerList}): ${finding.text}`,
      );
    }
  }
  if (/\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b/.test(content)) {
    push(
      'npm-token',
      `${relativePath} must not reference npm token environment variables`,
    );
  }

  for (const { action, ref } of collectUses(content)) {
    if (action.startsWith('./')) {
      continue;
    }
    if (!shaPattern.test(ref)) {
      push(
        'sha-pinned-actions',
        `${relativePath} must pin ${action}@${ref} to a full commit SHA`,
      );
    }
  }

  if (!/^permissions:/m.test(content)) {
    push(
      'permissions-block',
      `${relativePath} must declare a top-level permissions block`,
    );
  }

  for (const finding of collectRunBlockInputInterpolations(content)) {
    push(
      'run-input-interpolation',
      `${relativePath}:${finding.line} must not interpolate workflow inputs into run blocks (route through env): ${finding.text}`,
    );
  }

  if (sensitive) {
    for (const check of requiredSensitiveChecks) {
      if (!check.test(content)) {
        push(
          'sensitive-hardening',
          `${relativePath} must include ${check.label}`,
        );
      }
    }

    if (relativePath.includes('publish')) {
      if (!content.includes('id-token: write')) {
        push(
          'trusted-publishing',
          `${relativePath} must grant id-token: write for trusted publishing`,
        );
      }
      if (!content.includes('environment: npm-publish')) {
        push(
          'trusted-publishing',
          `${relativePath} must publish through the npm-publish environment`,
        );
      }
    }
  }

  return errors;
}

/**
 * The repo-level renovate config must keep the fork's exact-pin lattice out
 * of the grouped weekly PR; each of these packages has a pinned twin
 * (pnpm patches, workspace overrides, create versions.ts, release gates)
 * that must move in lockstep.
 */
const requiredPinLatticeCarveOuts = [
  '@module-federation/**',
  '@tanstack/**',
  'react-router',
];

export function validateRenovateConfigObject(
  relativePath,
  config,
  options = {},
) {
  const errors = [];
  if (config.dependencyDashboard !== true) {
    errors.push(`${relativePath} must enable dependencyDashboard`);
  }
  if (config.minimumReleaseAge !== '1 day') {
    errors.push(`${relativePath} must set minimumReleaseAge to 1 day`);
  }
  if (!config.extends?.includes('helpers:pinGitHubActionDigests')) {
    errors.push(
      `${relativePath} must pin GitHub Action digests through Renovate`,
    );
  }
  if (
    !config.packageRules?.some(
      rule =>
        rule.dependencyDashboardApproval === true &&
        rule.matchUpdateTypes?.includes('major'),
    )
  ) {
    errors.push(
      `${relativePath} must require dashboard approval for major updates`,
    );
  }
  if (options.requirePinLatticeCarveOuts) {
    for (const packageName of requiredPinLatticeCarveOuts) {
      if (
        !config.packageRules?.some(
          rule =>
            rule.dependencyDashboardApproval === true &&
            rule.matchPackageNames?.includes(packageName),
        )
      ) {
        errors.push(
          `${relativePath} must carve ${packageName} out of grouped updates (exact-pin lattice; see pnpm-workspace.yaml patches/overrides)`,
        );
      }
    }
  }
  return errors;
}

function validateRenovateConfigFile(rootDir, relativePath, options) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return [`Missing ${relativePath}`];
  }
  const config = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
  return validateRenovateConfigObject(relativePath, config, options);
}

export function validateRepository(rootDir = repoRoot) {
  const workflowErrors = collectWorkflowFiles(rootDir).flatMap(relativePath =>
    validateWorkflowContent(
      relativePath,
      fs.readFileSync(path.join(rootDir, relativePath), 'utf-8'),
    ),
  );
  const renovateErrors = [
    ...validateRenovateConfigFile(rootDir, '.github/renovate.json', {
      requirePinLatticeCarveOuts: true,
    }),
    ...validateRenovateConfigFile(
      rootDir,
      'packages/toolkit/create/template-workspace/.github/renovate.json',
      { requirePinLatticeCarveOuts: false },
    ),
  ];
  return [...workflowErrors, ...renovateErrors];
}

function main() {
  const errors = validateRepository();
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }
  console.log('GitHub workflow security validation passed');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
