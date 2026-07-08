#!/usr/bin/env node

const path = require('path');
const { parseArgs } = require('util');

const {
  DEFAULT_ALLOWLIST_PATH,
  DEFAULT_BASE_REF,
  checkForkImportBoundary,
  formatBoundaryReport,
  writeAllowlist,
} = require('./checker');

const parseCliArgs = argv =>
  parseArgs({
    args: argv,
    strict: true,
    options: {
      'base-ref': {
        type: 'string',
        default: DEFAULT_BASE_REF,
      },
      allowlist: {
        type: 'string',
        default: DEFAULT_ALLOWLIST_PATH,
      },
      root: {
        type: 'string',
        default: process.cwd(),
      },
      'write-allowlist': {
        type: 'boolean',
        default: false,
      },
      json: {
        type: 'boolean',
        default: false,
      },
    },
  }).values;

const main = () => {
  const args = parseCliArgs(process.argv.slice(2));
  const rootDir = path.resolve(args.root);
  const allowlistPath = path.resolve(args.allowlist);

  if (args['write-allowlist']) {
    const report = writeAllowlist({
      rootDir,
      baseRef: args['base-ref'],
      allowlistPath,
    });

    console.log(
      `[ultramodern-boundary] wrote ${allowlistPath} with ${String(
        report.violations.length,
      )} current violations from ${String(report.scannedFiles)} files`,
    );
    return;
  }

  const report = checkForkImportBoundary({
    rootDir,
    baseRef: args['base-ref'],
    allowlistPath,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatBoundaryReport(report));
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
};

try {
  main();
} catch (error) {
  console.error(`[ultramodern-boundary] ${error.message}`);
  process.exit(1);
}
