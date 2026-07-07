const {
  DEFAULT_OUTPUT_DIR,
  EXPECTED_BUILDER,
  EXPECTED_TARGET,
  SCHEMA_VERSION,
} = require('./constants');

const {
  resolveDefaultEvidencePath,
  validateCloudflareOutput,
} = require('./cloudflare-output');

const {
  extractDeploymentEvidence,
  joinUrl,
  writeEvidence,
} = require('./evidence');

async function loadZephyrAgent() {
  try {
    return require('zephyr-agent');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'zephyr-agent is not installed in this workspace. Install zephyr-agent@1.1.1 or run this wrapper from a generated app that provides it.',
      );
    }
    throw error;
  }
}

async function uploadCloudflareSsrToZephyr({
  rootDir = process.cwd(),
  outputDir = DEFAULT_OUTPUT_DIR,
  publicDir,
  baseURL = '/',
  evidencePath,
  uploadOutputToZephyr,
  generatedAt = new Date().toISOString(),
} = {}) {
  const validation = validateCloudflareOutput({
    rootDir,
    outputDir,
    publicDir,
  });
  const deploymentEvents = [];
  const resolvedEvidencePath =
    evidencePath || resolveDefaultEvidencePath(validation.outputDir);
  const uploader =
    uploadOutputToZephyr || (await loadZephyrAgent()).uploadOutputToZephyr;

  if (typeof uploader !== 'function') {
    throw new Error('zephyr-agent does not export uploadOutputToZephyr');
  }

  const uploadOptions = {
    rootDir: validation.rootDir,
    outputDir: validation.outputDir,
    publicDir: validation.publicDir,
    baseURL,
    builder: EXPECTED_BUILDER,
    target: EXPECTED_TARGET,
    ssr: true,
    hooks: {
      onDeployComplete: async deploymentInfo => {
        deploymentEvents.push(deploymentInfo);
      },
    },
  };

  const result = await uploader(uploadOptions);
  const deploymentInfo = deploymentEvents.at(-1) ?? null;
  const deployment = extractDeploymentEvidence({ result, deploymentInfo });
  const evidence = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    status: 'uploaded',
    zephyrAgent: {
      package: 'zephyr-agent',
      requiredApi: 'uploadOutputToZephyr',
      verifiedVersion: '1.1.1',
    },
    upload: {
      rootDir: uploadOptions.rootDir,
      outputDir: uploadOptions.outputDir,
      publicDir: uploadOptions.publicDir,
      baseURL: uploadOptions.baseURL,
      builder: uploadOptions.builder,
      target: uploadOptions.target,
      ssr: uploadOptions.ssr,
      entrypoint: validation.entrypoint,
    },
    cloudflare: {
      wrangler: validation.wrangler,
    },
    output: validation.outputSummary,
    deployment,
    publicUrls: {
      mfManifest: joinUrl(
        deployment.deploymentUrl,
        baseURL,
        'mf-manifest.json',
      ),
    },
    evidencePath: resolvedEvidencePath,
  };

  writeEvidence(evidence, resolvedEvidencePath);
  return evidence;
}

module.exports = {
  uploadCloudflareSsrToZephyr,
};
