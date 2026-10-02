import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildInputs,
  restoreBuild,
  snapshotBuild,
} from '../ci/prepared-build-cache.mjs';
import { runPreparedUnitTests } from '../ci/run-prepared-unit-tests.mjs';

function fixture(t, { prepared = true, unitScripts = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prepared-unit-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, contents) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  };
  write('packages/example/src/index.ts', 'export const value = 1;');
  write('packages/example/package.json', '{}');
  write(
    'package.json',
    JSON.stringify({
      scripts: {
        'test:ut': 'nx run @scripts/prebundle:bundle && rstest',
        ...unitScripts,
      },
    }),
  );
  write('scripts/prebundle/src/index.ts', 'bundle();');
  write('pnpm-lock.yaml', 'lockfileVersion: 9');
  write('nx.json', '{}');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  const entry = path.join(root, 'fixture-pnpm.cjs');
  write(
    'fixture-pnpm.cjs',
    `const fs = require('node:fs');
fs.appendFileSync('invocations.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.RUNNER_TEST_HOLD === 'true') {
  process.on('SIGTERM', () => {
    fs.writeFileSync('received-signal', 'SIGTERM');
    process.exit(0);
  });
  setInterval(() => {}, 1000);
  console.log('runner-child-ready');
} else {
  process.exit(Number(process.env.RUNNER_TEST_EXIT_CODE || 0));
}
`,
  );
  const environment = { ...process.env, CI: 'true', npm_execpath: entry };
  const toolchain = { pnpm: '12.8.1' };
  if (prepared) {
    const inputs = buildInputs(root, environment, toolchain);
    write('.ci-build-cache/inputs.json', JSON.stringify(inputs));
    write('packages/example/dist/index.js', 'compiled');
    write('scripts/prebundle/dist/index.js', 'prepared dependency bundle');
    snapshotBuild(root, inputs);
    fs.rmSync(path.join(root, 'packages/example/dist'), { recursive: true });
    fs.rmSync(path.join(root, 'scripts/prebundle/dist'), { recursive: true });
    restoreBuild(root, inputs.key);
  }
  return {
    root,
    write,
    environment,
    toolchain,
    run: (args, changes = {}) =>
      runPreparedUnitTests(root, args, {
        environment: { ...environment, ...changes },
        toolchain,
      }),
    invocations: () =>
      fs
        .readFileSync(path.join(root, 'invocations.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line)),
  };
}

test('verified restored outputs run the same Rstest with exact forwarded arguments', async t => {
  const { run, invocations } = fixture(t);
  const args = [
    '--shard=2/4',
    '--reporter=default',
    '--testNamePattern=spaces & "quotes"',
  ];
  assert.equal(await run(args), 0);
  assert.deepEqual(invocations(), [['exec', 'rstest', ...args]]);
});

test('a trailing separator in the repository path retains valid warm preparation', async t => {
  const f = fixture(t);
  assert.equal(
    await runPreparedUnitTests(`${f.root}${path.sep}`, ['--shard=2/3'], {
      environment: f.environment,
      toolchain: f.toolchain,
    }),
    0,
  );
  assert.deepEqual(f.invocations(), [['exec', 'rstest', '--shard=2/3']]);
});

test('a cold checkout performs the original unit preparation and preserves its failure', async t => {
  const { run, invocations } = fixture(t, { prepared: false });
  assert.equal(await run(['--shard=1/4'], { RUNNER_TEST_EXIT_CODE: '23' }), 23);
  assert.deepEqual(invocations(), [['run', 'test:ut', '--shard=1/4']]);
});

test('a failing prepared test remains failed without a fallback rerun', async t => {
  const { run, invocations } = fixture(t);
  assert.equal(await run(['--shard=3/4'], { RUNNER_TEST_EXIT_CODE: '37' }), 37);
  assert.deepEqual(invocations(), [['exec', 'rstest', '--shard=3/4']]);
});

test('the installed pnpm executable runs the genuine cold script with forwarded options', async t => {
  const f = fixture(t, {
    prepared: false,
    unitScripts: { 'test:ut': 'node fixture-pnpm.cjs' },
  });
  const entry = execFileSync(
    'pnpm',
    ['exec', 'node', '-p', 'process.env.npm_execpath'],
    {
      cwd: f.root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  ).trim();
  assert.equal(
    await f.run(['--shard=2/4', '--reporter=default'], { npm_execpath: entry }),
    0,
  );
  assert.deepEqual(f.invocations(), [['--shard=2/4', '--reporter=default']]);
});

test('fresh cached outputs retain unit script changes and their failures', async t => {
  const f = fixture(t, {
    unitScripts: {
      'test:ut': 'nx run @scripts/prebundle:bundle && rstest --reporter=blob',
    },
  });
  assert.equal(
    await f.run(['--shard=2/4'], { RUNNER_TEST_EXIT_CODE: '19' }),
    19,
  );
  assert.deepEqual(f.invocations(), [['run', 'test:ut', '--shard=2/4']]);
});

test('fresh cached outputs retain unit lifecycle hooks and their failures', async t => {
  const f = fixture(t, {
    unitScripts: {
      'pretest:ut': 'node before-unit-tests.cjs',
      'posttest:ut': 'node after-unit-tests.cjs',
    },
  });
  assert.equal(
    await f.run(['--shard=3/4'], { RUNNER_TEST_EXIT_CODE: '29' }),
    29,
  );
  assert.deepEqual(f.invocations(), [['run', 'test:ut', '--shard=3/4']]);
});

test('stale, incomplete or corrupt preparation always uses the original unit path', async t => {
  const cases = [
    [
      'malformed saved inputs',
      f => f.write('.ci-build-cache/inputs.json', '{'),
    ],
    [
      'changed source',
      f => f.write('packages/example/src/index.ts', 'export const value = 2;'),
    ],
    ['corrupt output', f => f.write('packages/example/dist/index.js', 'wrong')],
    [
      'missing output',
      f => fs.unlinkSync(path.join(f.root, 'scripts/prebundle/dist/index.js')),
    ],
    [
      'runtime changed',
      f => ({
        NODE_ENV:
          f.environment.NODE_ENV === 'production' ? 'test' : 'production',
      }),
    ],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async child => {
      const f = fixture(child);
      const changes = mutate(f) ?? {};
      assert.equal(await f.run(['--shard=4/4'], changes), 0);
      assert.deepEqual(f.invocations(), [['run', 'test:ut', '--shard=4/4']]);
    });
  }
});

test('the dispatcher requires a real pnpm entry before starting tests', async t => {
  const f = fixture(t);
  await assert.rejects(f.run([], { npm_execpath: '' }), /pnpm run/u);
  const invalid = path.join(f.root, 'pnpm.cmd');
  fs.writeFileSync(invalid, 'must not execute');
  await assert.rejects(
    f.run([], { npm_execpath: invalid }),
    /JavaScript entry/u,
  );
  assert.equal(fs.existsSync(path.join(f.root, 'invocations.jsonl')), false);
});

if (process.platform !== 'win32') {
  test('termination reaches the child and cannot turn cancellation into success', async t => {
    const f = fixture(t);
    const wrapper = path.join(f.root, 'wrapper.mjs');
    fs.writeFileSync(
      wrapper,
      `import { runPreparedUnitTests } from ${JSON.stringify(new URL('../ci/run-prepared-unit-tests.mjs', import.meta.url).href)};
process.exitCode = await runPreparedUnitTests(process.argv[2], ['--shard=1/4'], { toolchain: { pnpm: '12.8.1' } });
`,
    );
    const child = spawn(process.execPath, [wrapper, f.root], {
      env: { ...f.environment, RUNNER_TEST_HOLD: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => child.kill('SIGKILL'));
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Child did not become ready')),
        10000,
      );
      let stdout = '';
      child.stdout.on('data', data => {
        stdout += data;
        if (stdout.includes('runner-child-ready')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once('error', error => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('close', () => {
        clearTimeout(timeout);
        reject(new Error('Child exited before it became ready'));
      });
    });
    child.kill('SIGTERM');
    assert.deepEqual(await closed, { code: 143, signal: null });
    assert.equal(
      fs.readFileSync(path.join(f.root, 'received-signal'), 'utf8'),
      'SIGTERM',
    );
    assert.deepEqual(f.invocations(), [['exec', 'rstest', '--shard=1/4']]);
  });
}
