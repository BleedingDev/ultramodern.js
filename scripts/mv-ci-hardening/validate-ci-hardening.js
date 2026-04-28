#!/usr/bin/env node

const { DEFAULT_PROFILE_PATH, loadCiHardeningProfile } = require('./validator');

const parseArgs = argv => {
  const args = {
    profilePath: DEFAULT_PROFILE_PATH,
    today: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') {
      args.profilePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--today') {
      args.today = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
};

const getUtcToday = () => new Date().toISOString().slice(0, 10);

const printHelp = () => {
  console.log(`Usage: node scripts/mv-ci-hardening/validate-ci-hardening.js [options]

Options:
  --profile <path>  Profile JSON to validate
  --today <date>    Override UTC validation date in YYYY-MM-DD format
  --help            Show this help
`);
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const { evidenceSummary } = loadCiHardeningProfile(args.profilePath, {
    today: args.today || getUtcToday(),
  });

  console.log(
    JSON.stringify(
      {
        status: 'passed',
        profile: evidenceSummary.name,
        validationDate: evidenceSummary.validationDate,
        checkCount: evidenceSummary.checkCount,
        checksByTier: evidenceSummary.checksByTier,
      },
      null,
      2,
    ),
  );
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  getUtcToday,
  parseArgs,
};
