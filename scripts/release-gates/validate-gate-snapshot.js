#!/usr/bin/env node

const path = require('path');
const { parseCliArgs } = require('../lib/cli-kit');
const { validateGateSnapshotFile } = require('./validator');

const DEFAULT_SNAPSHOT_PATH = '.modern/contract-gates.json';

const parseArgs = argv => {
  return parseCliArgs(argv, {
    defaults: {
      snapshotPath:
        process.env.MODERN_CONTRACT_GATES_FILE || DEFAULT_SNAPSHOT_PATH,
      requiredGates: [],
    },
    options: {
      'snapshot-path': {
        key: 'snapshotPath',
        requiredValue: false,
      },
      'required-gate': {
        key: 'requiredGates',
        multiple: true,
        requiredValue: false,
      },
    },
  });
};

const main = args => {
  const report = validateGateSnapshotFile({
    snapshotPath: args.snapshotPath,
    requiredGateNames: args.requiredGates.filter(Boolean),
  });
  console.log(
    `[release-gates] Gate snapshot is valid:\n${JSON.stringify(report, null, 2)}`,
  );
};

try {
  const args = parseArgs(process.argv.slice(2));
  main(args);
} catch (error) {
  console.error(
    `[release-gates] Gate snapshot validation failed: ${error.message}`,
  );
  process.exit(1);
}
