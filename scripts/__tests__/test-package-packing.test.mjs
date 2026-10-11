import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  packProjects,
  resolvePackConcurrency,
  runPackingCommand,
} from '../../tests/utils/packagePacking.mjs';

function fixture(t, hooks = [undefined, undefined, undefined, undefined]) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-pack-pool-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const projects = hooks.map((hook, index) => {
    const projectPath = path.join(output, String(index));
    fs.mkdirSync(projectPath);
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({ scripts: hook ? { [hook]: 'build' } : {} }),
    );
    return { name: `@modern-js/package-${index}`, path: projectPath };
  });
  return { output, projects };
}

test('parallel packs obey the cap, pack exactly once and preserve integrity/order', async t => {
  const { output, projects } = fixture(t);
  let active = 0;
  let peak = 0;
  const started = [];
  const packages = await packProjects(projects, output, {
    concurrency: 2,
    run: async (args, options) => {
      active++;
      peak = Math.max(peak, active);
      started.push(options.cwd);
      await new Promise(resolve => setTimeout(resolve, 20));
      fs.writeFileSync(args[2], options.cwd);
      active--;
    },
  });
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.deepEqual(
    started,
    projects.map(project => project.path),
  );
  assert.deepEqual(
    Object.keys(packages),
    projects.map(project => project.name),
  );
  for (const entry of Object.values(packages)) {
    assert.equal(
      entry.integrity,
      createHash('sha256').update(fs.readFileSync(entry.tarball)).digest('hex'),
    );
  }
});

test('all lifecycle hooks finish serially before plain packages run', async t => {
  const { output, projects } = fixture(t, [
    undefined,
    'postpack',
    'prepare',
    'prepack',
    undefined,
  ]);
  const events = [];
  let active = 0;
  await packProjects(projects, output, {
    concurrency: 4,
    run: async (args, options) => {
      const index = projects.findIndex(project => project.path === options.cwd);
      if ([1, 2, 3].includes(index)) assert.equal(active, 0);
      active++;
      events.push(index);
      await new Promise(resolve => setTimeout(resolve, 5));
      fs.writeFileSync(args[2], String(index));
      active--;
    },
  });
  assert.deepEqual(events, [1, 2, 3, 0, 4]);
});

test('pack failures propagate only after all started children finish', async t => {
  const { output, projects } = fixture(t);
  let active = 0;
  let completed = 0;
  const failure = new Error('pack failed');
  await assert.rejects(
    packProjects(projects, output, {
      concurrency: 2,
      run: async (args, options) => {
        active++;
        try {
          if (options.cwd === projects[0].path) throw failure;
          await new Promise(resolve => setTimeout(resolve, 20));
          fs.writeFileSync(args[2], 'packed');
          completed++;
        } finally {
          active--;
        }
      },
    }),
    error => error === failure,
  );
  assert.equal(active, 0);
  assert.equal(completed, 3);
});

test('interrupt aborts active packs and leaves no signal listeners or queued work', async t => {
  const { output, projects } = fixture(t);
  const previous = process.listenerCount('SIGTERM');
  let started = 0;
  let active = 0;
  await assert.rejects(
    packProjects(projects, output, {
      concurrency: 2,
      run: async (_args, options) => {
        active++;
        started++;
        if (started === 2) queueMicrotask(() => process.emit('SIGTERM'));
        try {
          await new Promise((_resolve, reject) =>
            options.signal.addEventListener(
              'abort',
              () => reject(options.signal.reason),
              { once: true },
            ),
          );
        } finally {
          active--;
        }
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal(started, 2);
  assert.equal(active, 0);
  assert.equal(process.listenerCount('SIGTERM'), previous);
});

test('invalid worker budgets fail before running package commands', () => {
  for (const value of ['0', '9', '2.5', 'nope', '02']) {
    assert.throws(() => resolvePackConcurrency(value), /integer from 1 to 8/u);
  }
  assert.equal(resolvePackConcurrency('4'), 4);
});

test('packing commands capture subprocess failures with both output streams', async () => {
  await assert.rejects(
    runPackingCommand(
      process.execPath,
      [
        '-e',
        "console.log('packing'); console.error('broken hook'); process.exit(7)",
      ],
      { cwd: process.cwd(), stdio: 'pipe' },
      spawn,
    ),
    /packing[\s\S]*broken hook/u,
  );
});

test('aborting a pack terminates its lifecycle child and grandchild', {
  timeout: 10000,
}, async t => {
  const { output } = fixture(t, []);
  const pidFile = path.join(output, 'pids.json');
  const controller = new AbortController();
  t.after(() => controller.abort());
  const source = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    const fs = require('node:fs');
    const temporaryFile = process.argv[1] + '.tmp';
    fs.writeFileSync(temporaryFile, JSON.stringify([process.pid, child.pid]));
    fs.renameSync(temporaryFile, process.argv[1]);
    setInterval(() => {}, 1000);
  `;
  const command = runPackingCommand(
    process.execPath,
    ['-e', source, pidFile],
    { cwd: output, stdio: 'pipe', signal: controller.signal },
    spawn,
  );
  const result = command.then(
    () => undefined,
    error => error,
  );
  const readyDeadline = Date.now() + 5000;
  while (!fs.existsSync(pidFile) && Date.now() < readyDeadline)
    await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(fs.existsSync(pidFile), 'the lifecycle subprocess did not start');
  const pids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  controller.abort();
  assert.equal((await result)?.name, 'AbortError');
  const alive = pid => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  const reapDeadline = Date.now() + 3000;
  while (pids.some(alive) && Date.now() < reapDeadline)
    await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(pids.filter(alive), []);
});
