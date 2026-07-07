#!/usr/bin/env node

const {
  EXPECTED_ASSETS_BINDING,
  EXPECTED_BUILDER,
  EXPECTED_ENTRYPOINT,
  EXPECTED_TARGET,
} = require('./constants');

const {
  createOutputSummary,
  validateCloudflareOutput,
} = require('./cloudflare-output');

const { extractDeploymentEvidence, joinUrl } = require('./evidence');

const { uploadCloudflareSsrToZephyr } = require('./zephyr-upload');

const { main, parseArgs } = require('./cli');

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[zephyr-ssr-upload] ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_ASSETS_BINDING,
  EXPECTED_BUILDER,
  EXPECTED_ENTRYPOINT,
  EXPECTED_TARGET,
  createOutputSummary,
  extractDeploymentEvidence,
  joinUrl,
  parseArgs,
  uploadCloudflareSsrToZephyr,
  validateCloudflareOutput,
};
