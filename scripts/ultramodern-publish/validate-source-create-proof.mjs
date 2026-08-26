#!/usr/bin/env node
// Consumer: root ultramodern:source-create-proof release gate.
// The proof itself is owned by run-release-acceptance.mjs; this file only
// preserves the zero-argument root command after the legacy metadata-only
// validator was retired.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as runReleaseAcceptance } from './run-release-acceptance.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const defaultManifestPath = path.join(
  repoRoot,
  '.modern/bleedingdev-publish/manifest.json',
);
const defaultReceiptPath = path.join(
  repoRoot,
  '.modern/bleedingdev-publish/acceptance-receipt.json',
);

function hasValueOption(argv, option) {
  return argv.some(
    argument => argument === option || argument.startsWith(`${option}=`),
  );
}

function sourceCreateProofArgs(argv, env = process.env) {
  const normalized = argv[0] === '--' ? argv.slice(1) : [...argv];
  if (
    normalized.includes('--verify-receipt') ||
    hasValueOption(normalized, '--mode')
  ) {
    throw new Error(
      'ultramodern:source-create-proof always executes source acceptance; use run-release-acceptance.mjs directly for other modes',
    );
  }
  if (hasValueOption(normalized, '--scale-profile')) {
    throw new Error(
      'ultramodern:source-create-proof always executes the erp-10 scale profile',
    );
  }

  if (!hasValueOption(normalized, '--manifest')) {
    normalized.push('--manifest', defaultManifestPath);
  }
  if (!hasValueOption(normalized, '--receipt')) {
    normalized.push('--receipt', defaultReceiptPath);
  }
  normalized.push('--scale-profile', 'erp-10');

  const hasWorkflowIdentity =
    env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID && env.GITHUB_RUN_ATTEMPT;
  if (!hasValueOption(normalized, '--run-identity') && !hasWorkflowIdentity) {
    normalized.push('--run-identity', 'local:source-create-proof');
  }
  return normalized;
}

async function main(
  argv = process.argv.slice(2),
  env = process.env,
  run = runReleaseAcceptance,
) {
  return run(sourceCreateProofArgs(argv, env), env);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

export { defaultManifestPath, defaultReceiptPath, main, sourceCreateProofArgs };
