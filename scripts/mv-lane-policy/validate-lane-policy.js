#!/usr/bin/env node

const path = require('path');

const {
  DEFAULT_POLICY_PATH,
  readJsonFile,
  validateLaneDefinitionsAgainstPolicy,
  validateLanePolicy,
} = require('./validator');

const printUsage = () => {
  console.error(
    [
      'Usage: node scripts/mv-lane-policy/validate-lane-policy.js [--policy <path>] [--lanes <path>]',
      '',
      'Without --lanes, validates the laneDefinitions embedded in the policy file.',
    ].join('\n'),
  );
};

const parseArgs = argv => {
  const options = {
    policyPath: DEFAULT_POLICY_PATH,
    laneDefinitionsPath: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--policy') {
      index += 1;
      if (!argv[index]) {
        throw new Error('--policy requires a path');
      }
      options.policyPath = path.resolve(process.cwd(), argv[index]);
    } else if (arg === '--lanes') {
      index += 1;
      if (!argv[index]) {
        throw new Error('--lanes requires a path');
      }
      options.laneDefinitionsPath = path.resolve(process.cwd(), argv[index]);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const run = argv => {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return undefined;
  }

  const policy = readJsonFile(options.policyPath);
  const summary = options.laneDefinitionsPath
    ? validateLaneDefinitionsAgainstPolicy({
        policy,
        lanes: readJsonFile(options.laneDefinitionsPath).laneDefinitions,
      })
    : validateLanePolicy(policy);

  console.log(
    `Validated ${String(summary.laneCount)} MV lane definitions for ${summary.policyName}.`,
  );
  console.log(`Production default lane: ${summary.productionDefaultLane}`);
  return summary;
};

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  run,
};
