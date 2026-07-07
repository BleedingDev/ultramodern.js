const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
  reservePort,
  runCommandList,
  runShellCommand,
  waitForHttp,
} = require('../process-kit');

const nodeCommand = script =>
  `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;

test('reservePort returns an available TCP port', async () => {
  const port = await reservePort();
  assert.equal(Number.isInteger(port), true);
  assert.equal(port > 0, true);
});

test('waitForHttp accepts caller-provided readiness predicates', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(418);
    response.end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const result = await waitForHttp(`http://127.0.0.1:${port}`, {
      expectedStatus: status => status === 418,
      intervalMs: 10,
      timeoutMs: 500,
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 418);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('runShellCommand returns process results for shell commands', () => {
  const result = runShellCommand(nodeCommand('process.exit(3)'), {
    stdio: 'pipe',
  });

  assert.equal(result.processStatus, 3);
  assert.equal(result.exitCode, 3);
  assert.equal(typeof result.durationMs, 'number');
});

test('runCommandList supports dry-run planning', () => {
  const command = nodeCommand('process.exit(1)');
  const results = runCommandList(
    [
      {
        id: 'planned',
        command,
        env: { EXAMPLE: '1' },
      },
    ],
    { dryRun: true },
  );

  assert.deepEqual(results, [
    {
      id: 'planned',
      command,
      cwd: process.cwd(),
      env: { EXAMPLE: '1' },
      status: 'planned',
      exitCode: 0,
      durationMs: 0,
    },
  ]);
});

test('runCommandList stops on first failure by default', () => {
  const results = runCommandList(
    [
      { id: 'first', command: nodeCommand('process.exit(2)') },
      { id: 'second', command: nodeCommand('process.exit(0)') },
    ],
    { stdio: 'pipe' },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'first');
  assert.equal(results[0].status, 'failed');
  assert.equal(results[0].exitCode, 2);
});
