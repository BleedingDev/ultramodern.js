#!/usr/bin/env node
import { isDirectRun } from './lib/direct-run.mjs';
import { parseArgs } from './lib/prepare-bleedingdev-packages/options.mjs';
import { prepareBleedingdevPackages } from './lib/prepare-bleedingdev-packages/workflow.mjs';

export {
  orderPublishItems,
  validateFullCohortManifest,
} from './lib/prepare-bleedingdev-packages/manifest.mjs';
export {
  assertRegistryTarballReachable,
  isTransientNpmPublishError,
  publishPackage,
  validateRegistryCohort,
} from './lib/prepare-bleedingdev-packages/registry.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await prepareBleedingdevPackages(options);
}

if (isDirectRun(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export { parseArgs };
