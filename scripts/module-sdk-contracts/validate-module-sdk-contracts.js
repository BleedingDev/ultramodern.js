#!/usr/bin/env node

const path = require('path');
const {
  readJsonFile,
  validateContractShape,
  validateManifests,
} = require('./validator');

const parseArgs = argv => {
  const parsed = {
    contractPath: 'docs/super-app-rfc-adr/contracts/module-sdk-contracts.json',
    manifestPaths: [],
    manifestsDir: undefined,
    allowEmptyManifests: false,
    skipManifestValidation: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--contract':
        parsed.contractPath = argv[index + 1];
        index += 1;
        break;
      case '--manifest':
        parsed.manifestPaths.push(argv[index + 1]);
        index += 1;
        break;
      case '--manifest-dir':
        parsed.manifestsDir = argv[index + 1];
        index += 1;
        break;
      case '--allow-empty-manifests':
        parsed.allowEmptyManifests = true;
        break;
      case '--skip-manifest-validation':
        parsed.skipManifestValidation = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const contractPath = path.resolve(args.contractPath);
  const contract = readJsonFile(contractPath);
  validateContractShape(contract);

  const manifestReport = args.skipManifestValidation
    ? { validated: [] }
    : validateManifests({
        contract,
        manifestPaths: args.manifestPaths,
        manifestsDir: args.manifestsDir,
        allowEmpty: args.allowEmptyManifests,
      });

  const summary = {
    contractPath,
    schemaVersion: contract.schemaVersion,
    profiles: Object.keys(contract.profiles || {}).length,
    validatedManifests: manifestReport.validated.length,
    skipManifestValidation: args.skipManifestValidation,
  };

  console.log(
    `[module-sdk-contracts] validation passed:\n${JSON.stringify(summary, null, 2)}`,
  );
};

try {
  main();
} catch (error) {
  console.error(`[module-sdk-contracts] validation failed: ${error.message}`);
  process.exit(1);
}
