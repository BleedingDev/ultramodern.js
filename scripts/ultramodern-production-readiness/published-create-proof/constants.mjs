import path from 'node:path';
import cliKit from '../../lib/cli-kit.js';
import fsKit from '../../lib/fs-kit.js';
import processKit from '../../lib/process-kit.js';

export const { parseCliArgs, rejectInlineOptionValues } = cliKit;
export const { readJsonFile, repoRoot, writeJsonFile } = fsKit;
export const { createProcessEnv, runCommand, writeStream } = processKit;
export const defaultCreatePackage = '@bleedingdev/modern-js-create';
export const defaultProjectName = 'ultramodern-ci-superapp';
export const defaultOut =
  '.modern/production-readiness/published-create-proof.json';
export const browserSmokeScript = path.join(
  repoRoot,
  'scripts/ultramodern-production-readiness/run-browser-smoke.mjs',
);
export const browserSmokePlaywrightPackage =
  process.env.ULTRAMODERN_BROWSER_SMOKE_PLAYWRIGHT_PACKAGE ??
  'playwright@1.60.0';
export const cloudflareDeployProofEvidenceId = 'cloudflare-deploy-proof';
export const cloudflareDeployProofSkippedReason =
  'Cloudflare deploy proof was skipped because --deploy-cloudflare was not provided.';
export const readableErpVerticalNames = [
  'inventory',
  'finance',
  'people',
  'analytics',
  'orders',
  'procurement',
  'billing',
  'logistics',
  'support',
  'compliance',
];
export const scaleProfiles = Object.freeze({
  'erp-10': Object.freeze({
    id: 'erp-10',
    verticalCount: 10,
  }),
  'erp-25': Object.freeze({
    id: 'erp-25',
    verticalCount: 25,
  }),
  'erp-50': Object.freeze({
    id: 'erp-50',
    verticalCount: 50,
  }),
});
