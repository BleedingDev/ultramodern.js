import { expect, test } from '@playwright/test';
import type { RsbuildConfig, SourceConfig } from '@rsbuild/core';
import { build, getHrefByEntryName } from '@scripts/shared';
import { copySync, ensureDirSync } from 'fs-extra';
import path from 'path';

export const cases: Parameters<typeof shareTest>[] = [
  [
    `camelCase test`,
    './src/camel.js',
    [
      {
        libraryName: 'foo',
        libraryDirectory: 'lib',
        camelToDashComponentName: false,
      },
    ],
  ],
  [
    `kebab-case test`,
    './src/kebab.js',
    [
      {
        libraryName: 'foo',
        libraryDirectory: 'lib',
        camelToDashComponentName: true,
      },
    ],
  ],
  [
    'transform to named import',
    './src/named.js',
    [
      {
        libraryName: 'foo',
        libraryDirectory: 'lib',
        camelToDashComponentName: true,
        transformToDefaultImport: false,
      },
    ],
  ],
];

export function copyPkgToNodeModules() {
  const nodeModules = path.resolve(__dirname, 'node_modules');

  ensureDirSync(nodeModules);
  copySync(path.resolve(__dirname, 'foo'), path.resolve(nodeModules, 'foo'));
}

export function shareTest(
  msg: string,
  entry: string,
  transformImport: SourceConfig['transformImport'],
  otherConfigs: {
    plugins?: any[];
  } = {},
) {
  const setupConfig = {
    cwd: __dirname,
    entry: {
      index: entry,
    },
  };
  const config: RsbuildConfig = {
    source: {
      transformImport,
    },
    splitChunks: false,
  };

  test(msg, async ({ page }) => {
    const builder = await build({
      ...setupConfig,
      ...otherConfigs,
      builderConfig: { ...config },
      runServer: true,
    });
    const messages: string[] = [];
    page.on('console', message => messages.push(message.text()));
    await page.goto(getHrefByEntryName('index', builder.port));
    expect(messages).toContain('transformImport test succeed');
    builder.close();
  });
}
