import { createRslib, type RslibConfig } from '@rslib/core';
import { afterAll, beforeAll, describe, expect, it } from '@rstest/core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { rslibConfig } from '../src/index';

const fixtureDirectory = path.join(__dirname, 'fixtures/source-entry');
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'modernjs-rslib-source-entry-'),
);
const outputDirectory = path.join(temporaryDirectory, 'dist');
const outputFormats = [
  { directory: 'esm-node', extension: 'mjs', module: 'esm' },
  { directory: 'esm', extension: 'mjs', module: 'esm' },
  { directory: 'cjs', extension: 'js', module: 'cjs' },
] as const;

describe('Rslib bundleless source entries', () => {
  beforeAll(async () => {
    const config: RslibConfig = {
      ...rslibConfig,
      lib: rslibConfig.lib?.map(libConfig => ({
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
    const rslib = await createRslib({ cwd: fixtureDirectory, config });

    await rslib.build();
  }, 120_000);

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('emits executable TypeScript and TSX modules for every bundleless output', async () => {
    for (const outputFormat of outputFormats) {
      const entryPath = path.join(
        outputDirectory,
        outputFormat.directory,
        `entry.${outputFormat.extension}`,
      );
      const componentPath = path.join(
        outputDirectory,
        outputFormat.directory,
        `component.${outputFormat.extension}`,
      );
      const entry =
        outputFormat.module === 'esm'
          ? await import(pathToFileURL(entryPath).href)
          : require(entryPath);
      const component =
        outputFormat.module === 'esm'
          ? await import(pathToFileURL(componentPath).href)
          : require(componentPath);

      expect(entry.identifySourceEntry()).toBe('typescript-entry');
      expect(component.Greeting({ name: 'UltraModern' })).toMatchObject({
        element: 'strong',
        label: 'UltraModern',
      });
    }
  });

  it('does not emit Markdown as a library module', () => {
    for (const outputFormat of outputFormats) {
      expect(
        fs.existsSync(
          path.join(outputDirectory, outputFormat.directory, 'SPEC.md'),
        ),
      ).toBe(false);
    }
  });
});
