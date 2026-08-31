import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerPluginAPI } from '@modern-js/server-core';
import { afterEach, describe, expect, test } from '@rstest/core';

import { resolveEffectAdapterEntryFile } from '../src/effect-adapter/entry';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('resolveEffectAdapterEntryFile', () => {
  test('uses an API directory that already points into production output', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-effect-entry-'),
    );
    try {
      const distDirectory = path.join(appDirectory, 'dist');
      const apiDirectory = path.join(distDirectory, 'api');
      const builtEntry = path.join(apiDirectory, 'index.js');
      fs.mkdirSync(apiDirectory, { recursive: true });
      fs.writeFileSync(builtEntry, 'module.exports = {};');
      process.env.NODE_ENV = 'production';

      const api = {
        getServerContext: () => ({
          appDirectory,
          apiDirectory,
          distDirectory,
        }),
        getServerConfig: () => ({}),
      } as unknown as ServerPluginAPI;

      expect(resolveEffectAdapterEntryFile(api)).toBe(builtEntry);
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  test('preserves an explicit built entry outside the consuming app', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-effect-consumer-'),
    );
    const producerDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-effect-producer-'),
    );
    try {
      const builtEntry = path.join(
        producerDirectory,
        'dist',
        'api',
        'effect',
        'index.js',
      );
      fs.mkdirSync(path.dirname(builtEntry), { recursive: true });
      fs.writeFileSync(builtEntry, 'module.exports = {};');
      process.env.NODE_ENV = 'production';

      const api = {
        getServerContext: () => ({
          appDirectory,
          apiDirectory: path.join(appDirectory, 'api'),
          distDirectory: path.join(appDirectory, 'dist'),
        }),
        getServerConfig: () => ({
          bff: { effect: { entry: builtEntry } },
        }),
      } as unknown as ServerPluginAPI;

      expect(resolveEffectAdapterEntryFile(api)).toBe(builtEntry);
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
      fs.rmSync(producerDirectory, { recursive: true, force: true });
    }
  });

  test('preserves a built SDK API directory inside node_modules', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-effect-node-modules-'),
    );
    try {
      const apiDirectory = path.join(
        appDirectory,
        'node_modules',
        'producer-sdk',
        'dist',
        'api',
        'effect',
      );
      const builtEntry = path.join(apiDirectory, 'index.js');
      fs.mkdirSync(apiDirectory, { recursive: true });
      fs.writeFileSync(builtEntry, 'export default {}');
      process.env.NODE_ENV = 'production';

      const api = {
        getServerContext: () => ({
          appDirectory,
          apiDirectory,
          distDirectory: path.join(appDirectory, 'dist'),
        }),
        getServerConfig: () => ({}),
      } as unknown as ServerPluginAPI;

      expect(resolveEffectAdapterEntryFile(api)).toBe(builtEntry);
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });
});
