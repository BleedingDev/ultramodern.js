const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCliInvocation,
  createMcpAdapterManifest,
  createMcporterConfig,
  loadAdapterInputFromContract,
  writeJsonFile,
} = require('../adapter');

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-mcp-adapter-'));

const removeDir = directory => {
  fs.rmSync(directory, { recursive: true, force: true });
};

const createContract = () => ({
  schemaVersion: 1,
  updatedAt: '2026-02-26T00:00:00.000Z',
  capabilities: [
    {
      id: 'runtime.status.read',
      description: 'Read runtime status',
      sideEffect: 'read',
      mcp: {
        tool: 'runtime.status.get',
        version: '1',
        inputSchema: {
          type: 'object',
          properties: {
            endpoint: { type: 'string' },
          },
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          additionalProperties: true,
        },
      },
      cli: {
        command: 'modern runtime status --json',
        bin: 'modern',
        args: ['runtime', 'status', '--json'],
        argMap: {
          endpoint: '--endpoint',
        },
      },
    },
    {
      id: 'runtime.fallback.signal.write',
      description: 'Emit runtime fallback signal',
      sideEffect: 'write',
      mcp: {
        tool: 'runtime.fallback.signal.post',
        version: '1',
        inputSchema: {
          type: 'object',
          required: ['appName'],
          properties: {
            appName: { type: 'string' },
            metadata: {
              type: 'object',
              additionalProperties: true,
            },
          },
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          additionalProperties: true,
        },
      },
      cli: {
        command: 'modern runtime fallback-signal --json',
        bin: 'modern',
        args: ['runtime', 'fallback-signal', '--json'],
        argMap: {
          appName: '--app',
          metadata: '--metadata',
        },
      },
    },
  ],
});

test('buildCliInvocation maps tool inputs to CLI flags', () => {
  const capability = createContract().capabilities[1];
  const invocation = buildCliInvocation(capability, {
    appName: 'crm-shell',
    metadata: {
      traceId: 'abc123',
    },
  });
  assert.equal(invocation.command, 'modern');
  assert.deepEqual(invocation.args, [
    'runtime',
    'fallback-signal',
    '--json',
    '--app',
    'crm-shell',
    '--metadata',
    '{"traceId":"abc123"}',
  ]);
});

test('buildCliInvocation rejects missing required MCP inputs', () => {
  const capability = createContract().capabilities[1];
  assert.throws(() => {
    buildCliInvocation(capability, {});
  }, /Missing required input "appName"/);
});

test('createMcpAdapterManifest and createMcporterConfig produce tool-aligned artifacts', () => {
  const contract = createContract();
  const manifest = createMcpAdapterManifest({
    contractPath: '/tmp/ai-capabilities.json',
    contract,
    bridgeCommand: 'node',
    bridgeArgs: ['scripts/ai-capabilities/mcp-cli-bridge.js'],
  });
  assert.equal(manifest.tools.length, 2);
  assert.deepEqual(
    manifest.tools.map(item => item.mcp.tool),
    ['runtime.status.get', 'runtime.fallback.signal.post'],
  );

  const mcporterConfig = createMcporterConfig({
    bridgeCommand: 'node',
    bridgeArgs: ['scripts/ai-capabilities/mcp-cli-bridge.js'],
    serverName: 'modernjs-ai-capabilities',
  });
  assert.equal(
    mcporterConfig.mcpServers['modernjs-ai-capabilities'].command,
    'node',
  );
});

test('loadAdapterInputFromContract loads validated tool mapping', () => {
  const dir = makeTempDir();
  try {
    const contractPath = path.join(dir, 'ai-capabilities.json');
    fs.writeFileSync(contractPath, JSON.stringify(createContract(), null, 2));
    const loaded = loadAdapterInputFromContract(contractPath);
    assert.equal(loaded.toolByName.size, 2);
    assert.equal(
      loaded.toolByName.get('runtime.status.get').id,
      'runtime.status.read',
    );
  } finally {
    removeDir(dir);
  }
});

test('writeJsonFile writes artifacts to nested directories', () => {
  const dir = makeTempDir();
  try {
    const outputPath = path.join(dir, '.modern/mcp/adapter.json');
    const resolved = writeJsonFile({
      filePath: outputPath,
      payload: {
        ok: true,
      },
    });
    assert.equal(resolved, path.resolve(outputPath));
    assert.equal(fs.existsSync(outputPath), true);
  } finally {
    removeDir(dir);
  }
});
