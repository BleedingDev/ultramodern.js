#!/usr/bin/env node

const path = require('path');
const { validateMcpCliParity } = require('./validator');

const parseArgs = argv => {
  const parsed = {
    contractPath: 'docs/super-app-rfc-adr/contracts/ai-capabilities.json',
    outPath: '.modern/mcp-cli-parity.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--contract':
        parsed.contractPath = argv[index + 1];
        index += 1;
        break;
      case '--out':
        parsed.outPath = argv[index + 1];
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const result = validateMcpCliParity({
    contractPath: args.contractPath,
    outPath: args.outPath,
  });
  if (!result.report.passed) {
    throw new Error(
      `MCP/CLI parity failed. Missing CLI mappings for: ${result.report.missingCli.join(', ')}`,
    );
  }

  const summary = {
    contractPath: path.resolve(args.contractPath),
    reportPath: result.outPath,
    totals: result.report.totals,
  };
  console.log(
    `[mcp-cli-parity] validation passed:\n${JSON.stringify(summary, null, 2)}`,
  );
};

try {
  main();
} catch (error) {
  console.error(`[mcp-cli-parity] validation failed: ${error.message}`);
  process.exit(1);
}
