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
 * It uses the repository's bundled js-yaml copy, so it remains runnable
 * without a root-level dependency install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../../packages/toolkit/utils/compiled/js-yaml/index.js';
import {
  conditionCalls,
  evaluateJobSchedule,
  parseJobCondition,
} from './github-job-condition.mjs';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const workflowDirs = [
  '.github/workflows',
  'packages/toolkit/create/template-workspace/.github/workflows',
];

const sensitiveWorkflowPaths = new Set([
  '.github/workflows/contract-gates.yml',
  '.github/workflows/publish-bleedingdev.yml',
  '.github/workflows/ultramodern-nightly.yml',
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
  const { value } = parseYaml(content);
  return value === undefined ? [] : collectActionUses(value);
}

const runInputPattern =
  /\$\{\{[^}]*\b(?:github\.event\.inputs|inputs)\s*\.[^}]*\}\}/;

const privilegedTriggerNames = ['pull_request_target', 'workflow_run'];
const exactWorkflowRunHeadShaRefPattern =
  /^\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}\s*(?:#.*)?$/u;

const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function parseYaml(content) {
  try {
    return { value: yaml.load(content) };
  } catch (error) {
    return { error };
  }
}

function parseWorkflow(content) {
  const parsed = parseYaml(content);
  if (!isObject(parsed.value)) {
    return {
      error: parsed.error ?? new Error('workflow root must be a mapping'),
    };
  }
  return { workflow: parsed.value };
}

const sourceLines = content => content.split('\n');

const sourceFinding = (content, matcher, fallback = '') => {
  const lines = sourceLines(content);
  const index = lines.findIndex(line => matcher.test(line));
  return {
    line: index === -1 ? 1 : index + 1,
    text: (lines[index] ?? fallback).trim(),
  };
};

const sourceFindingForValue = (content, value, fallback) => {
  const fragments = String(value)
    .split('\n')
    .map(fragment => fragment.trim())
    .filter(Boolean);
  const fragment = fragments.find(part => part.includes('${{')) ?? fragments[0];
  return sourceFinding(
    content,
    fragment
      ? new RegExp(escapeRegExp(fragment), 'u')
      : new RegExp(escapeRegExp(fallback), 'u'),
    fallback,
  );
};

function walkValues(value, visit, valuePath = []) {
  visit(value, valuePath);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkValues(item, visit, [...valuePath, index]),
    );
  } else if (isObject(value)) {
    Object.entries(value).forEach(([key, item]) =>
      walkValues(item, visit, [...valuePath, key]),
    );
  }
}

const collectActionUses = workflow => {
  const uses = [];
  walkValues(workflow, (value, valuePath) => {
    if (valuePath.at(-1) !== 'uses' || typeof value !== 'string') {
      return;
    }
    const separator = value.lastIndexOf('@');
    if (separator <= 0 || separator === value.length - 1) {
      return;
    }
    uses.push({
      action: value.slice(0, separator).trim(),
      ref: value.slice(separator + 1).trim(),
    });
  });
  return uses;
};

const normalizeNeeds = job =>
  typeof job?.needs === 'string'
    ? [job.needs]
    : Array.isArray(job?.needs)
      ? job.needs
      : [];

const workflowSteps = workflow =>
  isObject(workflow.jobs)
    ? Object.entries(workflow.jobs).flatMap(([jobId, job]) =>
        isObject(job) && Array.isArray(job.steps)
          ? job.steps
              .filter(isObject)
              .map((step, stepIndex) => ({ job, jobId, step, stepIndex }))
          : [],
      )
    : [];

const actionMatches = (step, action) =>
  typeof step.uses === 'string' &&
  step.uses.toLowerCase().startsWith(`${action.toLowerCase()}@`);

const runIncludes = (step, value) =>
  typeof step.run === 'string' && step.run.includes(value);

const hasDryRunPublishBranches = workflow => {
  const input = workflow.on?.workflow_dispatch?.inputs?.dry_run;
  const validation = workflow.jobs?.['validate-release'];
  const publication = workflow.jobs?.publish;
  return (
    isObject(input) &&
    isObject(validation) &&
    isObject(publication) &&
    typeof validation.if === 'string' &&
    validation.if.includes('inputs.dry_run == true') &&
    typeof publication.if === 'string' &&
    publication.if.includes('inputs.dry_run == false')
  );
};

function collectReceiptRunIdentityErrors(workflow, relativePath) {
  return workflowSteps(workflow).flatMap(({ jobId, step }) =>
    runIncludes(
      step,
      'scripts/ultramodern-publish/run-release-acceptance.mjs',
    ) &&
    runIncludes(step, '--verify-receipt') &&
    !runIncludes(step, '--run-identity')
      ? [
          `${relativePath} job ${jobId} receipt verification must pass an authenticated --run-identity`,
        ]
      : [],
  );
}

function collectPublishOutcomeErrors(workflow, relativePath) {
  if (!hasDryRunPublishBranches(workflow)) {
    return [];
  }
  const errors = [];
  const outcomeJob = workflow.jobs?.['record-publish-outcome'];
  if (!isObject(outcomeJob)) {
    return [
      `${relativePath} dry-run and publish branches must converge on record-publish-outcome`,
    ];
  }
  const needs = new Set(normalizeNeeds(outcomeJob));
  for (const requiredJob of ['accept-release', 'publish', 'validate-release']) {
    if (!needs.has(requiredJob)) {
      errors.push(
        `${relativePath} record-publish-outcome must depend on ${requiredJob}`,
      );
    }
  }
  const condition = typeof outcomeJob.if === 'string' ? outcomeJob.if : '';
  for (const requiredCondition of [
    'always()',
    "needs.validate-release.result == 'success'",
    "needs.publish.result == 'success'",
    "needs.validate-release.result == 'skipped'",
    "needs.publish.result == 'skipped'",
  ]) {
    if (!condition.includes(requiredCondition)) {
      errors.push(
        `${relativePath} record-publish-outcome must gate both exclusive successful branch results`,
      );
      break;
    }
  }
  const steps = Array.isArray(outcomeJob.steps)
    ? outcomeJob.steps.filter(isObject)
    : [];
  const createSteps = steps.filter(step =>
    runIncludes(step, 'publish-outcome.mjs create'),
  );
  const uploads = steps.filter(step =>
    actionMatches(step, 'actions/upload-artifact'),
  );
  if (createSteps.length !== 1) {
    errors.push(
      `${relativePath} record-publish-outcome must create exactly one structured outcome`,
    );
  } else if (
    !runIncludes(createSteps[0], '--dry-run') ||
    !runIncludes(createSteps[0], '--producer-run-identity') ||
    !runIncludes(createSteps[0], '--source-commit') ||
    !runIncludes(createSteps[0], '--version') ||
    !runIncludes(createSteps[0], '--run-id') ||
    !runIncludes(createSteps[0], '--run-attempt')
  ) {
    errors.push(
      `${relativePath} publish outcome must bind dry-run, source, version, producer, and workflow run identity`,
    );
  }
  if (
    uploads.length !== 1 ||
    uploads[0].with?.name !==
      ['${{', 'steps.publish-outcome.outputs.artifact_name', '}}'].join(' ') ||
    typeof uploads[0].with?.path !== 'string' ||
    !uploads[0].with.path
      .split('\n')
      .map(value => value.trim())
      .includes('.modern/bleedingdev-publish/publish-outcome.json')
  ) {
    errors.push(
      `${relativePath} record-publish-outcome must upload exactly one deterministically named outcome artifact`,
    );
  }

  const changeRecordJob = workflow.jobs?.['publish-change-record'];
  if (!isObject(changeRecordJob)) {
    errors.push(
      `${relativePath} authenticated publish outcome must converge on publish-change-record`,
    );
    return errors;
  }
  const changeRecordNeeds = normalizeNeeds(changeRecordJob);
  if (
    changeRecordNeeds.length !== 1 ||
    changeRecordNeeds[0] !== 'record-publish-outcome'
  ) {
    errors.push(
      `${relativePath} publish-change-record must depend only on record-publish-outcome`,
    );
  }

  let changeRecordCondition;
  try {
    changeRecordCondition = parseJobCondition(changeRecordJob.if);
  } catch {
    changeRecordCondition = undefined;
  }
  const successfulPublishResults = {
    'accept-published': 'success',
    'accept-release': 'success',
    'prepare-release': 'success',
    publish: 'success',
    'publish-security': 'success',
    'record-publish-outcome': 'success',
    'tractor-downstream': 'success',
    'validate-release': 'skipped',
  };
  const successfulPublishContext = {
    github: {
      actor: 'BleedingDev',
      ref: 'refs/heads/main-ultramodern',
      repository_owner: 'BleedingDev',
      triggering_actor: 'BleedingDev',
    },
    inputs: { dry_run: false },
    vars: {},
  };
  const schedulesChangeRecord = ({ context, results } = {}) =>
    evaluateJobSchedule({
      workflow,
      jobId: 'publish-change-record',
      results: results ?? successfulPublishResults,
      context: context ?? successfulPublishContext,
    });
  if (
    changeRecordCondition === undefined ||
    !conditionCalls(changeRecordCondition, 'always') ||
    !schedulesChangeRecord() ||
    schedulesChangeRecord({
      context: {
        ...successfulPublishContext,
        inputs: { dry_run: true },
      },
    }) ||
    ['failure', 'cancelled', 'skipped'].some(result =>
      schedulesChangeRecord({
        results: {
          ...successfulPublishResults,
          'record-publish-outcome': result,
        },
      }),
    )
  ) {
    errors.push(
      `${relativePath} publish-change-record must survive the intentional branch skip, require a successful authenticated outcome, and reject dry-runs`,
    );
  }
  return errors;
}

// Structural fail-closed contract for the trusted-publishing release workflow,
// previously enforced by scripts/ultramodern-publish/validate-publish-security.mjs.
// Consumer: .github/workflows/publish-bleedingdev.yml.
const bleedingdevPublishWorkflowPath =
  '.github/workflows/publish-bleedingdev.yml';

// Consumer: publish-bleedingdev.yml — `publish` mints the npm OIDC token
// (id-token: write) and `publish-change-record` commits the change record
// (contents: write). No other job in the release graph may hold either.
const bleedingdevElevatedPermissionJobs = Object.freeze([
  'publish',
  'publish-change-record',
]);
const bleedingdevGuardedPermissionScopes = Object.freeze([
  'contents',
  'id-token',
]);

// Consumer: publish-bleedingdev.yml — the closed release job graph, so a new job
// cannot be smuggled between the acceptance, publish, outcome, and record gates.
const bleedingdevPublishJobs = Object.freeze([
  'accept-published',
  'accept-release',
  'prepare-release',
  'publish',
  'publish-change-record',
  'publish-security',
  'qualify-source',
  'record-publish-outcome',
  'tractor-downstream',
  'validate-release',
]);

// Consumer: publish-bleedingdev.yml — @bleedingdev/* publishes latest-only.
const bleedingdevPublishTag = 'latest';

const elevatedPermissionScopes = (permissions, scopes) =>
  permissionIsWrite(permissions)
    ? [...scopes]
    : isObject(permissions)
      ? scopes.filter(scope => permissionIsWrite(permissions[scope]))
      : [];

function collectBleedingdevPublishStructureErrors(workflow, relativePath) {
  if (relativePath !== bleedingdevPublishWorkflowPath) {
    return [];
  }
  const errors = [];
  const jobs = isObject(workflow.jobs) ? workflow.jobs : {};

  for (const scope of elevatedPermissionScopes(
    workflow.permissions,
    bleedingdevGuardedPermissionScopes,
  )) {
    errors.push(
      `${relativePath} must not grant ${scope}: write at the workflow level`,
    );
  }
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!isObject(job) || bleedingdevElevatedPermissionJobs.includes(jobId)) {
      continue;
    }
    for (const scope of elevatedPermissionScopes(
      job.permissions,
      bleedingdevGuardedPermissionScopes,
    )) {
      errors.push(
        `${relativePath} job ${jobId} must not grant ${scope}: write; confined to ${bleedingdevElevatedPermissionJobs.join(
          ', ',
        )}`,
      );
    }
  }

  const actualJobs = Object.keys(jobs).sort();
  const unexpectedJobs = actualJobs.filter(
    jobId => !bleedingdevPublishJobs.includes(jobId),
  );
  const missingJobs = bleedingdevPublishJobs.filter(
    jobId => !actualJobs.includes(jobId),
  );
  if (unexpectedJobs.length > 0 || missingJobs.length > 0) {
    errors.push(
      `${relativePath} job set must be exactly ${bleedingdevPublishJobs.join(
        ', ',
      )}${
        unexpectedJobs.length > 0
          ? `; unexpected: ${unexpectedJobs.join(', ')}`
          : ''
      }${missingJobs.length > 0 ? `; missing: ${missingJobs.join(', ')}` : ''}`,
    );
  }

  const tag = isObject(workflow.env)
    ? workflow.env.BLEEDINGDEV_PUBLISH_TAG
    : undefined;
  if (tag !== bleedingdevPublishTag) {
    errors.push(
      `${relativePath} BLEEDINGDEV_PUBLISH_TAG must be ${bleedingdevPublishTag}, found ${String(
        tag,
      )}`,
    );
  }
  return errors;
}

const getTriggers = workflow => {
  const triggers = workflow.on;
  if (typeof triggers === 'string') {
    return [triggers];
  }
  if (Array.isArray(triggers)) {
    return triggers.filter(trigger => typeof trigger === 'string');
  }
  return isObject(triggers) ? Object.keys(triggers) : [];
};

const workflowRunConfig = workflow =>
  isObject(workflow.on) && isObject(workflow.on.workflow_run)
    ? workflow.on.workflow_run
    : undefined;

/**
 * Find `${{ inputs.* }}` / `${{ github.event.inputs.* }}` interpolations
 * inside `run:` scalars (inline or block). `env:`-routed inputs and `if:`
 * expressions are fine — only shell text is an injection vector.
 */
export function collectRunBlockInputInterpolations(content) {
  const { value } = parseYaml(content);
  if (value === undefined) {
    return [];
  }
  const findings = [];
  walkValues(value, (item, valuePath) => {
    if (
      valuePath.at(-1) === 'run' &&
      typeof item === 'string' &&
      runInputPattern.test(item)
    ) {
      findings.push(sourceFindingForValue(content, item, 'run:'));
    }
  });
  return findings;
}

const collectPrivilegedTriggers = workflow =>
  getTriggers(workflow).filter(trigger =>
    privilegedTriggerNames.includes(trigger),
  );

const permissionIsWrite = permission =>
  typeof permission === 'string' &&
  /^(?:write|write-all)$/iu.test(permission.trim());

const collectElevatedPermissionLines = (workflow, content) => {
  const findings = [];
  const collect = permissions => {
    if (permissionIsWrite(permissions)) {
      findings.push(
        sourceFindingForValue(content, permissions, 'permissions:'),
      );
      return;
    }
    if (!isObject(permissions)) {
      return;
    }
    for (const [scope, value] of Object.entries(permissions)) {
      if (permissionIsWrite(value)) {
        findings.push(
          sourceFinding(
            content,
            new RegExp(`${escapeRegExp(scope)}\\s*:.*(?:write)`, 'iu'),
            'permissions:',
          ),
        );
      }
    }
  };
  collect(workflow.permissions);
  if (isObject(workflow.jobs)) {
    Object.values(workflow.jobs).forEach(job => {
      if (isObject(job)) {
        collect(job.permissions);
      }
    });
  }
  return findings;
};

const isLiteralWorkflowRunBranch = value =>
  typeof value === 'string' &&
  value.length > 0 &&
  !/[\s#!$*?[\]{}\\]/u.test(value);

const hasLiteralWorkflowRunBranchRestriction = workflow => {
  const config = workflowRunConfig(workflow);
  return (
    isObject(config) &&
    Array.isArray(config.branches) &&
    config.branches.length > 0 &&
    config.branches.every(isLiteralWorkflowRunBranch)
  );
};

const secretExpressionPattern = /\$\{\{[^}]*\bsecrets\b[^}]*\}\}/u;

const collectSecretExposures = (workflow, content) => {
  const findings = [];
  walkValues(workflow, (value, valuePath) => {
    if (
      (valuePath.at(-1) === 'secrets' && value === 'inherit') ||
      (typeof value === 'string' && secretExpressionPattern.test(value))
    ) {
      findings.push({
        ...sourceFindingForValue(content, value, 'secrets:'),
        jobName:
          valuePath[0] === 'jobs' && typeof valuePath[1] === 'string'
            ? valuePath[1]
            : undefined,
      });
    }
  });
  return findings;
};

const unwrapIfExpression = value => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const expression = value.trim();
  const wrapped = expression.match(/^\$\{\{\s*(.*?)\s*\}\}$/u);
  return wrapped ? wrapped[1] : expression;
};

const workflowRunSameRepositoryGuardPatterns = [
  /^github\s*\.\s*event\s*\.\s*workflow_run\s*\.\s*head_repository\s*\.\s*full_name\s*==\s*github\s*\.\s*repository$/u,
  /^github\s*\.\s*repository\s*==\s*github\s*\.\s*event\s*\.\s*workflow_run\s*\.\s*head_repository\s*\.\s*full_name$/u,
];

const hasWorkflowRunSameRepositoryGuard = job => {
  const condition = unwrapIfExpression(job.if);
  if (!condition || condition.includes('||')) {
    return false;
  }
  return condition
    .split('&&')
    .map(conjunct => conjunct.trim())
    .some(conjunct =>
      workflowRunSameRepositoryGuardPatterns.some(pattern =>
        pattern.test(conjunct),
      ),
    );
};

const isJobLimitedToNonPrivilegedEvent = job => {
  const condition = unwrapIfExpression(job.if);
  if (!condition || condition.includes('||')) {
    return false;
  }
  const conjuncts = condition.split('&&').map(conjunct => conjunct.trim());
  if (conjuncts.some(conjunct => conjunct === '')) {
    return false;
  }
  const eventNameConjuncts = conjuncts.filter(conjunct =>
    /\bgithub\s*\.\s*event_name\b/u.test(conjunct),
  );
  if (eventNameConjuncts.length === 0) {
    return false;
  }
  const eventNames = eventNameConjuncts.map(conjunct => {
    const match = conjunct.match(
      /^github\s*\.\s*event_name\s*==\s*(['"])([A-Za-z_][\w-]*)\1$/u,
    );
    return match?.[2];
  });
  return (
    eventNames.every(Boolean) &&
    new Set(eventNames).size === 1 &&
    !privilegedTriggerNames.includes(eventNames[0])
  );
};

const isSecretReachableOnPrivilegedPath = (exposure, workflow) => {
  if (!exposure.jobName || !isObject(workflow.jobs?.[exposure.jobName])) {
    return true;
  }
  return !isJobLimitedToNonPrivilegedEvent(workflow.jobs[exposure.jobName]);
};

const getExpression = value => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = value.match(/^\s*\$\{\{\s*([^}]+?)\s*\}\}\s*$/u);
  return match?.[1];
};

const getEnvironmentReference = value => {
  const expression = getExpression(value);
  return expression?.match(/^env\s*\.\s*([A-Za-z_][\w-]*)$/u)?.[1];
};

const envValue = (name, step, job, workflow) => {
  for (const env of [step.env, job.env, workflow.env]) {
    if (
      isObject(env) &&
      Object.hasOwn(env, name) &&
      typeof env[name] === 'string'
    ) {
      return env[name];
    }
  }
  return undefined;
};

const resolveCheckoutRef = (ref, step, job, workflow) => {
  const name = getEnvironmentReference(ref);
  if (!name) {
    return { value: ref, viaEnvironment: false };
  }
  const value = envValue(name, step, job, workflow);
  return { value, viaEnvironment: true };
};

const isFullSha = value =>
  typeof value === 'string' && shaPattern.test(value.trim());

const isExactWorkflowRunHeadSha = value =>
  typeof value === 'string' && exactWorkflowRunHeadShaRefPattern.test(value);

const isCheckoutAction = uses =>
  typeof uses === 'string' &&
  uses.toLowerCase().startsWith('actions/checkout@');

const isLocalReusableWorkflow = uses =>
  typeof uses === 'string' &&
  /^\.\/\.github\/workflows\/[^\s]+\.ya?ml$/iu.test(uses.trim());

const collectLocalReusableWorkflowDelegations = (workflow, content) => {
  if (!isObject(workflow.jobs)) {
    return [];
  }
  return Object.values(workflow.jobs).flatMap(job =>
    isObject(job) && isLocalReusableWorkflow(job.uses)
      ? [sourceFindingForValue(content, job.uses, 'uses:')]
      : [],
  );
};

const collectUntrustedCheckoutRefs = (
  workflow,
  content,
  hasTrustedWorkflowRunHeadShaPolicy,
) => {
  const findings = [];
  if (!isObject(workflow.jobs)) {
    return findings;
  }
  for (const job of Object.values(workflow.jobs)) {
    if (!isObject(job) || !Array.isArray(job.steps)) {
      continue;
    }
    for (const step of job.steps) {
      if (
        !isObject(step) ||
        typeof step.uses !== 'string' ||
        !isCheckoutAction(step.uses) ||
        !isObject(step.with) ||
        !Object.hasOwn(step.with, 'ref')
      ) {
        continue;
      }
      if (typeof step.with.ref !== 'string') {
        findings.push(sourceFindingForValue(content, step.with.ref, 'ref:'));
        continue;
      }
      const resolved = resolveCheckoutRef(step.with.ref, step, job, workflow);
      if (
        isFullSha(resolved.value) ||
        (hasTrustedWorkflowRunHeadShaPolicy &&
          hasWorkflowRunSameRepositoryGuard(job) &&
          isExactWorkflowRunHeadSha(resolved.value))
      ) {
        continue;
      }
      findings.push(sourceFindingForValue(content, step.with.ref, 'ref:'));
    }
  }
  return findings;
};

const requiredSensitiveChecks = [
  {
    label: 'permissions: contents: read',
    test: workflow => workflow.permissions?.contents === 'read',
  },
  {
    label: 'persist-credentials: false',
    test: workflow =>
      workflowSteps(workflow).some(
        ({ step }) =>
          isCheckoutAction(step.uses) &&
          step.with?.['persist-credentials'] === false,
      ),
  },
  {
    label: 'timeout-minutes:',
    test: workflow =>
      Object.values(workflow.jobs ?? {}).some(
        job =>
          isObject(job) &&
          Number.isInteger(job['timeout-minutes']) &&
          job['timeout-minutes'] > 0,
      ),
  },
  {
    // Accept either egress mode: `block` is the stronger posture and must
    // never fail the gate.
    label: 'egress-policy: audit|block',
    test: workflow =>
      workflowSteps(workflow).some(
        ({ step }) =>
          actionMatches(step, 'step-security/harden-runner') &&
          ['audit', 'block'].includes(step.with?.['egress-policy']),
      ),
  },
];

export function validateWorkflowContent(relativePath, content, options = {}) {
  const allowlist = options.allowlist ?? ALLOWLIST;
  const sensitive =
    options.sensitive ?? sensitiveWorkflowPaths.has(relativePath);
  const parsed = parseWorkflow(content);
  if (!parsed.workflow) {
    const line = parsed.error?.mark?.line;
    const location = Number.isInteger(line) ? `:${line + 1}` : '';
    return [
      `${relativePath}${location} must contain valid workflow YAML: ${parsed.error.message}`,
    ];
  }
  const workflow = parsed.workflow;
  const privilegedTriggers = collectPrivilegedTriggers(workflow);
  const errors = [];
  const push = (rule, message) => {
    if (!isAllowed(allowlist, relativePath, rule, message)) {
      errors.push(message);
    }
  };

  if (getTriggers(workflow).includes('pull_request_target')) {
    push(
      'pull-request-target',
      `${relativePath} must not use pull_request_target`,
    );
  }
  if (privilegedTriggers.length > 0) {
    const triggerList = privilegedTriggers.join(', ');
    const elevatedPermissions = collectElevatedPermissionLines(
      workflow,
      content,
    );
    const reachableSecretExposures = collectSecretExposures(
      workflow,
      content,
    ).filter(exposure => isSecretReachableOnPrivilegedPath(exposure, workflow));
    for (const finding of elevatedPermissions) {
      push(
        'privileged-trigger-permissions',
        `${relativePath}:${finding.line} must not grant write permissions with privileged trigger (${triggerList}): ${finding.text}`,
      );
    }
    for (const finding of reachableSecretExposures) {
      push(
        'privileged-trigger-secrets',
        `${relativePath}:${finding.line} must not expose secrets with privileged trigger (${triggerList}): ${finding.text}`,
      );
    }
    const hasTrustedWorkflowRunHeadShaPolicy =
      privilegedTriggers.length === 1 &&
      privilegedTriggers[0] === 'workflow_run' &&
      hasLiteralWorkflowRunBranchRestriction(workflow) &&
      elevatedPermissions.length === 0 &&
      reachableSecretExposures.length === 0;
    for (const finding of collectLocalReusableWorkflowDelegations(
      workflow,
      content,
    )) {
      push(
        'privileged-trigger-local-reusable-workflow',
        `${relativePath}:${finding.line} must not delegate a privileged workflow to a local reusable workflow: ${finding.text}`,
      );
    }
    for (const finding of collectUntrustedCheckoutRefs(
      workflow,
      content,
      hasTrustedWorkflowRunHeadShaPolicy,
    )) {
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

  for (const { action, ref } of collectActionUses(workflow)) {
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

  if (!Object.hasOwn(workflow, 'permissions')) {
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

  for (const message of collectReceiptRunIdentityErrors(
    workflow,
    relativePath,
  )) {
    push('receipt-run-identity', message);
  }
  for (const message of collectPublishOutcomeErrors(workflow, relativePath)) {
    push('publish-outcome-contract', message);
  }
  for (const message of collectBleedingdevPublishStructureErrors(
    workflow,
    relativePath,
  )) {
    push('bleedingdev-publish-structure', message);
  }

  if (sensitive) {
    for (const check of requiredSensitiveChecks) {
      if (!check.test(workflow)) {
        push(
          'sensitive-hardening',
          `${relativePath} must include ${check.label}`,
        );
      }
    }

    if (relativePath.includes('publish')) {
      const oidcJobs = Object.values(workflow.jobs ?? {}).filter(
        job => isObject(job) && job.permissions?.['id-token'] === 'write',
      );
      if (oidcJobs.length === 0) {
        push(
          'trusted-publishing',
          `${relativePath} must grant id-token: write for trusted publishing`,
        );
      }
      if (!oidcJobs.some(job => job.environment === 'npm-publish')) {
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
