// Consumer: BleedingDev release staging, publishing, and acceptance contracts.
import fsKit from '../../../lib/fs-kit.js';

const { repoRoot } = fsKit;

const npmPublishAttempts = 3;

const npmPublishRetryDelayMs = 15_000;

const npmRegistryOrigin = 'https://registry.npmjs.org';

const trustedPublishRepository = 'BleedingDev/ultramodern.js';

const trustedPublishRef = 'refs/heads/main-ultramodern';

const trustedPublishWorkflowPath =
  '.github/workflows/publish-bleedingdev.yml';

const trustedPublishOidcIssuer =
  'https://token.actions.githubusercontent.com';

const transientNpmPublishErrorPatterns = [
  /TLOG_CREATE_ENTRY_ERROR/u,
  /error creating tlog entry/u,
  /rekor\.sigstore\.dev/u,
  /ETIMEDOUT/u,
  /ECONNRESET/u,
  /EAI_AGAIN/u,
  /ESOCKETTIMEDOUT/u,
  /socket hang up/u,
];

const incorporatedModernCreateSourceName = '@modern-js/create';
const ultramodernCreateSourceName = '@modern-js/ultramodern-create';
const ultramodernCreateTargetName =
  '@bleedingdev/modern-js-ultramodern-create';
const retiredBleedingdevCreateTargetName = '@bleedingdev/modern-js-create';

// Sidecar republications are staged beside the cohort but never inside it:
// they keep their own stable versions and their own npm scope.
const sidecarScope = '@bleedingdev';
const sidecarStagingDirectory = 'sidecars';
const sidecarManifestFile = 'sidecars.json';
const sidecarAliasConsumerTargetName = '@bleedingdev/modern-js-image';

const createTemplateRequiredFiles = [
  'template-workspace/.agents/agent-reference-repos.json',
  'template-workspace/.codex/rstackjs-agent-skills-LICENSE',
  'template-workspace/.codex/skills-lock.json',
  'template-workspace/.codex/hooks.json',
  'template-workspace/.github/renovate.json',
  'template-workspace/.github/workflows/ultramodern-workspace-gates.yml.handlebars',
  'template-workspace/.gitignore.handlebars',
  'template-workspace/.mise.toml.handlebars',
];

export {
  createTemplateRequiredFiles,
  incorporatedModernCreateSourceName,
  npmPublishAttempts,
  npmPublishRetryDelayMs,
  npmRegistryOrigin,
  repoRoot,
  sidecarAliasConsumerTargetName,
  sidecarManifestFile,
  sidecarScope,
  sidecarStagingDirectory,
  trustedPublishOidcIssuer,
  trustedPublishRef,
  trustedPublishRepository,
  trustedPublishWorkflowPath,
  transientNpmPublishErrorPatterns,
  retiredBleedingdevCreateTargetName,
  ultramodernCreateSourceName,
  ultramodernCreateTargetName,
};
