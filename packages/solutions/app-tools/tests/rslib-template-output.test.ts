import { createRslib, type RslibConfig } from '@rslib/core';
import { afterAll, beforeAll, describe, expect, it } from '@rstest/core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import appToolsRslibConfig from '../rslib.config.mts';

const appToolsDirectory = path.resolve(__dirname, '..');
const templatesDirectory = path.join(
  appToolsDirectory,
  'src/plugins/deploy/platforms/templates',
);
const esmRuntimeDirectory = path.join(appToolsDirectory, 'src/esm');
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'modernjs-app-tools-rslib-'),
);
const outputDirectory = path.join(temporaryDirectory, 'dist');
const outputFormats = ['esm-node', 'esm', 'cjs'];

function getTemplateFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return getTemplateFiles(entryPath);
    }

    return /\.[cm]js$/u.test(entry.name) ? [entryPath] : [];
  });
}

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

describe('App Tools Rslib deploy templates', () => {
  beforeAll(async () => {
    const rslib = await createRslib({
      cwd: appToolsDirectory,
      config: getBuildConfig(),
    });

    await rslib.build();
  }, 120_000);

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('copies every template byte-for-byte to each library output', () => {
    const templateFiles = getTemplateFiles(templatesDirectory);

    expect(templateFiles).toHaveLength(15);

    for (const sourcePath of templateFiles) {
      const source = fs.readFileSync(sourcePath);
      const relativePath = path.relative(
        path.join(appToolsDirectory, 'src'),
        sourcePath,
      );

      expect(source.byteLength).toBeGreaterThan(0);

      for (const outputFormat of outputFormats) {
        const output = fs.readFileSync(
          path.join(outputDirectory, outputFormat, relativePath),
        );

        expect(output.byteLength).toBeGreaterThan(0);
        expect(output).toEqual(source);
      }
    }
  }, 120_000);

  it('retains emitted ESM loaders and compiled CJS runtime entries', () => {
    const runtimeEntries = fs
      .readdirSync(esmRuntimeDirectory)
      .filter(file => file.endsWith('.mjs'))
      .sort();

    expect(runtimeEntries).toEqual(['register-esm.mjs', 'ts-paths-loader.mjs']);

    for (const file of runtimeEntries) {
      const source = fs.readFileSync(path.join(esmRuntimeDirectory, file));
      expect(source.byteLength).toBeGreaterThan(0);

      for (const outputFormat of outputFormats) {
        const emitted = fs.readFileSync(
          path.join(outputDirectory, outputFormat, 'esm', file),
        );
        expect(emitted.byteLength).toBeGreaterThan(0);
      }

      const compiledCjs = fs.readFileSync(
        path.join(
          outputDirectory,
          'cjs',
          'esm',
          file.replace(/\.mjs$/u, '.js'),
        ),
      );
      expect(compiledCjs.byteLength).toBeGreaterThan(0);
    }
  }, 120_000);
});
