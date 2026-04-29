const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const ALLOWED_SIDE_EFFECTS = new Set(['read', 'write']);

const readJsonFile = filePath => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const ensureFileExists = filePath => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
};

const isRecord = value =>
  value && typeof value === 'object' && !Array.isArray(value);

const ensureJsonSchema = (schema, capabilityId, schemaLabel) => {
  if (!isRecord(schema)) {
    throw new Error(
      `Capability "${capabilityId}" is missing mcp.${schemaLabel}`,
    );
  }
  if (typeof schema.type !== 'string' || schema.type.trim().length === 0) {
    throw new Error(
      `Capability "${capabilityId}" has invalid mcp.${schemaLabel}.type`,
    );
  }
};

const validateCliDescriptor = capability => {
  if (!isRecord(capability.cli)) {
    throw new Error(`Capability "${capability.id}" is missing cli descriptor`);
  }
  if (
    typeof capability.cli.command !== 'string' ||
    capability.cli.command.trim().length === 0
  ) {
    throw new Error(`Capability "${capability.id}" is missing cli.command`);
  }
  if (
    typeof capability.cli.bin !== 'string' ||
    capability.cli.bin.trim().length === 0
  ) {
    throw new Error(`Capability "${capability.id}" is missing cli.bin`);
  }
  if (
    !Array.isArray(capability.cli.args) ||
    capability.cli.args.length === 0 ||
    capability.cli.args.some(
      item => typeof item !== 'string' || item.trim().length === 0,
    )
  ) {
    throw new Error(`Capability "${capability.id}" has invalid cli.args`);
  }
  if (capability.cli.argMap !== undefined && !isRecord(capability.cli.argMap)) {
    throw new Error(`Capability "${capability.id}" has invalid cli.argMap`);
  }
};

const validateCapabilityShape = capability => {
  if (!isRecord(capability)) {
    throw new Error('Capability entry must be an object');
  }

  if (typeof capability.id !== 'string' || capability.id.trim().length === 0) {
    throw new Error('Capability id must be a non-empty string');
  }

  if (
    typeof capability.description !== 'string' ||
    capability.description.trim().length === 0
  ) {
    throw new Error(`Capability "${capability.id}" is missing description`);
  }

  if (!ALLOWED_SIDE_EFFECTS.has(capability.sideEffect)) {
    throw new Error(
      `Capability "${capability.id}" has invalid sideEffect "${String(capability.sideEffect)}"`,
    );
  }

  if (
    !isRecord(capability.mcp) ||
    typeof capability.mcp.tool !== 'string' ||
    capability.mcp.tool.trim().length === 0
  ) {
    throw new Error(`Capability "${capability.id}" is missing mcp.tool`);
  }
  if (
    typeof capability.mcp.version !== 'string' ||
    capability.mcp.version.trim().length === 0
  ) {
    throw new Error(`Capability "${capability.id}" is missing mcp.version`);
  }
  ensureJsonSchema(capability.mcp.inputSchema, capability.id, 'inputSchema');
  ensureJsonSchema(capability.mcp.outputSchema, capability.id, 'outputSchema');

  validateCliDescriptor(capability);
};

const validateContractShape = contract => {
  if (!isRecord(contract)) {
    throw new Error('AI capability contract must be a JSON object');
  }
  if (contract.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion: ${String(contract.schemaVersion)}.`,
    );
  }
  if (!Array.isArray(contract.capabilities)) {
    throw new Error('Contract must contain capabilities array');
  }

  const seenIds = new Set();
  for (const capability of contract.capabilities) {
    validateCapabilityShape(capability);
    const id = capability.id.trim();
    if (seenIds.has(id)) {
      throw new Error(`Duplicate capability id: ${id}`);
    }
    seenIds.add(id);
  }
};

const loadCapabilityContract = contractPath => {
  const resolvedContractPath = path.resolve(contractPath);
  ensureFileExists(resolvedContractPath);
  const contract = readJsonFile(resolvedContractPath);
  validateContractShape(contract);
  return {
    contractPath: resolvedContractPath,
    contract,
  };
};

const generateParityReport = ({ contractPath, contract }) => {
  const capabilities = contract.capabilities || [];
  const withMcp = capabilities.filter(
    item =>
      isRecord(item) &&
      isRecord(item.mcp) &&
      typeof item.mcp.tool === 'string' &&
      item.mcp.tool.trim().length > 0,
  );
  const missingCli = withMcp
    .filter(
      item =>
        !isRecord(item.cli) ||
        typeof item.cli.command !== 'string' ||
        item.cli.command.trim().length === 0,
    )
    .map(item => item.id);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: Date.now(),
    contractPath: path.resolve(contractPath),
    totals: {
      capabilities: capabilities.length,
      withMcp: withMcp.length,
      withCli: withMcp.length - missingCli.length,
      parityCoverage:
        withMcp.length === 0
          ? 1
          : (withMcp.length - missingCli.length) / withMcp.length,
    },
    missingCli,
    passed: missingCli.length === 0,
  };
};

const writeParityReport = ({ outPath, report }) => {
  const resolvedPath = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(
    resolvedPath,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  return resolvedPath;
};

const validateMcpCliParity = ({ contractPath, outPath }) => {
  const { contractPath: resolvedContractPath, contract } =
    loadCapabilityContract(contractPath);
  const report = generateParityReport({
    contractPath: resolvedContractPath,
    contract,
  });
  const resolvedOutPath = writeParityReport({
    outPath,
    report,
  });
  return {
    report,
    outPath: resolvedOutPath,
  };
};

module.exports = {
  SCHEMA_VERSION,
  generateParityReport,
  loadCapabilityContract,
  readJsonFile,
  validateContractShape,
  validateMcpCliParity,
  writeParityReport,
};
