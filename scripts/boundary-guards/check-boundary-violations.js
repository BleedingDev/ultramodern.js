#!/usr/bin/env node

const path = require('path');
const { parseCliArgs } = require('../lib/cli-kit');
const { runBoundaryGuardChecks } = require('./validator');

const parseArgs = argv => {
  return parseCliArgs(argv, {
    defaults: {
      profilePath: 'scripts/boundary-guards/profile.json',
      allowEmptyManifests: false,
    },
    options: {
      profile: {
        key: 'profilePath',
        requiredValue: false,
      },
      'allow-empty-manifests': {
        key: 'allowEmptyManifests',
        type: 'boolean',
      },
    },
  });
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const report = runBoundaryGuardChecks({
    profilePath: path.resolve(args.profilePath),
    rootDir: process.cwd(),
    allowEmptyManifests: args.allowEmptyManifests,
  });

  console.log(
    `[boundary-guards] anti-pattern checks passed:\n${JSON.stringify(
      report,
      null,
      2,
    )}`,
  );
};

try {
  main();
} catch (error) {
  console.error(
    `[boundary-guards] anti-pattern checks failed: ${error.message}`,
  );
  process.exit(1);
}
