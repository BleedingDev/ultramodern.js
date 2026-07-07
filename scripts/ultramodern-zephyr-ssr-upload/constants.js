const path = require('node:path');

const SCHEMA_VERSION = 1;
const DEFAULT_OUTPUT_DIR = '.output';
const DEFAULT_EVIDENCE_FILE = 'zephyr-ssr-upload-evidence.json';
const EXPECTED_ENTRYPOINT = 'server/index.mjs';
const EXPECTED_BUILDER = 'modern-js';
const EXPECTED_TARGET = 'cloudflare';
const EXPECTED_ASSETS_BINDING = 'ASSETS';
const WORKER_MANIFEST_FILE = path.join('server', 'modern-worker-manifest.json');
const EFFECT_BFF_CLOUDFLARE_IMPORT_GUIDANCE =
  'Ensure the Effect BFF entry exists at api/index.ts or bff.effect.entry, and import Cloudflare edge handlers from @modern-js/plugin-bff/effect-edge instead of lambda/Hono server helpers.';

module.exports = {
  DEFAULT_EVIDENCE_FILE,
  DEFAULT_OUTPUT_DIR,
  EFFECT_BFF_CLOUDFLARE_IMPORT_GUIDANCE,
  EXPECTED_ASSETS_BINDING,
  EXPECTED_BUILDER,
  EXPECTED_ENTRYPOINT,
  EXPECTED_TARGET,
  SCHEMA_VERSION,
  WORKER_MANIFEST_FILE,
};
