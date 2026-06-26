import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initAppContext } from '../src/utils/initAppContext';

const appDirectory = path.resolve(__dirname, '..');

describe('initAppContext', () => {
  it('defaults unresolved bff runtime to hono', () => {
    const context = initAppContext({
      metaName: 'modern-js',
      appDirectory,
      runtimeConfigFile: 'runtime.ts',
    });

    expect(context.bffRuntimeFramework).toBe('hono');
  });

  it('preserves explicit effect runtime', () => {
    const context = initAppContext({
      metaName: 'modern-js',
      appDirectory,
      runtimeConfigFile: 'runtime.ts',
      options: {
        bffRuntimeFramework: 'effect',
      },
    });

    expect(context.bffRuntimeFramework).toBe('effect');
  });

  it('keeps generated internals app-local when node_modules is a symlink', () => {
    const realDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-real-modules-'),
    );
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-symlinked-app-'),
    );
    const realNodeModules = path.join(realDirectory, 'node_modules');
    fs.mkdirSync(realNodeModules);
    fs.symlinkSync(realNodeModules, path.join(appDirectory, 'node_modules'));

    try {
      const context = initAppContext({
        metaName: 'modern-js',
        appDirectory,
        runtimeConfigFile: 'runtime.ts',
      });

      expect(context.internalDirectory).toBe(
        path.join(appDirectory, '.modern-js'),
      );
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
      fs.rmSync(realDirectory, { recursive: true, force: true });
    }
  });

  it('uses an explicit tempDir even when node_modules is a symlink', () => {
    const realDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-real-modules-'),
    );
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-symlinked-app-'),
    );
    const realNodeModules = path.join(realDirectory, 'node_modules');
    fs.mkdirSync(realNodeModules);
    fs.symlinkSync(realNodeModules, path.join(appDirectory, 'node_modules'));

    try {
      const context = initAppContext({
        metaName: 'modern-js',
        appDirectory,
        runtimeConfigFile: 'runtime.ts',
        tempDir: 'custom-temp',
      });

      expect(context.internalDirectory).toBe(
        path.join(appDirectory, 'custom-temp'),
      );
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
      fs.rmSync(realDirectory, { recursive: true, force: true });
    }
  });
});
