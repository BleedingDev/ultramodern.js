#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export function compatibilityCommand(argv = []) {
  let prepared = false;
  let target = 'all';
  let nativeOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--prepared') prepared = true;
    else if (argument === '--native-only') nativeOnly = true;
    else if (argument === '--target') target = argv[++index];
    else throw new Error(`Unknown native compatibility argument: ${argument}`);
  }
  if (!['all', 'upstream', 'fork'].includes(target)) {
    throw new Error('--target must be all, upstream, or fork');
  }
  const targets = target === 'all' ? ['upstream', 'fork'] : [target];
  const suites = targets.map(
    target => `integration/native-compatibility/${target}.test.ts`,
  );
  if (!nativeOnly && target !== 'upstream') {
    suites.push(
      'integration/routes-tanstack/tests/index.test.ts',
      'integration/routes-tanstack-rsc/tests/index.test.ts',
      'integration/routes-tanstack-mf/test/index.test.ts',
    );
  }
  const args = [
    '--dir',
    'tests',
    'exec',
    'rstest',
    'run',
    '-c',
    'rstest.config.mts',
    ...suites,
  ];
  return {
    command: target === 'upstream' ? 'pnpm' : process.execPath,
    args:
      target === 'upstream'
        ? args
        : [
            'tests/utils/runWithPrerequisites.mjs',
            ...(prepared ? ['--prepared'] : []),
            '--',
            'pnpm',
            ...args,
          ],
    cwd: repoRoot,
    env: { ...process.env, NATIVE_COMPATIBILITY_TARGET: target },
  };
}

async function main() {
  const { command, args, cwd, env } = compatibilityCommand(
    process.argv.slice(2),
  );
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
