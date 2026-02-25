#!/usr/bin/env node

const path = require('path');
const { validateGateSnapshotFile } = require('./validator');

const DEFAULT_SNAPSHOT_PATH = '.modern/contract-gates.json';

const parseArgs = argv => {
  const parsed = {
    snapshotPath:
      process.env.MODERN_CONTRACT_GATES_FILE || DEFAULT_SNAPSHOT_PATH,
    requiredGates: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--snapshot-path':
        parsed.snapshotPath = argv[index + 1];
        index += 1;
        break;
      case '--required-gate':
        parsed.requiredGates.push(argv[index + 1]);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
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
