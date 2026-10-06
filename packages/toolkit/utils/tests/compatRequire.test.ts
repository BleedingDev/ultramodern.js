import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'path';
import {
  chokidar,
  cleanRequireCache,
  compatibleRequire,
  type FSWatcher,
  tryResolve,
} from '../src';

describe('compat require', () => {
  const fixturePath = path.resolve(__dirname, './fixtures/compat-require');

  test(`should support default property`, async () => {
    expect(await compatibleRequire(path.join(fixturePath, 'esm.js'))).toEqual({
      name: 'esm',
    });
  });

  test(`should support commonjs module`, async () => {
    expect(await compatibleRequire(path.join(fixturePath, 'cjs.js'))).toEqual({
      name: 'cjs',
    });
  });

  test(`should return null`, async () => {
    expect(await compatibleRequire(path.join(fixturePath, 'empty.js'))).toEqual(
      null,
    );
  });

  test('resolves ESM packages in directories containing URL-encoded characters', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-RUNNER~1 % # č-'),
    );
    const previousFormat = process.env.MODERN_LIB_FORMAT;
    try {
      const packageDirectory = path.join(directory, 'node_modules/example');
      fs.mkdirSync(packageDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(packageDirectory, 'package.json'),
        JSON.stringify({ type: 'module', exports: './index.mjs' }),
      );
      const modulePath = path.join(packageDirectory, 'index.mjs');
      fs.writeFileSync(modulePath, 'export default "resolved";');
      process.env.MODERN_LIB_FORMAT = 'esm';

      const resolved = tryResolve('example', directory);
      expect(resolved).toBe(fs.realpathSync(modulePath));
      expect((await import(pathToFileURL(resolved).href)).default).toBe(
        'resolved',
      );
    } finally {
      if (previousFormat === undefined) {
        delete process.env.MODERN_LIB_FORMAT;
      } else {
        process.env.MODERN_LIB_FORMAT = previousFormat;
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('should clean cache after fn', () => {
    const requirePath = require.resolve('./fixtures/compat-require/foo.js');
    const cachedModule = {
      id: requirePath,
      filename: requirePath,
      loaded: true,
      exports: { name: 'foo' },
      children: [],
      paths: [],
    } as unknown as NodeModule;

    require.cache[requirePath] = cachedModule;
    expect(require.cache[requirePath]).toBeDefined();

    cleanRequireCache([requirePath]);

    const shouldClean = process.env.MODERN_LIB_FORMAT !== 'esm';
    expect(Boolean(require.cache[requirePath])).toBe(!shouldClean);

    delete require.cache[requirePath];
  });
});

function watchEvent(watcher: FSWatcher, event: 'ready' | 'change') {
  let cancel = () => {};
  const promise = new Promise<string | undefined>((resolve, reject) => {
    const timer = setTimeout(
      () => fail(new Error(`Watcher missed ${event}`)),
      10000,
    );
    const cleanup = () => {
      clearTimeout(timer);
      watcher.off(event, done);
      watcher.off('error', fail);
    };
    cancel = cleanup;
    const done = (filename?: string) => {
      cleanup();
      resolve(filename);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    watcher.once(event, done);
    watcher.once('error', fail);
  });
  return { promise, cancel: () => cancel() };
}

describe('lazy compiled watcher imports', () => {
  test('source export defers Chokidar and preserves native ready/change/close', async () => {
    const owningRequire = createRequire(
      path.resolve(__dirname, '../package.json'),
    );
    expect(
      Object.keys(owningRequire.cache).filter(filename =>
        /[/\\]chokidar[/\\]fsevents\.node$/.test(filename),
      ),
    ).toEqual([]);
    const directory = fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'modern-lazy-source-watcher-',
      ),
    );
    let watcher: FSWatcher | undefined;
    try {
      const filename = path.join(directory, 'input.txt');
      fs.writeFileSync(filename, 'before');
      watcher = chokidar.watch(filename, { ignoreInitial: true });
      expect(watcher).toBeInstanceOf(chokidar.FSWatcher);
      await watchEvent(watcher, 'ready').promise;
      if (process.platform === 'darwin')
        expect(watcher.options.useFsEvents).toBe(true);
      const changed = watchEvent(watcher, 'change');
      try {
        fs.writeFileSync(filename, 'after');
        expect(await changed.promise).toBe(filename);
      } finally {
        changed.cancel();
      }
      await watcher.close();
      expect(watcher).toEqual(expect.objectContaining({ closed: true }));
    } finally {
      try {
        await watcher?.close();
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  test.each(['cjs', 'esm'] as const)(
    'cold public %s import defers the addon until native watching',
    async format => {
      const directory = fs.mkdtempSync(
        path.join(
          process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
          'modern-lazy-public-watcher-',
        ),
      );
      const owner = path.resolve(__dirname, '../package.json');
      // A separate normal Node process proves cold published require/import
      // conditions; this never aliases public exports to utility source files.
      const script = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire, registerHooks } = require('node:module');
const owningRequire = createRequire(${JSON.stringify(owner)});
const directory = ${JSON.stringify(directory)};
const addonFilename = process.platform === 'darwin'
  ? owningRequire.resolve('./dist/compiled/chokidar/fsevents.node')
  : undefined;
const initialized = [];
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url.includes('/compiled/chokidar/')) initialized.push(url);
  return nextLoad(url, context);
} });
const wait = (watcher, event) => {
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); watcher.off(event, done); watcher.off('error', fail); };
    cancel = cleanup;
    const done = filename => { cleanup(); resolve(filename); };
    const fail = error => { cleanup(); reject(error); };
    const timer = setTimeout(() => fail(new Error('Watcher missed ' + event)), 10000);
    watcher.once(event, done); watcher.once('error', fail);
  });
  return { promise, cancel: () => cancel() };
};
(async () => {
  if (addonFilename) assert.equal(owningRequire.cache[addonFilename], undefined);
  const utils = ${format === 'cjs' ? "owningRequire('@modern-js/utils')" : "await import('@modern-js/utils')"};
  assert.deepEqual(initialized, [], 'metadata import initialized Chokidar');
  if (addonFilename) assert.equal(owningRequire.cache[addonFilename], undefined);
  assert.ok(Array.isArray(utils.CONFIG_FILE_EXTENSIONS));
  assert.deepEqual(initialized, [], 'constant access initialized Chokidar');
  if (addonFilename) assert.equal(owningRequire.cache[addonFilename], undefined);
  let watcher;
  try {
    const filename = path.join(directory, 'input.txt');
    fs.writeFileSync(filename, 'before');
    watcher = utils.chokidar.watch(filename, { ignoreInitial: true });
    assert.ok(watcher instanceof utils.chokidar.FSWatcher);
    await wait(watcher, 'ready').promise;
    if (process.platform === 'darwin') {
      assert.equal(watcher.options.useFsEvents, true);
      // Node's native CJS extension calls dlopen without the load hook.
      assert.equal(owningRequire.cache[addonFilename].loaded, true);
    }
    const changed = wait(watcher, 'change');
    try {
      fs.writeFileSync(filename, 'after');
      assert.equal(await changed.promise, filename);
    } finally { changed.cancel(); }
    await watcher.close();
    assert.equal(watcher.closed, true);
    process.stdout.write(JSON.stringify({ format: ${JSON.stringify(format)}, changed: true, closed: watcher.closed }));
  } finally {
    try { await watcher?.close(); } finally { hooks.deregister(); }
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
`;
      try {
        const output = await new Promise<string>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['--input-type=commonjs', '-e', script],
            {
              cwd: path.dirname(owner),
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
          let stdout = '';
          let stderr = '';
          const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
          child.stdout.on('data', value => {
            stdout += value;
          });
          child.stderr.on('data', value => {
            stderr += value;
          });
          child.once('error', reject);
          child.once('close', code => {
            clearTimeout(timer);
            if (code === 0) resolve(stdout);
            else
              reject(
                new Error(`Cold ${format} watcher failed (${code}): ${stderr}`),
              );
          });
        });
        expect(JSON.parse(output)).toEqual({
          format,
          changed: true,
          closed: true,
        });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
