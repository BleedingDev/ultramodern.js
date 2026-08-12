const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createProcessEnv,
  runCommand,
  runCommandList,
  writeStream,
} = require('../process-kit');

const nodeArgs = script => ['-e', script];

test('runCommand returns process results for argv commands', () => {
  const result = runCommand(process.execPath, nodeArgs('process.exit(3)'), {
    stdio: 'pipe',
  });

  assert.equal(result.processStatus, 3);
  assert.equal(result.exitCode, 3);
  assert.equal(typeof result.durationMs, 'number');
});

test('runCommand passes shell metacharacters as literal args', () => {
  const result = runCommand(
    process.execPath,
    [
      '-e',
      'process.stdout.write(process.argv[1])',
      'literal && not shell',
    ],
    { stdio: 'pipe' },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'literal && not shell');
});

test('process helpers normalize env and stream writes', async () => {
  const env = createProcessEnv({ EXAMPLE: '1', FORCE_COLOR: '1' });
  assert.equal(env.PATH, process.env.PATH);
  assert.equal(env.EXAMPLE, '1');
  assert.equal(env.FORCE_COLOR, '1');
  assert.equal(createProcessEnv().FORCE_COLOR, '0');

  const messages = [];
  const stream = {
    write(message, callback) {
      messages.push(message);
      callback();
    },
  };

  await writeStream(stream, 'hello\n');
  assert.deepEqual(messages, ['hello\n']);
});

test('runCommandList supports dry-run planning', () => {
  const command = process.execPath;
  const args = nodeArgs('process.exit(1)');
  const results = runCommandList(
    [
      {
        id: 'planned',
        command,
        args,
        env: { EXAMPLE: '1' },
      },
    ],
    { dryRun: true },
  );

  assert.deepEqual(results, [
    {
      id: 'planned',
      command,
      args,
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
      { id: 'first', command: process.execPath, args: nodeArgs('process.exit(2)') },
      { id: 'second', command: process.execPath, args: nodeArgs('process.exit(0)') },
    ],
    { stdio: 'pipe' },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'first');
  assert.equal(results[0].status, 'failed');
  assert.equal(results[0].exitCode, 2);
});
