const fs = require('fs');
const path = require('path');

const { loadCapabilityContract } = require('./validator');

const DEFAULT_MCP_BRIDGE_SERVER_NAME = 'modernjs-ai-capabilities';

const isRecord = value =>
  value && typeof value === 'object' && !Array.isArray(value);

const resolveCommandParts = cli => {
  if (typeof cli.bin === 'string' && Array.isArray(cli.args)) {
    return {
      bin: cli.bin,
      args: [...cli.args],
    };
  }

  const command = typeof cli.command === 'string' ? cli.command.trim() : '';
  if (!command) {
    throw new Error('cli.command is required to resolve command parts');
  }

  const parts = command.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Unable to parse cli.command');
  }

  return {
    bin: parts[0],
    args: parts.slice(1),
  };
};

const serializeCliValue = value => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return JSON.stringify(value);
};

const validateInputAgainstSchema = (capability, input) => {
  if (!isRecord(input)) {
    throw new Error(
      `Capability "${capability.id}" expects an input object for tool "${capability.mcp.tool}"`,
    );
  }

  const schema = capability.mcp.inputSchema || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!(key in input)) {
      throw new Error(
        `Missing required input "${key}" for capability "${capability.id}"`,
      );
    }
  }

  if (schema.additionalProperties === false && isRecord(schema.properties)) {
    const known = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(input)) {
      if (!known.has(key)) {
        throw new Error(
          `Unknown input "${key}" for capability "${capability.id}"`,
        );
      }
    }
  }
};

const buildCliInvocation = (capability, input) => {
  validateInputAgainstSchema(capability, input);

  const cli = capability.cli || {};
  const commandParts = resolveCommandParts(cli);
  const argMap = isRecord(cli.argMap) ? cli.argMap : {};
  const args = [...commandParts.args];

  for (const [inputKey, flag] of Object.entries(argMap)) {
    if (typeof flag !== 'string' || flag.trim().length === 0) {
      continue;
    }

    const value = input[inputKey];
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'boolean') {
      if (value) {
        args.push(flag);
      }
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach(item => {
        const serialized = serializeCliValue(item);
        if (serialized !== undefined) {
          args.push(flag, serialized);
        }
      });
      continue;
    }

    const serialized = serializeCliValue(value);
    if (serialized !== undefined) {
      args.push(flag, serialized);
    }
  }

  return {
    command: commandParts.bin,
    args,
  };
};

const toMcpToolDescriptor = capability => ({
  name: capability.mcp.tool,
  description: capability.description,
  inputSchema: capability.mcp.inputSchema,
});

const toAdapterToolDescriptor = capability => {
  const { bin, args } = resolveCommandParts(capability.cli || {});
  return {
    id: capability.id,
    description: capability.description,
    sideEffect: capability.sideEffect,
    mcp: {
      tool: capability.mcp.tool,
      version: capability.mcp.version,
      inputSchema: capability.mcp.inputSchema,
      outputSchema: capability.mcp.outputSchema,
    },
    cli: {
      command: capability.cli.command,
      bin,
      args,
      argMap: capability.cli.argMap || {},
    },
  };
};

const createMcpAdapterManifest = ({
  contractPath,
  contract,
  bridgeCommand = process.execPath,
  bridgeArgs = [
    path.join('scripts', 'ai-capabilities', 'mcp-cli-bridge.js'),
    '--contract',
    path.relative(process.cwd(), contractPath),
  ],
}) => {
  const capabilities = contract.capabilities || [];
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceContractPath: path.resolve(contractPath),
    bridge: {
      type: 'cli-mcp-bridge',
      command: bridgeCommand,
      args: bridgeArgs,
    },
    tools: capabilities.map(toAdapterToolDescriptor),
  };
};

const createMcporterConfig = ({ bridgeCommand, bridgeArgs, serverName }) => ({
  mcpServers: {
    [serverName || DEFAULT_MCP_BRIDGE_SERVER_NAME]: {
      command: bridgeCommand,
      args: bridgeArgs,
    },
  },
});

const writeJsonFile = ({ filePath, payload }) => {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return resolved;
};

const loadAdapterInputFromContract = contractPath => {
  const loaded = loadCapabilityContract(contractPath);
  const toolByName = new Map();
  for (const capability of loaded.contract.capabilities || []) {
    toolByName.set(capability.mcp.tool, capability);
  }
  return {
    ...loaded,
    toolByName,
  };
};

module.exports = {
  DEFAULT_MCP_BRIDGE_SERVER_NAME,
  buildCliInvocation,
  createMcpAdapterManifest,
  createMcporterConfig,
  loadAdapterInputFromContract,
  serializeCliValue,
  toMcpToolDescriptor,
  validateInputAgainstSchema,
  writeJsonFile,
};
