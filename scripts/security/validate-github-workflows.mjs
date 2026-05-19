#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const workflowDirs = [
  '.github/workflows',
  'packages/toolkit/create/template/.github/workflows',
  'packages/toolkit/create/template-workspace/.github/workflows',
];
const sensitiveWorkflowPaths = new Set([
  '.github/workflows/publish-bleedingdev.yml',
  '.github/workflows/workflow-security.yml',
  'packages/toolkit/create/template/.github/workflows/ultramodern-gates.yml.handlebars',
  'packages/toolkit/create/template-workspace/.github/workflows/ultramodern-workspace-gates.yml.handlebars',
]);
const requiredSensitiveTokens = [
  'permissions:\n  contents: read',
  'persist-credentials: false',
  'timeout-minutes:',
  'egress-policy: audit',
];
const shaPattern = /^[a-f0-9]{40}$/;

function collectWorkflowFiles() {
  const files = [];
  for (const workflowDir of workflowDirs) {
    const absoluteDir = path.join(repoRoot, workflowDir);
    if (!fs.existsSync(absoluteDir)) {
      continue;
    }
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        /\.(?:ya?ml|ya?ml\.handlebars)$/u.test(entry.name)
      ) {
        files.push(path.join(workflowDir, entry.name));
      }
    }
  }
  return files.sort();
}

function readWorkflow(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
}

function collectUses(content) {
  return Array.from(content.matchAll(/^\s*uses:\s*([^@\s]+)@([^\s#]+)/gmu)).map(
    match => ({
      action: match[1],
      ref: match[2],
    }),
  );
}

function validateRenovateConfig(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return [`Missing ${relativePath}`];
  }

  const config = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
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
  return errors;
}

function validateWorkflow(relativePath) {
  const content = readWorkflow(relativePath);
  const errors = [];

  if (content.includes('pull_request_target')) {
    errors.push(`${relativePath} must not use pull_request_target`);
  }
  if (/\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b/.test(content)) {
    errors.push(
      `${relativePath} must not reference npm token environment variables`,
    );
  }

  if (!sensitiveWorkflowPaths.has(relativePath)) {
    return errors;
  }

  for (const token of requiredSensitiveTokens) {
    if (!content.includes(token)) {
      errors.push(`${relativePath} must include ${token.split('\n')[0]}`);
    }
  }

  for (const { action, ref } of collectUses(content)) {
    if (action.startsWith('./')) {
      continue;
    }
    if (!shaPattern.test(ref)) {
      errors.push(
        `${relativePath} must pin ${action}@${ref} to a full commit SHA`,
      );
    }
  }

  if (relativePath.includes('publish')) {
    if (!content.includes('id-token: write')) {
      errors.push(
        `${relativePath} must grant id-token: write for trusted publishing`,
      );
    }
    if (!content.includes('environment: npm-publish')) {
      errors.push(
        `${relativePath} must publish through the npm-publish environment`,
      );
    }
  }

  return errors;
}

function main() {
  const workflowErrors = collectWorkflowFiles().flatMap(validateWorkflow);
  const renovateErrors = [
    ...validateRenovateConfig('.github/renovate.json'),
    ...validateRenovateConfig(
      'packages/toolkit/create/template/.github/renovate.json',
    ),
    ...validateRenovateConfig(
      'packages/toolkit/create/template-workspace/.github/renovate.json',
    ),
  ];
  const errors = [...workflowErrors, ...renovateErrors];

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  console.log('GitHub workflow security validation passed');
}

main();
