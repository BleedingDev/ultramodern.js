import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleEffectEntryForNode } from '../src/effect-source-loader';
import {
  loadEffectBuiltModule,
  loadEffectSourceModule,
} from '../src/effect-source-loader/loader';

const writeFile = async (filename: string, source: string) => {
  await fs.promises.mkdir(path.dirname(filename), { recursive: true });
  await fs.promises.writeFile(filename, source);
};

describe('Effect source loading', () => {
  test('loads built CommonJS and ESM artifacts through their native module boundaries', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-bff-effect-built-'),
    );

    try {
      const commonJsEntry = path.join(appDir, 'commonjs', 'index.cjs');
      await writeFile(
        commonJsEntry,
        `module.exports = { filename: __filename, moduleType: 'commonjs' };`,
      );
      await expect(loadEffectBuiltModule(commonJsEntry)).resolves.toEqual({
        filename: await fs.promises.realpath(commonJsEntry),
        moduleType: 'commonjs',
      });

      const esmEntry = path.join(appDir, 'module', 'index.js');
      await writeFile(
        path.join(appDir, 'module', 'package.json'),
        JSON.stringify({ type: 'module' }),
      );
      await writeFile(
        esmEntry,
        `export default { moduleUrl: import.meta.url, moduleType: 'module' };`,
      );
      await expect(loadEffectBuiltModule(esmEntry)).resolves.toMatchObject({
        default: {
          moduleUrl: pathToFileURL(await fs.promises.realpath(esmEntry)).href,
          moduleType: 'module',
        },
      });
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('loads the complete TypeScript source graph and reports watchable inputs', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-bff-effect-source-'),
    );

    try {
      const entryPath = path.join(appDir, 'api', 'index.ts');
      const helperPath = path.join(appDir, 'api', 'helper.ts');
      const dataPath = path.join(appDir, 'api', 'value.json');
      await writeFile(
        path.join(appDir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { resolveJsonModule: true } }),
      );
      await writeFile(dataPath, JSON.stringify({ suffix: 'one' }));
      await writeFile(
        helperPath,
        `import value from './value.json'; export const marker: string = 'first-' + value.suffix;`,
      );
      await writeFile(
        entryPath,
        `import { marker } from './helper'; export default { marker, sourceUrl: import.meta.url };`,
      );

      const dependencies: string[] = [];
      const first = (await loadEffectSourceModule({
        appDir,
        resourcePath: entryPath,
        onDependency: dependency => dependencies.push(dependency),
      })) as { default: { marker: string; sourceUrl: string } };

      expect(first.default).toEqual({
        marker: 'first-one',
        sourceUrl: pathToFileURL(await fs.promises.realpath(entryPath)).href,
      });
      expect(new Set(dependencies)).toEqual(
        new Set([entryPath, helperPath, dataPath]),
      );

      await writeFile(helperPath, `export const marker: string = 'second';`);
      const second = (await loadEffectSourceModule({
        appDir,
        resourcePath: entryPath,
      })) as { default: { marker: string } };
      expect(second.default.marker).toBe('second');
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('isolates concurrent revisions when publication completes in reverse order', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-bff-effect-concurrent-source-'),
    );
    const entryPath = path.join(appDir, 'api', 'index.ts');
    const originalLink = fs.promises.link.bind(fs.promises);
    let firstPublicationReachedResolve!: () => void;
    const firstPublicationReached = new Promise<void>(resolve => {
      firstPublicationReachedResolve = resolve;
    });
    let releaseFirstPublication!: () => void;
    const firstPublicationRelease = new Promise<void>(resolve => {
      releaseFirstPublication = resolve;
    });
    let publicationCount = 0;
    const linkSpy = rstest
      .spyOn(fs.promises, 'link')
      .mockImplementation(async (existingPath, newPath) => {
        publicationCount += 1;
        if (publicationCount === 1) {
          firstPublicationReachedResolve();
          await firstPublicationRelease;
        }
        await originalLink(existingPath, newPath);
      });
    let firstLoad: Promise<unknown> | undefined;

    try {
      await writeFile(entryPath, `export default { marker: 'first' };`);
      firstLoad = loadEffectSourceModule({ appDir, resourcePath: entryPath });
      await firstPublicationReached;

      await writeFile(entryPath, `export default { marker: 'second' };`);
      const second = (await loadEffectSourceModule({
        appDir,
        resourcePath: entryPath,
      })) as { default: { marker: string } };
      expect(second.default.marker).toBe('second');

      releaseFirstPublication();
      const first = (await firstLoad) as { default: { marker: string } };
      expect(first.default.marker).toBe('first');

      const cacheDirectory = path.join(
        appDir,
        'node_modules',
        '.cache',
        'modern-js',
        'effect-source-loader',
      );
      const cacheEntries = await fs.promises.readdir(cacheDirectory);
      expect(cacheEntries.filter(entry => entry.endsWith('.mjs'))).toHaveLength(
        2,
      );
      expect(cacheEntries.filter(entry => entry.endsWith('.tmp'))).toEqual([]);
    } finally {
      releaseFirstPublication();
      await firstLoad?.catch(() => undefined);
      linkSpy.mockRestore();
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('bundles a TypeScript entry into a directly executable Node 26 artifact', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-bff-effect-bundle-'),
    );

    try {
      const entryPath = path.join(appDir, 'entry.cts');
      await writeFile(
        entryPath,
        `const value: string = 'native'; module.exports = { value, sourceUrl: import.meta.url };`,
      );
      await bundleEffectEntryForNode({
        appDir,
        entryPath,
        format: 'cjs',
      });

      const result = createRequire(entryPath)(entryPath) as {
        sourceUrl: string;
        value: string;
      };
      expect(result).toEqual({
        sourceUrl: pathToFileURL(await fs.promises.realpath(entryPath)).href,
        value: 'native',
      });
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });
});
