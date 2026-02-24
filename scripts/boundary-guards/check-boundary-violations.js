#!/usr/bin/env node

const path = require('path');
const { runBoundaryGuardChecks } = require('./validator');

const parseArgs = argv => {
  const parsed = {
    profilePath: 'scripts/boundary-guards/profile.json',
    allowEmptyManifests: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--profile':
        parsed.profilePath = argv[index + 1];
        index += 1;
        break;
      case '--allow-empty-manifests':
        parsed.allowEmptyManifests = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
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
