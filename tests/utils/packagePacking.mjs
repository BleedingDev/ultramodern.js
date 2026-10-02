import { spawn as nativeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapWithConcurrency } from '../../scripts/ultramodern-publish/lib/prepare-bleedingdev-packages/registry-read.mjs';

export function runPackingCommand(command, args, options, spawnProcess) {
  return new Promise((resolve, reject) => {
    const { signal, ...spawnOptions } = options;
    signal?.throwIfAborted();
    const child = spawnProcess(command, args, {
      ...spawnOptions,
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let failure;
    let forceTimer;
    let termination;
    const killGroup = killSignal => {
      try {
        process.kill(-child.pid, killSignal);
      } catch (error) {
        if (error.code !== 'ESRCH') failure ??= error;
      }
    };
    const abort = () => {
      failure = signal.reason;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        termination = new Promise(done => {
          const killer = nativeSpawn(
            'taskkill',
            ['/pid', String(child.pid), '/T', '/F'],
            { stdio: 'ignore' },
          );
          killer.once('error', done);
          killer.once('close', done);
        });
      } else {
        killGroup('SIGTERM');
        forceTimer = setTimeout(() => killGroup('SIGKILL'), 2000);
      }
    };
    child.stdout?.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk;
    });
    child.once('error', error => {
      failure ??= error;
    });
    child.once('close', async (code, childSignal) => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(forceTimer);
      if (signal?.aborted) {
        // The direct child may exit before a lifecycle grandchild. Finish the
        // entire process group before the tarball owner removes its directory.
        if (process.platform !== 'win32' && child.pid) killGroup('SIGKILL');
        await termination;
      }
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new Error(
            `${command} ${args.join(' ')} failed in ${options.cwd}${childSignal ? ` (${childSignal})` : ''}\n${stdout}\n${stderr}`,
          ),
        );
      else resolve(stdout);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export function resolvePackConcurrency(
  value = process.env.MODERN_TEST_PACK_CONCURRENCY,
) {
  if (value === undefined) return Math.min(4, os.availableParallelism());
  if (!/^[1-8]$/u.test(String(value))) {
    throw new Error(
      'MODERN_TEST_PACK_CONCURRENCY must be an integer from 1 to 8',
    );
  }
  return Number(value);
}

/** Finish hooks that may rebuild shared dist before parallel read-only packs. */
export async function packProjects(
  projects,
  outputDir,
  { run, concurrency = resolvePackConcurrency() },
) {
  const limit = resolvePackConcurrency(concurrency);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const lifecycleProjects = [];
  const plainProjects = [];
  for (const project of projects) {
    const { scripts = {} } = JSON.parse(
      fs.readFileSync(path.join(project.path, 'package.json'), 'utf8'),
    );
    (['prepack', 'prepare', 'postpack'].some(name => scripts[name])
      ? lifecycleProjects
      : plainProjects
    ).push(project);
  }
  const packages = {};
  const pack = async project => {
    controller.signal.throwIfAborted();
    const tarball = path.join(
      outputDir,
      `${project.name.replaceAll('/', '-').replace('@', '')}.tgz`,
    );
    await run(['pack', '--out', tarball], {
      cwd: project.path,
      stdio: 'pipe',
      signal: controller.signal,
    });
    packages[project.name] = {
      tarball,
      integrity: createHash('sha256')
        .update(fs.readFileSync(tarball))
        .digest('hex'),
    };
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    for (const project of lifecycleProjects) await pack(project);
    // The shared pool drains all started work before throwing, so its owner can
    // safely remove temporary tarballs even when one pack fails.
    await mapWithConcurrency(plainProjects, limit, pack);
    return Object.fromEntries(
      projects.map(project => [project.name, packages[project.name]]),
    );
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
