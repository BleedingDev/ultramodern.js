#!/usr/bin/env node
import path from 'node:path';
import fsKit from '../lib/fs-kit.js';
import { isDirectRun } from './lib/direct-run.mjs';
import { parseArgs } from './lib/source-create-proof/options.mjs';
import {
  errorProof,
  validateSourceProof,
} from './lib/source-create-proof/proof.mjs';

const { writeJsonFile } = fsKit;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const proof = validateSourceProof(options);
    console.log(
      'Pre-publish source proof passed for ' +
        proof.cohort.packageCount +
        ' package(s); wrote ' +
        path.relative(options.repoRoot, options.outPath),
    );
  } catch (error) {
    writeJsonFile(options.outPath, errorProof({ ...options, error }));
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (isDirectRun(import.meta.url)) {
  await main();
}

export { errorProof, parseArgs, validateSourceProof };
