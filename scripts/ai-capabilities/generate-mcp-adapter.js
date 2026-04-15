#!/usr/bin/env node

const path = require('path');
const {
  DEFAULT_MCP_BRIDGE_SERVER_NAME,
  createMcpAdapterManifest,
  createMcporterConfig,
  loadAdapterInputFromContract,
  writeJsonFile,
} = require('./adapter');

const parseArgs = argv => {
  const parsed = {
    contractPath: 'docs/super-app-rfc-adr/contracts/ai-capabilities.json',
    outPath: '.modern/mcp/adapter-manifest.json',
    mcporterOutPath: '.modern/mcporter.json',
    bridgeCommand: process.execPath,
    bridgeArgs: undefined,
    serverName: DEFAULT_MCP_BRIDGE_SERVER_NAME,
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
      case '--mcporter-out':
        parsed.mcporterOutPath = argv[index + 1];
        index += 1;
        break;
      case '--bridge-command':
        parsed.bridgeCommand = argv[index + 1];
        index += 1;
        break;
      case '--bridge-args':
        parsed.bridgeArgs = argv[index + 1]
          .split(',')
          .map(item => item.trim())
          .filter(Boolean);
        index += 1;
        break;
      case '--server-name':
        parsed.serverName = argv[index + 1];
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
  const bridgeArgs =
    Array.isArray(args.bridgeArgs) && args.bridgeArgs.length > 0
      ? args.bridgeArgs
      : [
          path.join('scripts', 'ai-capabilities', 'mcp-cli-bridge.js'),
          '--contract',
          args.contractPath,
        ];
  const { contractPath, contract } = loadAdapterInputFromContract(
    args.contractPath,
  );

  const adapterManifest = createMcpAdapterManifest({
    contractPath,
    contract,
    bridgeCommand: args.bridgeCommand,
    bridgeArgs,
  });
  const adapterPath = writeJsonFile({
    filePath: args.outPath,
    payload: adapterManifest,
  });

  const mcporterConfig = createMcporterConfig({
    bridgeCommand: args.bridgeCommand,
    bridgeArgs,
    serverName: args.serverName,
  });
  const mcporterPath = writeJsonFile({
    filePath: args.mcporterOutPath,
    payload: mcporterConfig,
  });

  const summary = {
    contractPath: path.resolve(contractPath),
    adapterPath,
    mcporterPath,
    serverName: args.serverName,
    tools: adapterManifest.tools.map(tool => tool.mcp.tool),
  };
  console.log(
    `[mcp-adapter] generated artifacts:\n${JSON.stringify(summary, null, 2)}`,
  );
};

try {
  main();
} catch (error) {
  console.error(`[mcp-adapter] generation failed: ${error.message}`);
  process.exit(1);
}
