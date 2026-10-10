import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { modernBuild } from '../../../../utils/modernTestUtils';
import { acquireTestLock } from '../../test-utils';

rstest.setConfig({ testTimeout: 240_000 });

test('split SSR initializes every entry in a cold Node process', async () => {
  const release = await acquireTestLock('i18n-mf');
  const app = path.resolve(__dirname, '../mf-app-provider');
  const cli = path.resolve(
    __dirname,
    '../../../../../packages/solutions/app-tools/bin/modern.js',
  );
  const inspection = await fs.mkdtemp(
    path.join(os.tmpdir(), 'mf-ssr-inspect-'),
  );
  const env = {
    MODERN_FAST_TEST: 'true',
    MODERN_MF_APP_SSR: 'true',
  };
  try {
    for (const preset of ['none', 'single-vendor']) {
      const configPath = path.join(inspection, `${preset}.mjs`);
      await fs.writeFile(
        configPath,
        `import base from ${JSON.stringify(path.join(app, 'modern.config.ts'))};\nexport default {...base, splitChunks: {preset: ${JSON.stringify(preset)}}};`,
      );
      const result = await modernBuild(app, ['--config', configPath], { env });
      expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
      execFileSync(
        process.execPath,
        [
          cli,
          'inspect',
          '--config',
          configPath,
          '--env',
          'production',
          '--output',
          inspection,
        ],
        { cwd: app, env: { ...process.env, ...env }, timeout: 60_000 },
      );
      const config = await fs.readFile(
        path.join(inspection, 'rspack.config.server.mjs'),
        'utf8',
      );
      expect(config).toMatch(/splitChunks:\s*\{\s*chunks: 'async'/);
      expect(config).toMatch(/asyncStartup: true/);
      expect(config).toMatch(/minSize: 0/);

      const routes = JSON.parse(
        await fs.readFile(path.join(app, 'dist/route.json'), 'utf8'),
      ).routes.filter((route: { isSSR?: boolean }) => route.isSSR);
      expect(routes).toHaveLength(2);
      // The Node MF plugin is registered only once per container. A warm
      // process can hide the first entry's startup failure, so test each order
      // in a new process without preloading a loader bundle.
      for (const order of [routes, [...routes].reverse()]) {
        const stdout = execFileSync(
          process.execPath,
          [
            '-e',
            `const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  for (const route of JSON.parse(process.argv[2])) {
    const entry = await require(path.join(process.argv[1], route.bundle));
    assert.equal(typeof await entry?.requestHandler, 'function', route.entryName);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });`,
            path.join(app, 'dist'),
            JSON.stringify(order),
          ],
          { cwd: app, encoding: 'utf8', timeout: 30_000 },
        );
        expect(stdout).toBe('');
      }
    }
  } finally {
    await fs.rm(inspection, { recursive: true, force: true });
    await release();
  }
});
