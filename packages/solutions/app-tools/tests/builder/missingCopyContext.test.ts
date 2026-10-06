import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rspack } from '@rsbuild/core';
import { MissingCopyContextPlugin } from '../../src/builder/generator/adapterCopy';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function watchCopy(withPlugin: boolean) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'missing-copy-context-')),
  );
  const entry = path.join(root, 'index.js');
  fs.writeFileSync(entry, 'console.log(1);');
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(entry, past, past);
  const upload = path.join(root, 'config/upload');
  const compiler = rspack({
    mode: 'development',
    context: root,
    entry: './index.js',
    output: { path: path.join(root, 'dist') },
    plugins: [
      new rspack.CopyRspackPlugin({
        patterns: [
          {
            from: '**/*',
            to: 'upload',
            context: upload,
            noErrorOnMissing: true,
          },
        ],
      }),
      ...(withPlugin ? [new MissingCopyContextPlugin([upload])] : []),
    ],
  });
  const builds: { removed: string[]; assets: string[] }[] = [];
  compiler.hooks.watchRun.tap('test', current => {
    builds.push({ removed: [...(current.removedFiles ?? [])], assets: [] });
  });
  compiler.hooks.done.tap('test', stats => {
    builds[builds.length - 1].assets = Object.keys(stats.compilation.assets);
  });
  const watching = compiler.watch({ aggregateTimeout: 20 }, () => {});
  return {
    builds,
    root,
    upload,
    async close() {
      await new Promise(resolve => watching.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

describe('MissingCopyContextPlugin', () => {
  it('reproduces the extra rebuild for an absent copy context without the plugin', async () => {
    const run = await watchCopy(false);
    try {
      await sleep(1500);
      expect(run.builds.length).toBe(2);
      expect(run.builds[1].removed).toEqual([run.upload]);
    } finally {
      await run.close();
    }
  });

  it('builds once for an absent copy context and still copies it once created', async () => {
    const run = await watchCopy(true);
    try {
      await sleep(1500);
      expect(run.builds.length).toBe(1);

      // Neither config/ nor config/upload existed when watching started.
      fs.mkdirSync(run.upload, { recursive: true });
      fs.writeFileSync(path.join(run.upload, 'a.txt'), 'a');
      for (let i = 0; i < 50 && run.builds.length < 2; i++) await sleep(100);
      await sleep(300);

      expect(run.builds.length).toBe(2);
      expect(run.builds[1].assets).toContain('upload/a.txt');
    } finally {
      await run.close();
    }
  });
});
