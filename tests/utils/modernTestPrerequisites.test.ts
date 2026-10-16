import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getPort, killApp, launchApp, modernBuild } from './modernTestUtils';

const fixtures: string[] = [];
function isProcessAlive(pid: number) {
  try {
    if (process.platform === 'linux') {
      // kill(pid, 0) also succeeds for zombies awaiting reaping. Only an
      // absent process or an actual zombie counts as retired on Linux.
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const state = stat[stat.lastIndexOf(')') + 2];
      return state !== 'Z';
    }
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ESRCH')
    ) {
      return false;
    }
    throw error;
  }
}

function command(source: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'modern-test-lifecycle-'));
  fixtures.push(dir);
  const modernBin = path.join(dir, 'modern.cjs');
  writeFileSync(modernBin, source);
  return { cwd: dir, modernBin, stdout: false, stderr: false };
}

afterAll(() => {
  for (const fixture of fixtures)
    rmSync(fixture, { recursive: true, force: true });
});

test('parallel commands consume prerequisites without blocking on a running server', async () => {
  const port = await getPort();
  const options = command(`
    const net = require('node:net');
    if (process.argv[2] === 'dev') {
      net.createServer().listen(Number(process.env.PORT), '127.0.0.1', () => {
        console.log('> Local: http://127.0.0.1:' + process.env.PORT);
      });
    } else {
      console.log('built with existing prerequisites');
    }
  `);
  const app = await launchApp(options.cwd, port, options);
  try {
    expect(isProcessAlive(app.pid)).toBe(true);
    const results = await Promise.all([
      modernBuild(options.cwd, [], options),
      modernBuild(options.cwd, [], options),
    ]);
    expect(results.map(result => result.code)).toEqual([0, 0]);
    expect(
      results.every(result => result.stdout.includes('existing prerequisites')),
    ).toBe(true);
  } finally {
    await killApp(app);
  }
});

test('startup timeout rejects with output and terminates the unreturned child', async () => {
  const options = command(
    `console.log('booting'); setInterval(() => {}, 1000);`,
  );
  const previousTimeout = process.env.MODERN_TEST_BOOTUP_TIMEOUT_MS;
  process.env.MODERN_TEST_BOOTUP_TIMEOUT_MS = '150';
  try {
    const failure = await launchApp(
      options.cwd,
      await getPort(),
      options,
    ).catch(error => error);
    expect(failure.message).toContain('produced no readiness marker');
    expect(failure.stdout).toContain('booting');
    const pid = Number(/\(pid (\d+)\)/.exec(failure.message)?.[1]);
    expect(Number.isInteger(pid)).toBe(true);
    expect(isProcessAlive(pid)).toBe(false);
  } finally {
    if (previousTimeout === undefined)
      delete process.env.MODERN_TEST_BOOTUP_TIMEOUT_MS;
    else process.env.MODERN_TEST_BOOTUP_TIMEOUT_MS = previousTimeout;
  }
});

test.each([
  [
    'stdout compile',
    "console.log('Compile error: primary stdout failure');",
    'Compile error: primary stdout failure',
  ],
  [
    'stderr compile',
    "console.error('Compile error: primary stderr failure');",
    'Compile error: primary stderr failure',
  ],
  [
    'port mismatch',
    "console.log('> Local: http://127.0.0.1:' + (Number(process.env.PORT) + 1));",
    'but started on',
  ],
  [
    'TCP readiness',
    "console.log('> Local: http://127.0.0.1:' + process.env.PORT);",
    'did not accept TCP connections',
  ],
])(
  'failed %s startup retires its actual child and grandchild before rejecting',
  async (_name, report, message) => {
    const options = command(`
    const fs = require('node:fs');
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', "setInterval(() => {}, 1000); process.send('ready');"], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child.once('message', () => {
      fs.writeFileSync('children.json', JSON.stringify([process.pid, child.pid]));
      const reportGate = fs.watch('.', (_event, filename) => {
        if (filename !== 'report' && !fs.existsSync('report')) return;
        reportGate.close();
        ${report}
      });
      console.log('fixture children are live');
    });
    setInterval(() => {}, 1000);
  `);
    const siblingOptions = command(`
      require('node:net').createServer().listen(Number(process.env.PORT), '127.0.0.1', () => {
        console.log('> Local: http://127.0.0.1:' + process.env.PORT);
      });
    `);
    const sibling = await launchApp(
      siblingOptions.cwd,
      await getPort(),
      siblingOptions,
    );
    let children: number[] = [];
    let liveBeforeFailure: boolean[] = [];
    try {
      const failure = await launchApp(options.cwd, await getPort(), {
        ...options,
        onStdout() {
          if (children.length) return;
          children = JSON.parse(
            readFileSync(path.join(options.cwd, 'children.json'), 'utf8'),
          );
          liveBeforeFailure = children.map(isProcessAlive);
          // Release the failure only after observing both real processes.
          writeFileSync(path.join(options.cwd, 'report'), '');
        },
      }).catch(error => error);
      children = JSON.parse(
        readFileSync(path.join(options.cwd, 'children.json'), 'utf8'),
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toContain(message);
      expect(failure.stdout).toContain('fixture children are live');
      if (_name === 'stderr compile') expect(failure.stderr).toContain(message);
      else if (_name === 'stdout compile')
        expect(failure.stdout).toContain(message);
      expect(liveBeforeFailure).toEqual([true, true]);
      for (const pid of children) {
        expect(Number.isInteger(pid)).toBe(true);
        // Check immediately: polling here would miss a live descendant that
        // outlasted rejection. Inherited pipes also hold the parent's close
        // event open until the grandchild exits.
        expect(isProcessAlive(pid)).toBe(false);
      }
      expect(isProcessAlive(sibling.pid)).toBe(true);
    } finally {
      // Pre-fix failures must also retire only the fixture's recorded processes.
      for (const pid of children) {
        try {
          if (isProcessAlive(pid)) await killApp({ pid });
        } catch {
          // The helper normally already retired this exact child.
        }
      }
      await killApp(sibling);
    }
  },
);

test('parallel nested runners reuse their owner artifacts without invoking the package manager', async () => {
  const fixture = command('');
  const manifest = path.join(fixture.cwd, 'packages.json');
  writeFileSync(manifest, JSON.stringify({ packages: {}, allowBuilds: {} }));
  const run = promisify(execFile);
  const runner = path.resolve(__dirname, 'runWithPrerequisites.mjs');
  const args = [
    runner,
    '--',
    process.execPath,
    '-e',
    "console.log(require('node:fs').readFileSync(process.env.MODERN_TEST_PACKAGE_MANIFEST, 'utf8'))",
  ];
  // There is deliberately no pnpm executable available to these consumers.
  const env = {
    ...process.env,
    PATH: '',
    MODERN_TEST_PACKAGE_MANIFEST: manifest,
  };
  const results = await Promise.all([
    run(process.execPath, args, { cwd: fixture.cwd, env }),
    run(process.execPath, args, { cwd: fixture.cwd, env }),
  ]);
  expect(results.map(result => JSON.parse(result.stdout))).toEqual([
    { packages: {}, allowBuilds: {} },
    { packages: {}, allowBuilds: {} },
  ]);
});

test('an empty inherited manifest still invokes genuine cold package preparation', async () => {
  const fixture = command('');
  const run = promisify(execFile);
  const runner = path.resolve(__dirname, 'runWithPrerequisites.mjs');
  await expect(
    run(
      process.execPath,
      [runner, '--prepared', '--', process.execPath, '-e', 'process.exit(0)'],
      {
        cwd: fixture.cwd,
        // A cold runner must try the real package manager before launching
        // its child. An empty optional CI output must not bypass packing.
        env: { ...process.env, PATH: '', MODERN_TEST_PACKAGE_MANIFEST: '' },
      },
    ),
  ).rejects.toThrow(/pnpm/u);
});
