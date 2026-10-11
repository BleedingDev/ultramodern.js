import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCurrentPreparedBuild } from './prepared-build-cache.mjs';

const repoRoot = path.resolve(
  fileURLToPath(new URL('../../', import.meta.url)),
);

function pnpmEntry(environment) {
  const entry = environment.npm_execpath;
  if (!entry || !path.isAbsolute(entry)) {
    throw new Error('Run prepared unit tests with pnpm run test:ut:prepared');
  }
  const resolved = fs.realpathSync(entry);
  if (!fs.statSync(resolved).isFile()) {
    throw new Error('npm_execpath must identify a pnpm executable');
  }
  if (/\.(?:cjs|mjs|js)$/u.test(resolved)) {
    return { executable: process.execPath, prefix: [resolved] };
  }
  // pnpm can install as a standalone native binary. Execute it directly;
  // .cmd wrappers would involve shell parsing and alter forwarded arguments.
  const header = Buffer.alloc(4);
  const descriptor = fs.openSync(resolved, 'r');
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (
    header.subarray(0, 2).toString('ascii') === 'MZ' ||
    header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    [
      'cffaedfe',
      'cefaedfe',
      'feedfacf',
      'feedface',
      'cafebabe',
      'bebafeca',
    ].includes(header.toString('hex'))
  ) {
    return { executable: resolved, prefix: [] };
  }
  throw new Error(
    'npm_execpath must identify a pnpm JavaScript entry or native binary',
  );
}

export async function runPreparedUnitTests(
  root,
  args,
  { environment = process.env, toolchain = {} } = {},
) {
  root = path.resolve(root);
  const entry = pnpmEntry(environment);
  let prepared = false;
  try {
    verifyCurrentPreparedBuild(root, environment, toolchain);
    const { scripts } = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    );
    // New unit flags or lifecycle hooks must keep running through the genuine
    // script, even when a freshly seeded build cache contains their source.
    prepared =
      scripts?.['test:ut'] === 'nx run @scripts/prebundle:bundle && rstest' &&
      !Object.hasOwn(scripts, 'pretest:ut') &&
      !Object.hasOwn(scripts, 'posttest:ut');
  } catch {
    // A restored flag alone never authorizes skipping preparation. Ordinary
    // test:ut performs the genuine Nx bundle on a miss or changed output.
  }
  const command = prepared ? ['exec', 'rstest'] : ['run', 'test:ut'];
  const child = spawn(
    entry.executable,
    [...entry.prefix, ...command, ...args],
    {
      cwd: root,
      env: environment,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    },
  );
  let interrupted;
  let termination;
  let forceTimer;
  const killGroup = signal => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const forward = signal => {
    if (interrupted) return;
    interrupted = signal;
    if (!child.pid) return;
    if (process.platform === 'win32') {
      termination = new Promise(resolve => {
        const killer = spawn(
          'taskkill',
          ['/pid', String(child.pid), '/T', '/F'],
          { stdio: 'ignore' },
        );
        killer.once('error', resolve);
        killer.once('close', resolve);
      });
    } else {
      killGroup(signal);
      forceTimer = setTimeout(() => killGroup('SIGKILL'), 2000);
    }
  };
  const interrupt = () => forward('SIGINT');
  const terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    const { code, signal } = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    if (interrupted) {
      if (process.platform !== 'win32' && child.pid) killGroup('SIGKILL');
      await termination;
      return interrupted === 'SIGINT' ? 130 : 143;
    }
    return code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  } finally {
    clearTimeout(forceTimer);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runPreparedUnitTests(
    repoRoot,
    process.argv.slice(2),
  );
}
