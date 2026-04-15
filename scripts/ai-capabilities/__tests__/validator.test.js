const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateParityReport,
  validateContractShape,
  validateMcpCliParity,
} = require('../validator');

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-mcp-cli-parity-'));

const removeDir = directory => {
  fs.rmSync(directory, { recursive: true, force: true });
};

test('validateContractShape accepts valid AI capability contract', () => {
  const contract = {
    schemaVersion: 1,
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
            properties: {},
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
          argMap: {},
        },
      },
    ],
  };
  assert.doesNotThrow(() => validateContractShape(contract));
});

test('generateParityReport flags missing CLI mappings', () => {
  const report = generateParityReport({
    contractPath: '/tmp/contract.json',
    contract: {
      schemaVersion: 1,
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
              properties: {},
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
              properties: {},
              additionalProperties: false,
            },
            outputSchema: {
              type: 'object',
              additionalProperties: true,
            },
          },
          cli: {},
        },
      ],
    },
  });
  assert.equal(report.passed, false);
  assert.deepEqual(report.missingCli, ['runtime.fallback.signal.write']);
  assert.equal(report.totals.withMcp, 2);
  assert.equal(report.totals.withCli, 1);
});

test('validateMcpCliParity writes report file and passes for full parity', () => {
  const dir = makeTempDir();
  try {
    const contractPath = path.join(dir, 'ai-capabilities.json');
    const outPath = path.join(dir, '.modern/mcp-cli-parity.json');
    fs.writeFileSync(
      contractPath,
      JSON.stringify(
        {
          schemaVersion: 1,
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
                  properties: {},
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
                },
              },
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = validateMcpCliParity({
      contractPath,
      outPath,
    });
    assert.equal(result.report.passed, true);
    assert.equal(result.report.missingCli.length, 0);
    assert.equal(fs.existsSync(result.outPath), true);
  } finally {
    removeDir(dir);
  }
});
