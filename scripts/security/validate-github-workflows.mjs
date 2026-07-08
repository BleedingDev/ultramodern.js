#!/usr/bin/env node
/**
 * Repo-wide GitHub workflow security gate.
 *
 * Every workflow (plus the template-workspace handlebars workflow) is checked
 * for:
 *   - actions pinned to a full 40-hex commit SHA (local `./` actions exempt)
 *   - a top-level `permissions:` block (least privilege by default)
 *   - no `pull_request_target` trigger
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
export const ALLOWLIST = [];

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
