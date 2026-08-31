import { createRslib, type RslibConfig } from '@rslib/core';
import { afterAll, beforeAll, describe, expect, it } from '@rstest/core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import appToolsRslibConfig from '../rslib.config.mts';

const appToolsDirectory = path.resolve(__dirname, '..');
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'modernjs-app-tools-rslib-'),
);
const outputDirectory = path.join(temporaryDirectory, 'dist');
const outputFormats = ['esm-node', 'esm', 'cjs'];

function getBuildConfig(): RslibConfig {
  return {
    ...appToolsRslibConfig,
    lib: appToolsRslibConfig.lib?.map(libConfig => ({
      ...libConfig,
      output: {
        ...libConfig.output,
        distPath: {
          ...libConfig.output?.distPath,
          root: path.join(
            outputDirectory,
            path.basename(libConfig.output?.distPath?.root ?? libConfig.id),
          ),
        },
      },
    })),
  };
}

describe('App Tools Rslib ESM loaders', () => {
  beforeAll(async () => {
    fs.symlinkSync(
      path.join(appToolsDirectory, 'node_modules'),
      path.join(temporaryDirectory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const rslib = await createRslib({
      cwd: appToolsDirectory,
      config: getBuildConfig(),
    });

    await rslib.build();
  }, 120_000);

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('loads emitted ESM loaders and compiled CJS runtime entries', async () => {
    const runtimeEntries = fs
      .readdirSync(path.join(outputDirectory, 'esm-node', 'esm'))
      .filter(file => file.endsWith('.mjs'))
      .sort();

    expect(runtimeEntries).toEqual(['register-esm.mjs', 'ts-paths-loader.mjs']);

    for (const file of runtimeEntries) {
      for (const outputFormat of outputFormats) {
        const emitted = await import(
          `${pathToFileURL(path.join(outputDirectory, outputFormat, 'esm', file)).href}?format=${outputFormat}`
        );
        expect(emitted).toEqual(
          expect.objectContaining(
            file === 'register-esm.mjs'
              ? { registerPathsLoader: expect.any(Function) }
              : {
                  initialize: expect.any(Function),
                  resolve: expect.any(Function),
                },
          ),
        );
      }

      const compiledCjs = require(
        path.join(
          outputDirectory,
          'cjs',
          'esm',
          file.replace(/\.mjs$/u, '.js'),
        ),
      );
      expect(compiledCjs).toEqual(
        expect.objectContaining(
          file === 'register-esm.mjs'
            ? { registerPathsLoader: expect.any(Function) }
            : {
                initialize: expect.any(Function),
                resolve: expect.any(Function),
              },
        ),
      );
    }
  }, 120_000);
});
