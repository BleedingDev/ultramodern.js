#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const {
  buildCliInvocation,
  loadAdapterInputFromContract,
  toMcpToolDescriptor,
} = require('./adapter');

const BRIDGE_NAME = 'modernjs-mcp-cli-bridge';
const BRIDGE_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

const parseArgs = argv => {
  const parsed = {
    contractPath: 'docs/super-app-rfc-adr/contracts/ai-capabilities.json',
    cwd: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--contract':
        parsed.contractPath = argv[index + 1];
        index += 1;
        break;
      case '--cwd':
        parsed.cwd = argv[index + 1];
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
};

const toJsonRpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: {
    code,
    message,
    ...(data !== undefined ? { data } : {}),
  },
});

const createTransport = () => {
  let buffer = Buffer.alloc(0);

  const send = message => {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(
      `Content-Length: ${body.length}\r\nContent-Type: application/json\r\n\r\n`,
      'utf8',
    );
    process.stdout.write(Buffer.concat([header, body]));
  };

  const parseMessages = onMessage => {
    process.stdin.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length > 0) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          return;
        }

        const headerRaw = buffer.slice(0, headerEnd).toString('utf8');
        const lengthMatch = /content-length:\s*(\d+)/i.exec(headerRaw);
        if (!lengthMatch) {
          buffer = Buffer.alloc(0);
          return;
        }

        const contentLength = Number.parseInt(lengthMatch[1], 10);
        if (!Number.isFinite(contentLength) || contentLength < 0) {
          buffer = Buffer.alloc(0);
          return;
        }

        const totalLength = headerEnd + 4 + contentLength;
        if (buffer.length < totalLength) {
          return;
        }

        const payload = buffer
          .slice(headerEnd + 4, totalLength)
          .toString('utf8');
        buffer = buffer.slice(totalLength);

        let message;
        try {
          message = JSON.parse(payload);
        } catch (_error) {
          send(toJsonRpcError(null, -32700, 'Parse error'));
          continue;
        }

        onMessage(message, send);
      }
    });
  };

  return {
    parseMessages,
    send,
  };
};

const executeCapability = ({ capability, input, cwd }) =>
  new Promise(resolve => {
    let invocation;
    try {
      invocation = buildCliInvocation(capability, input || {});
    } catch (error) {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      resolve({
        ok: false,
        error: error.message,
      });
    });
    child.on('close', code => {
      if (code !== 0) {
        resolve({
          ok: false,
          error:
            stderr.trim() ||
            stdout.trim() ||
            `CLI command exited with code ${String(code)}`,
        });
        return;
      }

      const output = stdout.trim();
      if (!output) {
        resolve({
          ok: true,
          output: {},
        });
        return;
      }

      try {
        resolve({
          ok: true,
          output: JSON.parse(output),
        });
      } catch (_error) {
        resolve({
          ok: true,
          output: {
            raw: output,
          },
        });
      }
    });
  });

const createToolCallResult = ({ toolName, execution }) => {
  if (!execution.ok) {
    return {
      content: [
        {
          type: 'text',
          text: execution.error || `Tool "${toolName}" execution failed`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(execution.output, null, 2),
      },
    ],
    structuredContent: execution.output,
    isError: false,
  };
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const loaded = loadAdapterInputFromContract(args.contractPath);
  const tools = (loaded.contract.capabilities || []).map(toMcpToolDescriptor);

  const { parseMessages } = createTransport();

  parseMessages(async (message, reply) => {
    const { id, method, params } = message || {};

    if (!method) {
      reply(toJsonRpcError(id, -32600, 'Invalid Request'));
      return;
    }

    if (id === undefined || id === null) {
      if (method === 'notifications/initialized') {
        return;
      }
      return;
    }

    switch (method) {
      case 'initialize':
        reply({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: BRIDGE_NAME,
              version: BRIDGE_VERSION,
            },
          },
        });
        return;
      case 'tools/list':
        reply({
          jsonrpc: '2.0',
          id,
          result: {
            tools,
          },
        });
        return;
      case 'tools/call': {
        const toolName =
          params && typeof params.name === 'string' ? params.name : '';
        const capability = loaded.toolByName.get(toolName);
        if (!capability) {
          reply(toJsonRpcError(id, -32602, `Unknown tool: ${toolName}`));
          return;
        }

        const execution = await executeCapability({
          capability,
          input:
            params && typeof params.arguments === 'object'
              ? params.arguments
              : {},
          cwd: path.resolve(args.cwd),
        });
        reply({
          jsonrpc: '2.0',
          id,
          result: createToolCallResult({
            toolName,
            execution,
          }),
        });
        return;
      }
      default:
        reply(toJsonRpcError(id, -32601, `Method not found: ${method}`));
    }
  });

  process.stdin.resume();
};

try {
  main();
} catch (error) {
  console.error(`[mcp-cli-bridge] failed to start: ${error.message}`);
  process.exit(1);
}
