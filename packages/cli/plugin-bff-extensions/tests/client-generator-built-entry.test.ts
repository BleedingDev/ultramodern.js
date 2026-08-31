import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@rstest/core';

import {
  bundleBuiltEffectEntryForNode,
  resolveEffectEntryPaths,
} from '../src/client-generator/built-entry';

function makeTempDir(prefix: string) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

async function withTempDirs<T>(
  prefixes: string[],
  run: (directories: string[]) => Promise<T> | T,
): Promise<T> {
  const directories = prefixes.map(makeTempDir);
  try {
    return await run(directories);
  } finally {
    for (const directory of directories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

describe('bundleBuiltEffectEntryForNode', () => {
  test('rejects an Effect entry that escapes the application directory', async () => {
    await withTempDirs(
      ['modern-built-entry-app-', 'modern-built-entry-outside-'],
      async ([appDirectory, outsideDirectory]) => {
        const outsideEntry = path.join(outsideDirectory, 'entry.ts');
        fs.writeFileSync(outsideEntry, 'export default {};');

        await expect(
          bundleBuiltEffectEntryForNode({
            appDir: appDirectory,
            apiDir: path.join(appDirectory, 'api'),
            distDir: path.join(appDirectory, 'dist'),
            effectEntry: outsideEntry,
            format: 'esm',
          }),
        ).rejects.toThrow(
          `Effect BFF entry must be inside the application directory: ${outsideEntry}`,
        );
      },
    );
  });

  test('rejects when the compiler never emitted the entry into the dist directory', async () => {
    await withTempDirs(['modern-built-entry-app-'], async ([appDirectory]) => {
      const apiDirectory = path.join(appDirectory, 'api');
      fs.mkdirSync(apiDirectory, { recursive: true });
      const sourceEntry = path.join(apiDirectory, 'index.ts');
      fs.writeFileSync(sourceEntry, 'export default {};');
      const distDirectory = path.join(appDirectory, 'dist');

      await expect(
        bundleBuiltEffectEntryForNode({
          appDir: appDirectory,
          apiDir: apiDirectory,
          distDir: distDirectory,
          format: 'esm',
        }),
      ).rejects.toThrow(
        `Effect BFF entry was not emitted into ${distDirectory}: ${sourceEntry}`,
      );
    });
  });
});

describe('resolveEffectEntryPaths', () => {
  test('rewrites the resolved TypeScript entry to its emitted JavaScript path', async () => {
    await withTempDirs(['modern-built-entry-app-'], ([appDirectory]) => {
      const apiDirectory = path.join(appDirectory, 'api');
      fs.mkdirSync(apiDirectory, { recursive: true });
      const sourceEntry = path.join(apiDirectory, 'index.ts');
      fs.writeFileSync(sourceEntry, 'export default {};');

      const resolved = resolveEffectEntryPaths({
        appDir: appDirectory,
        apiDir: apiDirectory,
      });

      expect(resolved.sourceEffectEntry).toBe(sourceEntry);
      expect(resolved.relativeEffectEntry).toBe('api/index.js');
    });
  });

  test('falls back to an empty relative entry when no Effect entry exists', async () => {
    await withTempDirs(['modern-built-entry-app-'], ([appDirectory]) => {
      const resolved = resolveEffectEntryPaths({
        appDir: appDirectory,
        apiDir: path.join(appDirectory, 'api'),
      });

      expect(resolved.sourceEffectEntry).toBeUndefined();
      expect(resolved.relativeEffectEntry).toBe('');
    });
  });
});
