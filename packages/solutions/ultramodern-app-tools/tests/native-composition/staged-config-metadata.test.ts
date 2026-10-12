import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from '@rstest/core';
import { readUltramodernConfigMetadata } from '../../src/native-composition/config-metadata';
import { defineConfig } from '../../src/native-composition/index';

it('evaluates staged entries with the original installed router identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-staged-metadata-'));
  const originalRoot = path.join(root, 'original');
  const stagedRoot = path.join(root, 'staged');
  const originalApp = path.join(originalRoot, 'apps', 'shell');
  const stagedApp = path.join(stagedRoot, 'apps', 'shell');
  const token = '__ultramodern_staged_metadata';
  const registry = globalThis as unknown as Record<string, unknown>;
  const previous = registry[token];
  const install = (directory: string, name: string, version: string) => {
    const target = path.join(directory, 'node_modules', name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ name, version }),
    );
    return target;
  };
  try {
    for (const app of [originalApp, stagedApp]) {
      fs.mkdirSync(path.join(app, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(app, 'package.json'),
        JSON.stringify({ name: 'shell' }),
      );
      fs.writeFileSync(
        path.join(app, 'src', 'App.tsx'),
        'export default () => null;',
      );
      fs.writeFileSync(
        path.join(app, 'modern.config.js'),
        `module.exports = globalThis[${JSON.stringify(token)}];`,
      );
    }
    // Consumer overrides differ from the framework's declared 1.170.41/1.171.34.
    const owner = install(originalApp, '@modern-js/plugin-tanstack', '3.9.3');
    const router = install(owner, '@tanstack/react-router', '1.170.39');
    install(router, '@tanstack/router-core', '1.171.32');
    registry[token] = defineConfig({
      renderer: 'react',
      plugins: [
        {
          name: '@modern-js/plugin-tanstack',
          setup(api) {
            api.modifyEntrypoints(({ entrypoints }) => ({
              entrypoints: entrypoints.map(entry => ({
                ...entry,
                entryName: path.basename(api.getAppContext().appDirectory),
                __modernRoutesOwner: '@modern-js/plugin-tanstack',
              })),
            }));
          },
        },
      ],
    });
    const options = { env: 'development', command: 'dev' };
    const original = await readUltramodernConfigMetadata({
      ...options,
      appDirectory: originalApp,
    });
    const staged = await readUltramodernConfigMetadata({
      ...options,
      appDirectory: stagedApp,
      sourceRoot: stagedRoot,
      stagedWorkspace: { root: stagedRoot, originalRoot },
    });
    expect(staged).toEqual(original);
    expect(staged.routerBindings.shell.defaultProvider).toMatchObject({
      version: '1.170.39',
      coreVersion: '1.171.32',
    });
    // The entry hook still reads the staged source directory, not the original.
    fs.renameSync(
      path.join(stagedApp, 'src', 'App.tsx'),
      path.join(stagedApp, 'src', 'unselected.txt'),
    );
    await expect(
      readUltramodernConfigMetadata({
        ...options,
        appDirectory: stagedApp,
        sourceRoot: stagedRoot,
        stagedWorkspace: { root: stagedRoot, originalRoot },
      }),
    ).rejects.toThrow();
  } finally {
    if (previous === undefined) delete registry[token];
    else registry[token] = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
