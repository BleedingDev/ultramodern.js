#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeStream } from './published-create-proof/constants.mjs';
import { main } from './published-create-proof/main.mjs';

export {
  assertGeneratedCohort,
  createCleanPnpmDlxEnv,
  createCloudflareDeployProofEvidence,
  createCloudflareProofArgs,
  createPnpmDlxArgs,
  createTopologyEvidence,
  generateVerticalNames,
  parseArgs,
  resolveCreatePackage,
  scaleProfiles,
} from './published-create-proof/index.mjs';

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  let exitCode = 1;
  try {
    exitCode = await main();
  } catch (error) {
    await writeStream(
      process.stderr,
      `[ultramodern-production-readiness] ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
  process.exit(exitCode);
}
