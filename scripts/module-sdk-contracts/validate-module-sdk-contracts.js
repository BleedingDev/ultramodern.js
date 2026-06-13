#!/usr/bin/env node

const path = require('path');
const { parseCliArgs } = require('../lib/cli-kit');
const {
  readJsonFile,
  validateContractShape,
  validateManifests,
} = require('./validator');

const parseArgs = argv => {
  return parseCliArgs(argv, {
    defaults: {
      contractPath:
        'docs/super-app-rfc-adr/contracts/module-sdk-contracts.json',
      manifestPaths: [],
      manifestsDir: undefined,
      allowEmptyManifests: false,
      skipManifestValidation: false,
    },
    options: {
      contract: {
        key: 'contractPath',
        requiredValue: false,
      },
      manifest: {
        key: 'manifestPaths',
        multiple: true,
        requiredValue: false,
      },
      'manifest-dir': {
        key: 'manifestsDir',
        requiredValue: false,
      },
      'allow-empty-manifests': {
        key: 'allowEmptyManifests',
        type: 'boolean',
      },
      'skip-manifest-validation': {
        key: 'skipManifestValidation',
        type: 'boolean',
      },
    },
  });
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
