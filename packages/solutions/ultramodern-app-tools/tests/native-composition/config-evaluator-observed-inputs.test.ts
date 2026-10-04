import childProcess from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import workerThreads from 'node:worker_threads';
import {
  type AppNormalizedConfig,
  type AppTools,
  appTools,
} from '@modern-js/app-tools';
import { type CLIPluginAPI, createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  initAppContext as initCLIAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import { describe, expect, it } from '@rstest/core';
import { createLoadedConfig } from '../../../../toolkit/plugin/src/cli/run/config/createLoadedConfig';
import type { ConfigPackageMetadataRead } from '../../../../toolkit/plugin/src/cli/run/config/loadConfig';
import { initAppDir } from '../../../../toolkit/plugin/src/cli/run/utils/initAppDir';
import { createAsyncHook } from '../../../../toolkit/plugin/src/hooks';
import { getFileSystemEntry } from '../../../app-tools/src/plugins/analyze/getFileSystemEntry';
import type { CheckEntryPointFn } from '../../../app-tools/src/types/plugin-base';
import { initAppContext } from '../../../app-tools/src/utils/initAppContext';
import { resolveEffectTsgoCompiler } from '../../../app-tools-extensions/src/build-config/build-environment';

import {
  isConfigInstalledDependencyPath,
  withConfigDependencyResolution,
} from '../../src/native-composition/config-evaluator/dependency-resolution';
import { initializeOwningConfigNativeBinding } from '../../src/native-composition/config-evaluator/native-bootstrap';
import {
  type ObservedConfigSourceInputs,
  observeConfigSourceInputs,
} from '../../src/native-composition/config-evaluator/observed-inputs';
import { captureConfigSourceSnapshot } from '../../src/native-composition/config-evaluator/source-snapshot';
import { nativeRendererInfrastructurePlugin } from '../../src/native-composition/native-infrastructure';

// The source API delegates to the same installed CJS selection authority.
const {
  installEffectCompilerSelectionValidator,
  resolveEffectCompilerSelection,
}: typeof import('../../../app-tools-extensions/src/build-config/internal-effect-discovery') =
  createRequire(
    path.resolve(__dirname, '../../../app-tools-extensions/package.json'),
  )('@modern-js/app-tools-extensions/internal-effect-discovery');

async function fixture(run: (root: string) => Promise<void>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'um-observed-inputs-',
      ),
    ),
  );
  fs.writeFileSync(path.join(root, 'input.json'), '{"renderer":"solid"}');
  try {
    await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function observations(inputs: ObservedConfigSourceInputs, root: string) {
  return inputs.observations.map(input => ({
    path: path.relative(root, input.path),
    canonicalPath: path.relative(root, input.canonicalPath),
    operation: input.operation,
    existed: input.existed,
  }));
}

const snapshot = (root: string) =>
  captureConfigSourceSnapshot({ sourceRoots: [root] });

async function coldDeploymentDependencies(
  run: (require: NodeJS.Require, fsRequire: NodeJS.Require) => Promise<void>,
) {
  const require = createRequire(
    path.resolve(__dirname, '../../../app-tools/package.json'),
  );
  const ndepeEntry = require.resolve('ndepe');
  const ndepeRequire = createRequire(ndepeEntry);
  const fsExtraEntry = ndepeRequire.resolve('fs-extra');
  const fsRequire = createRequire(fsExtraEntry);
  const gracefulEntry = fsRequire.resolve('graceful-fs');
  const roots = [
    path.dirname(path.dirname(ndepeEntry)),
    path.dirname(path.dirname(fsExtraEntry)),
    path.dirname(gracefulEntry),
  ];
  const owned = (file: string) =>
    roots.some(root => file.startsWith(`${root}${path.sep}`));
  const previous = new Map(
    Object.entries(require.cache).filter(([file]) => owned(file)),
  );
  for (const file of previous.keys()) delete require.cache[file];
  try {
    await run(require, fsRequire);
  } finally {
    for (const file of Object.keys(require.cache))
      if (owned(file)) delete require.cache[file];
    for (const [file, cached] of previous) require.cache[file] = cached;
  }
}

describe('native entry path-kind provenance', () => {
  it('preserves real filesystem entries and records only the root kind checks', async () =>
    fixture(async root => {
      const src = path.join(root, 'src');
      const app = path.join(src, 'App.tsx');
      fs.mkdirSync(src);
      fs.writeFileSync(app, 'export default () => null;');
      const checkEntryPoint = createAsyncHook<CheckEntryPointFn>();
      checkEntryPoint.tap(input => ({ ...input, entry: app }));
      const config = { source: { entriesDir: './src' } };
      const baseline = await observeConfigSourceInputs(snapshot(root), () =>
        getFileSystemEntry({ checkEntryPoint }, { appDirectory: root }, config),
      );
      const observed = await observeConfigSourceInputs(snapshot(root), reader =>
        getFileSystemEntry(
          { checkEntryPoint },
          { appDirectory: root, packageMetadataRead: reader },
          config,
        ),
      );
      expect(observed.value).toEqual(baseline.value);
      expect(observed.value[0].entry).toBe(app);
      expect(observations(observed.consumedSourceInputs, root)).toContainEqual({
        path: 'src',
        canonicalPath: 'src',
        operation: 'entry-kind',
        existed: true,
      });
      expect(
        observed.consumedSourceInputs.observations.filter(
          input => input.path === src,
        ),
      ).toHaveLength(1);
      expect(observed.consumedSourceInputs.observations).toEqual(
        baseline.consumedSourceInputs.observations.map(input =>
          input.path === src ? { ...input, operation: 'entry-kind' } : input,
        ),
      );
    }));

  it('uses the actual native routes hook without relabeling App candidates', async () =>
    fixture(async root => {
      const src = path.join(root, 'src');
      const routes = path.join(src, 'routes');
      fs.mkdirSync(routes, { recursive: true });
      const manager = createPluginManager();
      manager.addPlugins([
        appTools({ rendererExtensions: false, serverExtensions: false }),
        nativeRendererInfrastructurePlugin('solid'),
      ]);
      const plugins = manager.getPlugins();
      const config = {
        renderer: 'solid',
        source: { entriesDir: './src', mainEntryName: 'main' },
        server: { ssr: false },
        output: { cleanDistPath: false },
      };
      const context = await createContext<AppTools>({
        appContext: initCLIAppContext({
          packageName: 'entry-kind-proof',
          configFile: false,
          command: 'build',
          appDirectory: root,
          metaName: 'modern-js',
          plugins,
        }),
        config,
        normalizedConfig: config as AppNormalizedConfig,
      });
      const api = initPluginAPI({ context, pluginManager: manager });
      context.pluginAPI = api;
      for (const plugin of plugins)
        await plugin.setup?.(api as CLIPluginAPI<AppTools>);
      const baseline = await api
        .getHooks()
        .checkEntryPoint.call({ path: src, entry: false });
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async reader => {
          api.updateAppContext({ packageMetadataRead: reader });
          return api
            .getHooks()
            .checkEntryPoint.call({ path: src, entry: false });
        },
      );
      expect(observed.value).toEqual(baseline);
      expect(observed.value.entry).toBe(routes);
      expect(observations(observed.consumedSourceInputs, root)).toContainEqual({
        path: 'src/routes',
        canonicalPath: 'src/routes',
        operation: 'entry-kind',
        existed: true,
      });
      expect(observations(observed.consumedSourceInputs, root)).toContainEqual({
        path: 'src/App.tsx',
        canonicalPath: 'src/App.tsx',
        operation: 'metadata',
        existed: false,
      });
    }));

  it('keeps authored hook stat, listing and content reads ordinary', async () =>
    fixture(async root => {
      const src = path.join(root, 'src');
      const app = path.join(src, 'App.tsx');
      fs.mkdirSync(src);
      fs.writeFileSync(app, 'export default () => null;');
      const checkEntryPoint = createAsyncHook<CheckEntryPointFn>();
      checkEntryPoint.tap(input => {
        fs.statSync(src);
        fs.readdirSync(src);
        fs.readFileSync(app, 'utf8');
        return { ...input, entry: app };
      });
      const observed = await observeConfigSourceInputs(snapshot(root), reader =>
        getFileSystemEntry(
          { checkEntryPoint },
          { appDirectory: root, packageMetadataRead: reader },
          { source: { entriesDir: './src' } },
        ),
      );
      const inputs = observations(observed.consumedSourceInputs, root);
      for (const operation of ['entry-kind', 'metadata', 'directory'])
        expect(inputs).toContainEqual({
          path: 'src',
          canonicalPath: 'src',
          operation,
          existed: true,
        });
      expect(inputs).toContainEqual({
        path: 'src/App.tsx',
        canonicalPath: 'src/App.tsx',
        operation: 'content',
        existed: true,
      });
    }));

  it.each([
    'missing',
    'file',
  ] as const)('preserves the native %s source error and candidate existence', async kind =>
    fixture(async root => {
      const src = path.join(root, 'src');
      if (kind === 'file') fs.writeFileSync(src, 'not a directory');
      const checkEntryPoint = createAsyncHook<CheckEntryPointFn>();
      const config = { source: { entriesDir: './src' } };
      const baseline = await getFileSystemEntry(
        { checkEntryPoint },
        { appDirectory: root },
        config,
      ).catch(error => error);
      const observed = await observeConfigSourceInputs(snapshot(root), reader =>
        getFileSystemEntry(
          { checkEntryPoint },
          { appDirectory: root, packageMetadataRead: reader },
          config,
        ).catch(error => error),
      );
      expect(observed.value).toBeInstanceOf(Error);
      expect(observed.value.message).toBe(baseline.message);
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: 'src',
          canonicalPath: 'src',
          operation: 'entry-kind',
          existed: kind === 'file',
        },
      ]);
    }));

  it('retains synchronous, callback and promise stat results and missing errors', async () =>
    fixture(async root => {
      const src = path.join(root, 'src');
      const absent = path.join(root, 'absent');
      fs.mkdirSync(src);
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async reader => {
          if (!reader.entryPathRead)
            throw new Error('Missing native entry path reader');
          let nativeStat: fs.Stats | undefined;
          const syncStat = reader.entryPathRead(() => {
            nativeStat = fs.statSync(src);
            return nativeStat;
          });
          expect(syncStat).toBe(nativeStat);
          expect(syncStat.isDirectory()).toBe(true);
          const callbackStat = await new Promise<fs.Stats>((resolve, reject) =>
            reader.entryPathRead!(() =>
              fs.stat(src, (error, value) => {
                fs.statSync(src);
                return error ? reject(error) : resolve(value);
              }),
            ),
          );
          expect(callbackStat.isDirectory()).toBe(true);
          let nativePromise: Promise<fs.Stats> | undefined;
          const forwarded = reader.entryPathRead(() => {
            nativePromise = fsPromises.stat(src);
            return nativePromise;
          });
          expect(forwarded).toBe(nativePromise);
          expect((await forwarded).isDirectory()).toBe(true);
          let nativeError: unknown;
          try {
            reader.entryPathRead(() => {
              try {
                return fs.statSync(absent);
              } catch (error) {
                nativeError = error;
                throw error;
              }
            });
          } catch (error) {
            expect(error).toBe(nativeError);
          }
          await expect(
            reader.entryPathRead(() => fsPromises.stat(absent)),
          ).rejects.toHaveProperty('code', 'ENOENT');
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: 'absent',
          canonicalPath: 'absent',
          operation: 'entry-kind',
          existed: false,
        },
        {
          path: 'src',
          canonicalPath: 'src',
          operation: 'entry-kind',
          existed: true,
        },
        {
          path: 'src',
          canonicalPath: 'src',
          operation: 'metadata',
          existed: true,
        },
      ]);
    }));

  it('keeps non-kind operations and expired reader calls fully observed', async () =>
    fixture(async root => {
      const src = path.join(root, 'src');
      const input = path.join(root, 'input.json');
      fs.mkdirSync(src);
      let borrowed: ConfigPackageMetadataRead['entryPathRead'];
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async reader => {
          borrowed = reader.entryPathRead;
          if (!borrowed) throw new Error('Missing native entry path reader');
          borrowed(() => {
            fs.lstatSync(src);
            fs.readdirSync(src);
            fs.readFileSync(input, 'utf8');
          });
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: 'input.json',
          canonicalPath: 'input.json',
          operation: 'content',
          existed: true,
        },
        {
          path: 'src',
          canonicalPath: 'src',
          operation: 'directory',
          existed: true,
        },
        {
          path: 'src',
          canonicalPath: 'src',
          operation: 'metadata',
          existed: true,
        },
      ]);
      const later = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          if (!borrowed)
            throw new Error('Missing borrowed native entry path reader');
          expect(borrowed(() => fs.existsSync(src))).toBe(true);
          expect(borrowed(() => fs.statSync(src)).isDirectory()).toBe(true);
        },
      );
      expect(observations(later.consumedSourceInputs, root)).toEqual([
        {
          path: 'src',
          canonicalPath: 'src',
          operation: 'metadata',
          existed: true,
        },
      ]);
    }));
});

describe('native package discovery provenance', () => {
  it('retains the original upward search and promise while recording every candidate', async () =>
    fixture(async root => {
      const start = path.join(root, 'nested', 'deeper');
      fs.mkdirSync(start, { recursive: true });
      fs.writeFileSync(path.join(root, 'package.json'), '{"name":"found"}');
      const baseline = await initAppDir(start);
      let calls = 0;
      let nativeValue: unknown;
      let forwardedValue: unknown;
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async reader => {
          const forwarded: ConfigPackageMetadataRead = (file, field, read) =>
            reader(file, field, read);
          Object.defineProperty(forwarded, 'packageDiscoveryRead', {
            value: <T>(read: () => T): T => {
              const original = () => {
                calls++;
                const value = read();
                nativeValue = value;
                return value;
              };
              if (!reader.packageDiscoveryRead)
                throw new Error('Missing native package discovery reader');
              const value = reader.packageDiscoveryRead(original);
              forwardedValue = value;
              return value;
            },
          });
          return initAppDir(start, forwarded);
        },
      );
      expect(observed.value).toBe(baseline);
      expect(observed.value).toBe(root);
      expect(calls).toBe(1);
      expect(forwardedValue).toBe(nativeValue);
      expect(nativeValue).toBeInstanceOf(Promise);
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: 'nested/deeper/package.json',
          canonicalPath: 'nested/deeper/package.json',
          operation: 'existence',
          existed: false,
        },
        {
          path: 'nested/package.json',
          canonicalPath: 'nested/package.json',
          operation: 'existence',
          existed: false,
        },
        {
          path: 'package.json',
          canonicalPath: 'package.json',
          operation: 'existence',
          existed: true,
        },
      ]);
      expect(observed.consumedSourceInputs.packageMetadata).toEqual([]);
    }));

  it('retains authored metadata reads before and after the native search', async () =>
    fixture(async root => {
      const manifest = path.join(root, 'package.json');
      fs.writeFileSync(manifest, '{"name":"found"}');
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async reader => {
          const before = [fs.existsSync(manifest), fs.statSync(manifest).size];
          const found = await initAppDir(root, reader);
          const after = [fs.existsSync(manifest), fs.statSync(manifest).size];
          return { before, found, after };
        },
      );
      expect(observed.value.found).toBe(root);
      expect(observed.value.before).toEqual(observed.value.after);
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: 'package.json',
          canonicalPath: 'package.json',
          operation: 'existence',
          existed: true,
        },
        {
          path: 'package.json',
          canonicalPath: 'package.json',
          operation: 'metadata',
          existed: true,
        },
      ]);
    }));

  it('retains full content and stat observations inside the discovery scope', async () =>
    fixture(async root => {
      const manifest = path.join(root, 'package.json');
      const content = '{"name":"found","exports":{".":"./index.js"}}';
      fs.writeFileSync(manifest, content);
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async reader => {
          if (!reader.packageDiscoveryRead)
            throw new Error('Missing native package discovery reader');
          return reader.packageDiscoveryRead(async () => {
            const found = await initAppDir(root, reader);
            return {
              found,
              content: fs.readFileSync(manifest, 'utf8'),
              size: fs.statSync(manifest).size,
              ordinaryExists: fs.existsSync(path.join(root, 'input.json')),
            };
          });
        },
      );
      expect(observed.value).toEqual({
        found: root,
        content,
        size: Buffer.byteLength(content),
        ordinaryExists: true,
      });
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: 'input.json',
          canonicalPath: 'input.json',
          operation: 'metadata',
          existed: true,
        },
        {
          path: 'package.json',
          canonicalPath: 'package.json',
          operation: 'content',
          existed: true,
        },
        {
          path: 'package.json',
          canonicalPath: 'package.json',
          operation: 'existence',
          existed: true,
        },
        {
          path: 'package.json',
          canonicalPath: 'package.json',
          operation: 'metadata',
          existed: true,
        },
      ]);
    }));

  it('preserves native discovery errors and restores observation after rejection', async () =>
    fixture(async root => {
      const invalid = Symbol('invalid native cwd');
      const describeError = (error: unknown) =>
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              code: 'code' in error ? error.code : undefined,
            }
          : error;
      const original = await Reflect.apply(initAppDir, undefined, [
        invalid,
      ]).catch((error: unknown) => error);
      let nativeError: unknown;
      const actual = await observeConfigSourceInputs(
        snapshot(root),
        async reader => {
          try {
            return await Reflect.apply(initAppDir, undefined, [
              invalid,
              reader,
            ]);
          } catch (error) {
            nativeError = error;
            throw error;
          }
        },
      ).catch(error => error);
      expect(actual).toBe(nativeError);
      expect(describeError(actual)).toEqual(describeError(original));
      expect(original).toBeInstanceOf(TypeError);
      const recovered = await observeConfigSourceInputs(
        snapshot(root),
        async () => fs.existsSync(path.join(root, 'input.json')),
      );
      expect(observations(recovered.consumedSourceInputs, root)).toEqual([
        {
          path: 'input.json',
          canonicalPath: 'input.json',
          operation: 'metadata',
          existed: true,
        },
      ]);
    }));

  it('does not reuse discovery provenance after its original owner has completed', async () =>
    fixture(async root => {
      fs.writeFileSync(path.join(root, 'package.json'), '{"name":"found"}');
      let priorReader: ConfigPackageMetadataRead | undefined;
      await observeConfigSourceInputs(snapshot(root), async reader => {
        priorReader = reader;
        return initAppDir(root, reader);
      });
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => initAppDir(root, priorReader),
      );
      expect(observed.value).toBe(root);
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: 'package.json',
          canonicalPath: 'package.json',
          operation: 'metadata',
          existed: true,
        },
      ]);
    }));

  it('retains canonical symlink evidence and the original lexical directory result', async () =>
    fixture(async root => {
      const app = path.join(root, 'app');
      const alias = path.join(root, 'alias');
      fs.mkdirSync(app);
      fs.writeFileSync(path.join(app, 'package.json'), '{"name":"found"}');
      fs.symlinkSync('app', alias);
      const baseline = await initAppDir(alias);
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async reader => initAppDir(alias, reader),
      );
      expect(observed.value).toBe(baseline);
      expect(observed.value).toBe(alias);
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: 'alias/package.json',
          canonicalPath: 'app/package.json',
          operation: 'existence',
          existed: true,
        },
      ]);
    }));

  it('rejects an ancestor candidate outside captured source coverage', async () =>
    fixture(async root => {
      const app = path.join(root, 'app');
      fs.mkdirSync(app);
      fs.writeFileSync(path.join(root, 'package.json'), '{"name":"ancestor"}');
      await expect(
        observeConfigSourceInputs(snapshot(app), async reader =>
          initAppDir(app, reader),
        ),
      ).rejects.toThrow('uncovered source path');
    }));
});

describe('actual config authority source observations', () => {
  it('resumes the real graceful-fs/fs-extra/ndepe deployment copy after observation', async () =>
    fixture(async root => {
      const dependency = path.join(root, 'node_modules', 'copied-dependency');
      const output = path.join(root, 'dist');
      fs.mkdirSync(dependency, { recursive: true });
      fs.mkdirSync(output);
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          name: 'deployment-copy-proof',
          private: true,
          dependencies: { 'copied-dependency': '1.0.0' },
        }),
      );
      fs.writeFileSync(
        path.join(dependency, 'package.json'),
        JSON.stringify({
          name: 'copied-dependency',
          version: '1.0.0',
          main: './index.js',
        }),
      );
      fs.writeFileSync(
        path.join(dependency, 'index.js'),
        'module.exports = 42;\n',
      );
      fs.writeFileSync(
        path.join(output, 'server.js'),
        'module.exports = require("copied-dependency");\n',
      );
      await coldDeploymentDependencies(async (require, fsRequire) => {
        const captured = await observeConfigSourceInputs(
          snapshot(root),
          async () => {
            const ndepeRequire = createRequire(require.resolve('ndepe'));
            return {
              graceful: fsRequire('graceful-fs'),
              fsExtra: ndepeRequire('fs-extra'),
              nodeDepEmit: require('ndepe').nodeDepEmit,
              realpath: fs.realpathSync.native,
            };
          },
        );
        await captured.value.nodeDepEmit({ appDir: root, sourceDir: output });
        const copied = path.join(output, 'node_modules', 'copied-dependency');
        expect(fs.readFileSync(path.join(copied, 'index.js'), 'utf8')).toBe(
          'module.exports = 42;\n',
        );
        expect(
          JSON.parse(
            fs.readFileSync(path.join(copied, 'package.json'), 'utf8'),
          ),
        ).toMatchObject({ name: 'copied-dependency', version: '1.0.0' });
        const later = await observeConfigSourceInputs(
          snapshot(root),
          async () => {
            expect(captured.value.realpath(path.join(root, 'input.json'))).toBe(
              path.join(root, 'input.json'),
            );
            expect(
              captured.value.graceful.readFileSync(
                path.join(root, 'input.json'),
                'utf8',
              ),
            ).toContain('solid');
          },
        );
        expect(observations(later.consumedSourceInputs, root)).toEqual(
          expect.arrayContaining([
            {
              path: 'input.json',
              canonicalPath: 'input.json',
              operation: 'metadata',
              existed: true,
            },
            {
              path: 'input.json',
              canonicalPath: 'input.json',
              operation: 'content',
              existed: true,
            },
          ]),
        );
        const forbiddenCopy = path.join(root, 'forbidden-copy.json');
        await expect(
          observeConfigSourceInputs(snapshot(root), async () => {
            try {
              await captured.value.fsExtra.copyFile(
                path.join(root, 'input.json'),
                forbiddenCopy,
              );
            } catch {
              /* A retained wrapper cannot bypass the later observer. */
            }
          }),
        ).rejects.toThrow('fs.copyFile');
        expect(fs.existsSync(forbiddenCopy)).toBe(false);
      });
    }));

  it('expires captured deployment callbacks after failure without changing callback errors', async () =>
    fixture(async root => {
      await coldDeploymentDependencies(async (_require, fsRequire) => {
        let graceful: typeof fs | undefined;
        const originalError = new Error('original configuration failure');
        await expect(
          observeConfigSourceInputs(snapshot(root), async () => {
            graceful = fsRequire('graceful-fs');
            throw originalError;
          }),
        ).rejects.toBe(originalError);
        if (!graceful) throw new Error('Cold graceful-fs was not captured');
        let callbacks = 0;
        const copied = path.join(root, 'copied.json');
        await new Promise<void>((resolve, reject) =>
          graceful!.copyFile(path.join(root, 'input.json'), copied, error => {
            callbacks++;
            if (error) reject(error);
            else resolve();
          }),
        );
        expect(callbacks).toBe(1);
        expect(fs.readFileSync(copied, 'utf8')).toContain('solid');
        const missing = path.join(root, 'missing.json');
        await expect(
          promisify(graceful.copyFile)(missing, copied),
        ).rejects.toMatchObject({
          code: 'ENOENT',
          syscall: 'copyfile',
          path: missing,
        });
      });
    }));

  it('ignores arbitrary later builtin wrappers when expired calls resume', async () =>
    fixture(async root => {
      const original = fs.copyFile;
      const captured = await observeConfigSourceInputs(
        snapshot(root),
        async () => fs.copyFile,
      );
      let externalCalls = 0;
      fs.copyFile = (...args) => {
        externalCalls++;
        return captured.value(...args);
      };
      try {
        await promisify(captured.value)(
          path.join(root, 'input.json'),
          path.join(root, 'copied.json'),
        );
        expect(externalCalls).toBe(0);
        expect(
          fs.readFileSync(path.join(root, 'copied.json'), 'utf8'),
        ).toContain('solid');
      } finally {
        fs.copyFile = original;
      }
    }));

  it('observes later external read wrappers without recursion or forbidden-operation bypass', async () =>
    fixture(async root => {
      const input = path.join(root, 'input.json');
      const inner = path.join(root, 'inner.json');
      const copy = path.join(root, 'forbidden-nested-copy.json');
      fs.writeFileSync(inner, '{"renderer":"octane"}');
      const baseline = snapshot(root);
      const original = fs.readFileSync;
      const captured = await observeConfigSourceInputs(baseline, async () => ({
        readFileSync: fs.readFileSync,
        copyFile: fsPromises.copyFile,
      }));
      let nestedCopy = false;
      fs.readFileSync = function (...args) {
        if (args[0] !== input)
          return captured.value.readFileSync.apply(this, args);
        if (nestedCopy) {
          try {
            void captured.value.copyFile(input, copy);
          } catch {
            /* A supported native read does not authorize copyFile. */
          }
        }
        return captured.value.readFileSync.call(this, inner, 'utf8');
      };
      try {
        const later = await observeConfigSourceInputs(baseline, async () =>
          fs.readFileSync(input, 'utf8'),
        );
        expect(later.value).toContain('octane');
        expect(observations(later.consumedSourceInputs, root)).toEqual([
          {
            path: 'inner.json',
            canonicalPath: 'inner.json',
            operation: 'content',
            existed: true,
          },
          {
            path: 'input.json',
            canonicalPath: 'input.json',
            operation: 'content',
            existed: true,
          },
        ]);
        await expect(
          observeConfigSourceInputs(baseline, async () => {
            nestedCopy = true;
            return fs.readFileSync(input, 'utf8');
          }),
        ).rejects.toThrow('fs.promises.copyFile');
        expect(fs.existsSync(copy)).toBe(false);
      } finally {
        fs.readFileSync = original;
      }
    }));

  it.each([
    'require',
    'import',
  ] as const)('routes retained source wrappers through the genuine public %s config-load phase', async format =>
    fixture(async root => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'public-observation', private: true }),
      );
      const manifestFile = path.resolve(__dirname, '../../package.json');
      const ownerRequire = createRequire(manifestFile);
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const nativeImportFile = path.join(root, 'native-import.cjs');
      fs.writeFileSync(
        nativeImportFile,
        'module.exports = url => import(url);\n',
      );
      const nativeImport = createRequire(path.join(root, 'config.cjs'))(
        nativeImportFile,
      );
      // Read the actual published target, so this control uses the refreshed
      // package formats rather than a second source-loader instance.
      const namespace =
        format === 'require'
          ? ownerRequire('@modern-js/ultramodern-app-tools/native-config-load')
          : await nativeImport(
              pathToFileURL(
                path.resolve(
                  path.dirname(manifestFile),
                  manifest.exports['./native-config-load'].node.import.default,
                ),
              ).href,
            );
      const captured = await observeConfigSourceInputs(
        snapshot(root),
        async () => ({
          copyFile: fs.copyFile,
          readFileSync: fs.readFileSync,
          realpath: fs.realpathSync.native,
        }),
      );
      const integration = namespace.createNativeConfigLoad();
      const input = path.join(root, 'input.json');
      const read = await integration.wrapConfigLoad(
        async () => {
          expect(captured.value.realpath(input)).toBe(input);
          expect(captured.value.readFileSync(input, 'utf8')).toContain('solid');
          return {
            packageName: 'public-observation',
            configFile: false,
            config: {},
          };
        },
        { appDirectory: root, configFile: false },
      );
      expect(read.packageName).toBe('public-observation');
      const copy = path.join(root, 'forbidden-public-copy.json');
      await expect(
        integration.wrapConfigLoad(
          async () => {
            try {
              await promisify(captured.value.copyFile)(input, copy);
            } catch {
              /* The public owner must retain sticky active denial. */
            }
            return {
              packageName: 'public-observation',
              configFile: false,
              config: {},
            };
          },
          { appDirectory: root, configFile: false },
        ),
      ).rejects.toThrow('fs.copyFile');
      expect(fs.existsSync(copy)).toBe(false);
    }));

  it('preserves expired Worker construction and denies it during later observation', async () =>
    fixture(async root => {
      const captured = await observeConfigSourceInputs(
        snapshot(root),
        async () => workerThreads.Worker,
      );
      const worker = new captured.value(
        'require("node:worker_threads").parentPort.postMessage(42)',
        { eval: true },
      );
      const message = new Promise(resolve => worker.once('message', resolve));
      const exit = new Promise(resolve => worker.once('exit', resolve));
      expect(worker).toBeInstanceOf(workerThreads.Worker);
      expect(await message).toBe(42);
      expect(await exit).toBe(0);
      await expect(
        observeConfigSourceInputs(snapshot(root), async () => {
          new captured.value('0', { eval: true });
        }),
      ).rejects.toThrow('worker_threads.Worker');
    }));

  it('records the original native automatic package name without changing its cached value', async () =>
    fixture(async root => {
      const manifest = path.join(root, 'package.json');
      fs.writeFileSync(
        manifest,
        '{"name":"native-metadata","dependencies":{}}',
      );
      const author = createRequire(path.join(root, 'config.cjs'));
      const cached = author(manifest);
      let reads = 0;
      let nativeResult: unknown;
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        packageMetadataRead =>
          createLoadedConfig(
            root,
            false,
            undefined,
            undefined,
            (file, field, read) => {
              reads++;
              const value = packageMetadataRead(file, field, read);
              nativeResult = value;
              return value;
            },
          ),
      );
      expect(reads).toBe(1);
      expect(await nativeResult).toBe(cached);
      expect(observed.value.packageName).toBe('native-metadata');
      expect(observed.consumedSourceInputs.observations).toEqual([]);
      expect(observed.consumedSourceInputs.packageMetadata).toEqual([
        {
          path: manifest,
          canonicalPath: manifest,
          field: 'name',
          value: 'native-metadata',
        },
      ]);
      expect(
        Object.isFrozen(observed.consumedSourceInputs.packageMetadata),
      ).toBe(true);
      expect(
        Object.isFrozen(observed.consumedSourceInputs.packageMetadata[0]),
      ).toBe(true);
    }));

  it.each([
    'before',
    'after',
  ] as const)('keeps authored manifest reads and imports %s both native automatic metadata calls', async order =>
    fixture(async root => {
      const manifest = path.join(root, 'package.json');
      fs.writeFileSync(
        manifest,
        '{"name":"native-metadata","dependencies":{}}',
      );
      const author = createRequire(path.join(root, 'config.cjs'));
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async packageMetadataRead => {
          const readAuthored = () => {
            expect(JSON.parse(fs.readFileSync(manifest, 'utf8')).name).toBe(
              'native-metadata',
            );
            expect(author(manifest).name).toBe('native-metadata');
          };
          if (order === 'before') readAuthored();
          const loaded = await createLoadedConfig(
            root,
            false,
            undefined,
            undefined,
            packageMetadataRead,
          );
          expect(loaded.packageName).toBe('native-metadata');
          const context = initAppContext({
            metaName: 'modern-js',
            appDirectory: root,
            runtimeConfigFile: '',
            packageMetadataRead,
          });
          expect(context.moduleType).toBe('commonjs');
          if (order === 'after') readAuthored();
        },
      );
      expect(observed.consumedSourceInputs.packageMetadata).toHaveLength(2);
      for (const operation of ['content', 'module']) {
        expect(
          observed.consumedSourceInputs.observations.some(
            input =>
              input.path === manifest &&
              input.operation === operation &&
              input.existed,
          ),
        ).toBe(true);
      }
    }));

  it('preserves the original native automatic manifest reader error', async () =>
    fixture(async root => {
      const manifest = path.join(root, 'package.json');
      fs.writeFileSync(manifest, '{invalid JSON');
      let originalError: unknown;
      let nativeResult: unknown;
      const observed = observeConfigSourceInputs(
        snapshot(root),
        packageMetadataRead =>
          createLoadedConfig(
            root,
            false,
            undefined,
            undefined,
            (file, field, read) => {
              const value = packageMetadataRead(file, field, read);
              nativeResult = value;
              return value;
            },
          ),
      );
      await expect(observed).rejects.toBeInstanceOf(SyntaxError);
      try {
        await nativeResult;
      } catch (error) {
        originalError = error;
      }
      await expect(observed).rejects.toBe(originalError);
    }));

  it.each([
    { type: undefined, expected: 'commonjs' },
    { type: 'module', expected: 'module' },
    { type: 'commonjs', expected: 'commonjs' },
    { type: false, expected: 'commonjs' },
  ])('records the original native effective module type $expected for $type', async ({
    type,
    expected,
  }) =>
    fixture(async root => {
      const manifest = path.join(root, 'package.json');
      fs.writeFileSync(
        manifest,
        JSON.stringify({ name: 'native-metadata', type }),
      );
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async packageMetadataRead => {
          const context = initAppContext({
            metaName: 'modern-js',
            appDirectory: root,
            runtimeConfigFile: '',
            packageMetadataRead,
          });
          expect(context.moduleType).toBe(expected);
          return context.moduleType;
        },
      );
      expect(observed.value).toBe(expected);
      expect(observed.consumedSourceInputs.packageMetadata).toEqual([
        {
          path: manifest,
          canonicalPath: manifest,
          field: 'type',
          value: expected,
        },
      ]);
      expect(
        observed.consumedSourceInputs.observations.some(
          input => input.path === manifest,
        ),
      ).toBe(false);
    }));

  it('preserves the original synchronous native module-type reader error', async () =>
    fixture(async root => {
      const manifest = path.join(root, 'package.json');
      fs.writeFileSync(manifest, '{invalid JSON');
      let originalError: unknown;
      const observed = observeConfigSourceInputs(
        snapshot(root),
        async packageMetadataRead =>
          initAppContext({
            metaName: 'modern-js',
            appDirectory: root,
            runtimeConfigFile: '',
            packageMetadataRead: (file, field, read) =>
              packageMetadataRead(file, field, () => {
                try {
                  return read();
                } catch (error) {
                  originalError = error;
                  throw error;
                }
              }),
          }),
      );
      await expect(observed).rejects.toBeInstanceOf(SyntaxError);
      await expect(observed).rejects.toBe(originalError);
    }));

  it('does not retain automatic metadata authority after its owning load', async () =>
    fixture(async root => {
      const manifest = path.join(root, 'package.json');
      fs.writeFileSync(manifest, '{"name":"native-metadata","type":"module"}');
      let priorReader: ConfigPackageMetadataRead | undefined;
      await observeConfigSourceInputs(snapshot(root), async read => {
        priorReader = read;
      });
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          if (!priorReader) throw new Error('Missing prior metadata reader');
          return priorReader(
            manifest,
            'type',
            () =>
              JSON.parse(fs.readFileSync(manifest, 'utf8')).type || 'commonjs',
          );
        },
      );
      expect(observed.value).toBe('module');
      expect(observed.consumedSourceInputs.packageMetadata).toEqual([]);
      expect(
        observed.consumedSourceInputs.observations.some(
          input => input.path === manifest && input.operation === 'content',
        ),
      ).toBe(true);
    }));

  it.each([
    '?probe=1',
    '#probe=1',
  ])('rejects authored native ESM binding URL alias %s even when caught', async suffix =>
    fixture(async root => {
      const binding = initializeOwningConfigNativeBinding();
      await expect(
        observeConfigSourceInputs(
          snapshot(root),
          async () => {
            try {
              await import(`${binding.bindingURL}${suffix}`);
            } catch {}
            return 'solid';
          },
          undefined,
          undefined,
          binding,
        ),
      ).rejects.toThrow('native binding module');
    }));

  it('permits the exact installed owner edge and rejects authored cached binding access', async () =>
    fixture(async root => {
      const binding = initializeOwningConfigNativeBinding();
      const owner = createRequire(binding.ownerURL);
      const author = createRequire(path.join(root, 'config.cjs'));
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => owner('@rspack/binding'),
        undefined,
        undefined,
        binding,
      );
      expect(observed.value.EXPECTED_RSPACK_CORE_VERSION).toBe('2.2.7');
      await expect(
        observeConfigSourceInputs(
          snapshot(root),
          async () => {
            try {
              author(fileURLToPath(binding.bindingURL));
            } catch {}
            return 'solid';
          },
          undefined,
          undefined,
          binding,
        ),
      ).rejects.toThrow('native binding module');
    }));

  it('denies authored access to the already initialized native addon', async () =>
    fixture(async root => {
      const anchor = path.resolve(__dirname, '../../package.json');
      initializeOwningConfigNativeBinding();
      const req = createRequire(anchor);
      const rsbuild = createRequire(req.resolve('@rsbuild/core/package.json'));
      const rspack = createRequire(
        rsbuild.resolve('@rspack/core/package.json'),
      );
      const binding = rspack.resolve('@rspack/binding');
      const nativeFiles = Object.keys(req.cache).filter(filename =>
        filename.endsWith('.node'),
      );
      expect(req.cache[binding]).toBeDefined();
      expect(nativeFiles.length).toBeGreaterThan(0);
      const author = createRequire(path.join(root, 'config.cjs'));
      await expect(
        observeConfigSourceInputs(snapshot(root), async () => {
          try {
            author(nativeFiles[0]);
          } catch {}
          return 'solid';
        }),
      ).rejects.toThrow('native module');
    }));
  it('observes sync, callback and promise path reads without replaying evaluation', async () =>
    fixture(async root => {
      const input = path.join(root, 'input.json');
      let calls = 0;
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          calls++;
          const sync = fs.readFileSync(input, 'utf8');
          const callback = await new Promise<string>((resolve, reject) =>
            fs.readFile(input, 'utf8', (error, value) =>
              error ? reject(error) : resolve(value),
            ),
          );
          const promise = await fsPromises.readFile(input, 'utf8');
          expect(sync).toBe(callback);
          expect(callback).toBe(promise);
          return JSON.parse(promise).renderer;
        },
      );
      expect(calls).toBe(1);
      expect(observed.value).toBe('solid');
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: 'input.json',
          canonicalPath: 'input.json',
          operation: 'content',
          existed: true,
        },
      ]);
      expect(Object.isFrozen(observed.consumedSourceInputs)).toBe(true);
      expect(Object.isFrozen(observed.consumedSourceInputs.observations)).toBe(
        true,
      );
      expect(
        Object.isFrozen(observed.consumedSourceInputs.observations[0]),
      ).toBe(true);
    }));

  it('records actual missing existence probes and directory enumeration', async () =>
    fixture(async root => {
      const absent = path.join(root, 'future-artifact.json');
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          expect(fs.existsSync(absent)).toBe(false);
          expect(await promisify(fs.exists)(absent)).toBe(false);
          expect(
            await new Promise<boolean>(resolve => fs.exists(absent, resolve)),
          ).toBe(false);
          await expect(fsPromises.stat(absent)).rejects.toThrow();
          expect(fs.readdirSync(root)).toEqual(['input.json']);
          expect(await fsPromises.readdir(root)).toEqual(['input.json']);
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        { path: '', canonicalPath: '', operation: 'directory', existed: true },
        {
          path: 'future-artifact.json',
          canonicalPath: 'future-artifact.json',
          operation: 'metadata',
          existed: false,
        },
      ]);
    }));

  it.each([
    'statSync',
    'lstatSync',
  ] as const)('records native metadata probe %s absence without changing its return or errors', async method =>
    fixture(async root => {
      const input = path.join(root, 'input.json');
      const absent = path.join(root, '.env');
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          expect(fs[method](absent, { throwIfNoEntry: false })).toBeUndefined();
          expect(fs[method](input, { throwIfNoEntry: false })?.isFile()).toBe(
            true,
          );
          expect(() => fs[method](absent)).toThrow('ENOENT');
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: '.env',
          canonicalPath: '.env',
          operation: 'metadata',
          existed: false,
        },
        {
          path: 'input.json',
          canonicalPath: 'input.json',
          operation: 'metadata',
          existed: true,
        },
      ]);
    }));

  it('records native metadata probe stat callback and promise absence without changing their returns', async () =>
    fixture(async root => {
      const input = path.join(root, 'input.json');
      const absent = path.join(root, '.env');
      const callbackStat = (filename: string) =>
        new Promise<fs.Stats | undefined>((resolve, reject) =>
          fs.stat(filename, { throwIfNoEntry: false }, (error, value) =>
            error ? reject(error) : resolve(value),
          ),
        );
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          expect(await callbackStat(absent)).toBeUndefined();
          expect(
            await fsPromises.stat(absent, { throwIfNoEntry: false }),
          ).toBeUndefined();
          expect((await callbackStat(input))?.isFile()).toBe(true);
          expect(
            (await fsPromises.stat(input, { throwIfNoEntry: false }))?.isFile(),
          ).toBe(true);
          await expect(fsPromises.stat(absent)).rejects.toMatchObject({
            code: 'ENOENT',
          });
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: '.env',
          canonicalPath: '.env',
          operation: 'metadata',
          existed: false,
        },
        {
          path: 'input.json',
          canonicalPath: 'input.json',
          operation: 'metadata',
          existed: true,
        },
      ]);
    }));

  it('preserves native metadata probe lstat callback and promise errors', async () =>
    fixture(async root => {
      const input = path.join(root, 'input.json');
      const absent = path.join(root, '.env');
      const callbackLstat = (filename: string) =>
        new Promise<fs.Stats>((resolve, reject) =>
          fs.lstat(filename, (error, value) =>
            error ? reject(error) : resolve(value),
          ),
        );
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          await expect(callbackLstat(absent)).rejects.toMatchObject({
            code: 'ENOENT',
          });
          await expect(fsPromises.lstat(absent)).rejects.toMatchObject({
            code: 'ENOENT',
          });
          expect((await callbackLstat(input)).isFile()).toBe(true);
          expect((await fsPromises.lstat(input)).isFile()).toBe(true);
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: '.env',
          canonicalPath: '.env',
          operation: 'metadata',
          existed: false,
        },
        {
          path: 'input.json',
          canonicalPath: 'input.json',
          operation: 'metadata',
          existed: true,
        },
      ]);
    }));

  it('preserves native metadata probe access success with an undefined return', async () =>
    fixture(async root => {
      const input = path.join(root, 'input.json');
      const absent = path.join(root, '.env');
      const callbackAccess = (filename: string) =>
        new Promise<void>((resolve, reject) =>
          fs.access(filename, error => (error ? reject(error) : resolve())),
        );
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          expect(fs.accessSync(input)).toBeUndefined();
          expect(await callbackAccess(input)).toBeUndefined();
          expect(await fsPromises.access(input)).toBeUndefined();
          expect(() => fs.accessSync(absent)).toThrow('ENOENT');
          await expect(callbackAccess(absent)).rejects.toMatchObject({
            code: 'ENOENT',
          });
          await expect(fsPromises.access(absent)).rejects.toMatchObject({
            code: 'ENOENT',
          });
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: '.env',
          canonicalPath: '.env',
          operation: 'metadata',
          existed: false,
        },
        {
          path: 'input.json',
          canonicalPath: 'input.json',
          operation: 'metadata',
          existed: true,
        },
      ]);
    }));

  it('observes native realpath APIs and preserves lexical symlink identity', async () =>
    fixture(async root => {
      const input = path.join(root, 'input.json');
      const link = path.join(root, 'linked.json');
      fs.symlinkSync('input.json', link);
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          expect(fs.realpathSync.native(link)).toBe(input);
          expect(
            await new Promise<string>((resolve, reject) =>
              fs.realpath.native(link, (error, value) =>
                error ? reject(error) : resolve(value),
              ),
            ),
          ).toBe(input);
          expect(fs.readFileSync(link, 'utf8')).toContain('solid');
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: 'linked.json',
          canonicalPath: 'input.json',
          operation: 'content',
          existed: true,
        },
        {
          path: 'linked.json',
          canonicalPath: 'input.json',
          operation: 'metadata',
          existed: true,
        },
      ]);
    }));

  it('observes real imported helpers and filesystem calls captured during module loading', async () =>
    fixture(async root => {
      const helper = path.join(root, 'helper.cjs');
      fs.writeFileSync(
        helper,
        "const {readFileSync} = require('node:fs'); module.exports = filename => readFileSync(filename, 'utf8');",
      );
      const owningRequire = createRequire(path.join(root, 'config.cjs'));
      try {
        const observed = await observeConfigSourceInputs(
          snapshot(root),
          async () => {
            const read = owningRequire('./helper.cjs');
            expect(read(path.join(root, 'input.json'))).toContain('solid');
          },
        );
        expect(observed.consumedSourceInputs.observations).toEqual([
          {
            path: helper,
            canonicalPath: helper,
            operation: 'metadata',
            existed: true,
          },
          {
            path: helper,
            canonicalPath: helper,
            operation: 'module',
            existed: true,
          },
          {
            path: path.join(root, 'input.json'),
            canonicalPath: path.join(root, 'input.json'),
            operation: 'content',
            existed: true,
          },
        ]);
      } finally {
        delete owningRequire.cache[helper];
      }
    }));

  it('observes native ESM helper imports and named builtin filesystem reads', async () =>
    fixture(async root => {
      const helper = path.join(root, 'helper.mjs');
      fs.writeFileSync(
        helper,
        "import {readFile} from 'node:fs/promises'; export default filename => readFile(filename, 'utf8');",
      );
      const nativeImport = new Function(
        'specifier',
        'return import(specifier)',
      );
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          const { default: read } = await nativeImport(
            pathToFileURL(helper).href,
          );
          expect(await read(path.join(root, 'input.json'))).toContain('solid');
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual(
        expect.arrayContaining([
          {
            path: 'helper.mjs',
            canonicalPath: 'helper.mjs',
            operation: 'module',
            existed: true,
          },
          {
            path: 'input.json',
            canonicalPath: 'input.json',
            operation: 'content',
            existed: true,
          },
        ]),
      );
    }));

  it('keeps bounded dependencies excluded and supported authored directory names included', async () =>
    fixture(async root => {
      fs.mkdirSync(path.join(root, 'node_modules'));
      fs.writeFileSync(
        path.join(root, 'node_modules', 'dependency.json'),
        '{}',
      );
      fs.mkdirSync(path.join(root, 'apps', 'dist'), { recursive: true });
      fs.writeFileSync(path.join(root, 'apps', 'dist', 'authored.json'), '{}');
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          fs.readFileSync(path.join(root, 'node_modules', 'dependency.json'));
          fs.readFileSync(path.join(root, 'apps', 'dist', 'authored.json'));
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual([
        {
          path: 'apps/dist/authored.json',
          canonicalPath: 'apps/dist/authored.json',
          operation: 'content',
          existed: true,
        },
      ]);
    }));

  it.each([
    'descriptor',
    'stream',
    'promise-handle',
    'private',
    'subprocess',
    'worker',
    'native',
  ] as const)('fails closed for unsupported %s reads even if authored code catches the error', async operation =>
    fixture(async root => {
      const originalRead = fs.readFileSync;
      await expect(
        observeConfigSourceInputs(snapshot(root), async () => {
          try {
            if (operation === 'descriptor')
              fs.openSync(path.join(root, 'input.json'), 'r');
            if (operation === 'stream')
              fs.createReadStream(path.join(root, 'input.json'));
            if (operation === 'promise-handle')
              await fsPromises.open(path.join(root, 'input.json'), 'r');
            if (operation === 'private') Reflect.get(process, 'binding')('fs');
            if (operation === 'worker')
              new workerThreads.Worker('0', { eval: true });
            if (operation === 'native')
              Reflect.get(process, 'dlopen')({}, 'untracked.node');
            if (operation === 'subprocess')
              childProcess.execFileSync(process.execPath, ['--version']);
          } catch {
            /* The evaluator must reject caught unsupported source IO too. */
          }
        }),
      ).rejects.toThrow('Unsupported config source observation');
      expect(fs.readFileSync).toBe(originalRead);
      expect(fs.readFileSync(path.join(root, 'input.json'), 'utf8')).toContain(
        'solid',
      );
    }));

  it('rejects filesystem option getters before hidden reads or subprocesses run', async () =>
    fixture(async root => {
      let calls = 0;
      await expect(
        observeConfigSourceInputs(snapshot(root), async () => {
          try {
            fs.readFileSync(path.join(root, 'input.json'), {
              get encoding() {
                calls++;
                childProcess.execFileSync(process.execPath, ['--version']);
                return 'utf8';
              },
            });
          } catch {
            /* Unsupported reads remain a session failure. */
          }
        }),
      ).rejects.toThrow('filesystem options containing accessors');
      expect(calls).toBe(0);
    }));

  it.each([
    'copy',
    'glob',
  ] as const)('fails closed for unobserved %s reads', async operation =>
    fixture(async root => {
      await expect(
        observeConfigSourceInputs(snapshot(root), async () => {
          try {
            if (operation === 'copy')
              fs.copyFileSync(
                path.join(root, 'input.json'),
                path.join(root, 'copied.json'),
              );
            else fs.globSync('*.json', { cwd: root });
          } catch {
            /* Unsupported reads remain a session failure. */
          }
        }),
      ).rejects.toThrow('Unsupported config source observation');
      expect(fs.existsSync(path.join(root, 'copied.json'))).toBe(false);
    }));

  it('observes caught explicit missing module resolution, and rejects extensionless probes', async () =>
    fixture(async root => {
      const owningRequire = createRequire(path.join(root, 'config.cjs'));
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          try {
            owningRequire.resolve('./optional.cjs');
          } catch {
            /* Optional source is absent. */
          }
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual(
        expect.arrayContaining([
          {
            path: 'optional.cjs',
            canonicalPath: 'optional.cjs',
            operation: 'metadata',
            existed: false,
          },
        ]),
      );
      await expect(
        observeConfigSourceInputs(snapshot(root), async () => {
          try {
            owningRequire.resolve('./optional');
          } catch {
            /* Unsupported uncertainty stays a failure. */
          }
        }),
      ).rejects.toThrow('unresolved extensionless source import');
    }));

  it('rejects uncovered authored source reads rather than dropping their observation', async () =>
    fixture(async root => {
      const app = path.join(root, 'app');
      fs.mkdirSync(app);
      await expect(
        observeConfigSourceInputs(snapshot(app), async () => {
          fs.readFileSync(path.join(root, 'input.json'), 'utf8');
        }),
      ).rejects.toThrow('uncovered source path');
    }));

  it('resolves the owning installed Effect compiler through observed filesystem reads from an empty app', async () =>
    fixture(async root => {
      const from = path.join(root, 'modern.config.cjs');
      fs.writeFileSync(from, '{}');
      const generatorDirectory = path.resolve(
        __dirname,
        '../../../../toolkit/ultramodern-create',
      );
      const cwd = process.cwd();
      const observed = await withConfigDependencyResolution(
        { sourceRoots: [root], dependencyRoots: [generatorDirectory] },
        () => {
          const selection = resolveEffectCompilerSelection(from);
          return observeConfigSourceInputs(
            snapshot(root),
            async () => resolveEffectTsgoCompiler({ from }),
            isConfigInstalledDependencyPath,
            {
              selections: [selection],
              install: installEffectCompilerSelectionValidator,
            },
          );
        },
      );
      expect(fs.existsSync(observed.value)).toBe(true);
      expect(
        childProcess.execFileSync(observed.value, ['--version'], {
          encoding: 'utf8',
        }),
      ).toMatch(/Version 7\.0\.2/u);
      expect(process.cwd()).toBe(cwd);
      expect(fs.readdirSync(root)).toEqual(['input.json', 'modern.config.cjs']);
    }));

  it('rejects foreign provider subprocess requests even when authored config catches the error', async () =>
    fixture(async root => {
      const marker = path.join(root, 'foreign-ran');
      const cli = path.join(root, 'foreign.cjs');
      fs.writeFileSync(
        cli,
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
      );
      await expect(
        observeConfigSourceInputs(snapshot(root), async () => {
          try {
            childProcess.execFileSync(process.execPath, [cli, 'get-exe-path'], {
              cwd: root,
            });
          } catch {
            /* Must remain a session failure. */
          }
        }),
      ).rejects.toThrow('child_process.execFileSync');
      expect(fs.existsSync(marker)).toBe(false);
    }));

  it('rejects raw path normalization that would cross a symlink ancestor', async () =>
    fixture(async root => {
      fs.mkdirSync(path.join(root, 'deep', 'directory'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'deep', 'input.json'),
        'different authored source',
      );
      fs.symlinkSync('deep/directory', path.join(root, 'link'));
      const raw = `${root}/link/../input.json`;
      expect(fs.readFileSync(raw, 'utf8')).toBe('different authored source');
      await expect(
        observeConfigSourceInputs(snapshot(root), async () =>
          fs.readFileSync(raw, 'utf8'),
        ),
      ).rejects.toThrow('normalization crosses symlink ancestors');
    }));

  it('rejects an uncaptured external intermediate even when its final source is covered and the callback catches it', async () =>
    fixture(async root => {
      const source = path.join(root, 'source');
      const shortcut = path.join(root, 'shortcut');
      fs.mkdirSync(source);
      fs.writeFileSync(path.join(source, 'input.json'), '{}');
      fs.symlinkSync(path.join(source, 'input.json'), shortcut);
      const captured = snapshot(source);
      await expect(
        observeConfigSourceInputs(captured, async () => {
          try {
            fs.readFileSync(`${source}/../shortcut`, 'utf8');
          } catch {}
          return 'solid';
        }),
      ).rejects.toThrow('unbounded symlink intermediate');
    }));

  it('observes covered reentry through an explicitly snapshotted intermediate', async () =>
    fixture(async root => {
      const source = path.join(root, 'source');
      const shortcut = path.join(root, 'shortcut');
      fs.mkdirSync(source);
      const input = path.join(source, 'input.json');
      fs.writeFileSync(input, '{}');
      fs.symlinkSync(input, shortcut);
      const captured = captureConfigSourceSnapshot({
        sourceRoots: [source],
        extraInputs: [shortcut],
      });
      const observed = await observeConfigSourceInputs(captured, async () =>
        fs.readFileSync(`${source}/../shortcut`, 'utf8'),
      );
      expect(observed.value).toBe('{}');
      expect(observed.consumedSourceInputs.observations).toContainEqual({
        path: `${source}/../shortcut`,
        canonicalPath: input,
        operation: 'content',
        existed: true,
      });
    }));

  it('validates an external intermediate before excluding a lexical output ancestor', async () =>
    fixture(async root => {
      const source = path.join(root, 'source');
      const shortcut = path.join(root, 'shortcut');
      fs.mkdirSync(path.join(source, 'dist'), { recursive: true });
      const input = path.join(source, 'input.json');
      fs.writeFileSync(input, '{}');
      fs.symlinkSync(input, shortcut);
      const raw = `${source}/dist/../../shortcut`;
      expect(fs.readFileSync(raw, 'utf8')).toBe('{}');
      await expect(
        observeConfigSourceInputs(snapshot(source), async () =>
          fs.readFileSync(raw, 'utf8'),
        ),
      ).rejects.toThrow('unbounded symlink intermediate');
    }));

  it('rejects an uncaptured excluded-directory link to authored source and accepts an explicitly captured link', async () =>
    fixture(async root => {
      const output = path.join(root, 'dist');
      fs.mkdirSync(output);
      const link = path.join(output, 'link');
      const input = path.join(root, 'input.json');
      fs.symlinkSync(input, link);
      await expect(
        observeConfigSourceInputs(snapshot(root), async () =>
          fs.readFileSync(link, 'utf8'),
        ),
      ).rejects.toThrow('uncaptured symlink intermediate');
      const captured = captureConfigSourceSnapshot({
        sourceRoots: [root],
        extraInputs: [link],
      });
      const observed = await observeConfigSourceInputs(captured, async () =>
        fs.readFileSync(link, 'utf8'),
      );
      expect(observed.consumedSourceInputs.observations).toContainEqual({
        path: link,
        canonicalPath: input,
        operation: 'content',
        existed: true,
      });
    }));

  it('records decoded native ESM missing source URLs while retaining CJS filename literals', async () =>
    fixture(async root => {
      const helper = path.join(root, 'optional-probe.mjs');
      fs.writeFileSync(
        helper,
        "export default async () => { try { await import('./optional%20helper.mjs?probe=1'); } catch {} };",
      );
      const nativeImport = new Function(
        'specifier',
        'return import(specifier)',
      );
      const owningRequire = createRequire(path.join(root, 'config.cjs'));
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => {
          const { default: probe } = await nativeImport(
            pathToFileURL(helper).href,
          );
          await probe();
          try {
            owningRequire.resolve('./optional%20helper.cjs?probe=1');
          } catch {
            /* Literal CJS filename is absent. */
          }
        },
      );
      expect(observations(observed.consumedSourceInputs, root)).toEqual(
        expect.arrayContaining([
          {
            path: 'optional helper.mjs',
            canonicalPath: 'optional helper.mjs',
            operation: 'metadata',
            existed: false,
          },
          {
            path: 'optional%20helper.cjs?probe=1',
            canonicalPath: 'optional%20helper.cjs?probe=1',
            operation: 'metadata',
            existed: false,
          },
        ]),
      );
    }));

  it('rejects an uncaptured successful explicit native module link before canonicalization', async () =>
    fixture(async root => {
      const source = path.join(root, 'source');
      const shortcut = path.join(root, 'shortcut.mjs');
      fs.mkdirSync(source);
      const helper = path.join(source, 'helper.mjs');
      fs.writeFileSync(helper, "export default 'solid';");
      fs.symlinkSync(helper, shortcut);
      const nativeImport = new Function(
        'specifier',
        'return import(specifier)',
      );
      await expect(
        observeConfigSourceInputs(snapshot(source), async () =>
          nativeImport(pathToFileURL(shortcut).href),
        ),
      ).rejects.toThrow('unbounded symlink intermediate');
      const captured = captureConfigSourceSnapshot({
        sourceRoots: [source],
        extraInputs: [shortcut],
      });
      const observed = await observeConfigSourceInputs(captured, async () =>
        nativeImport(`${pathToFileURL(shortcut).href}?covered=1`),
      );
      expect(observed.value.default).toBe('solid');
      expect(observed.consumedSourceInputs.observations).toContainEqual({
        path: shortcut,
        canonicalPath: helper,
        operation: 'module',
        existed: true,
      });
    }));

  it('preserves installed workspace aliases without admitting arbitrary source shortcuts', async () =>
    fixture(async root => {
      const app = path.join(root, 'app');
      const plugin = path.join(root, 'packages', 'plugin');
      fs.mkdirSync(path.join(app, 'node_modules'), { recursive: true });
      fs.mkdirSync(plugin, { recursive: true });
      fs.writeFileSync(
        path.join(plugin, 'package.json'),
        JSON.stringify({
          name: 'fixture-plugin',
          version: '1.0.0',
          type: 'module',
          exports: './index.mjs',
        }),
      );
      const helper = path.join(plugin, 'index.mjs');
      fs.writeFileSync(helper, "export default 'solid';");
      const installed = path.join(app, 'node_modules', 'fixture-plugin');
      fs.symlinkSync(plugin, installed);
      const appManifest = path.join(app, 'package.json');
      fs.writeFileSync(
        appManifest,
        JSON.stringify({
          name: 'fixture-app',
          dependencies: { 'fixture-plugin': '1.0.0' },
        }),
      );
      const nativeImport = new Function(
        'specifier',
        'return import(specifier)',
      );
      const observed = await withConfigDependencyResolution(
        { sourceRoots: [root], dependencyRoots: [] },
        async () => {
          expect(createRequire(appManifest).resolve('fixture-plugin')).toBe(
            helper,
          );
          return observeConfigSourceInputs(
            snapshot(root),
            async () => {
              expect(
                fs.readFileSync(path.join(installed, 'index.mjs'), 'utf8'),
              ).toContain('solid');
              return nativeImport(
                pathToFileURL(path.join(installed, 'index.mjs')).href,
              );
            },
            isConfigInstalledDependencyPath,
          );
        },
      );
      expect(observed.value.default).toBe('solid');
      expect(observed.consumedSourceInputs.observations).toContainEqual({
        path: helper,
        canonicalPath: helper,
        operation: 'module',
        existed: true,
      });
    }));

  it('rejects an erased node_modules segment as authority for an external shortcut', async () =>
    fixture(async root => {
      const source = path.join(root, 'source');
      fs.mkdirSync(path.join(source, 'node_modules'), { recursive: true });
      const helper = path.join(source, 'helper.js');
      fs.writeFileSync(helper, "module.exports = 'solid';");
      const shortcut = path.join(root, 'shortcut.js');
      fs.symlinkSync(helper, shortcut);
      const raw = `${source}/node_modules/../../shortcut.js`;
      await expect(
        observeConfigSourceInputs(
          snapshot(source),
          async () => fs.readFileSync(raw, 'utf8'),
          isConfigInstalledDependencyPath,
        ),
      ).rejects.toThrow('unbounded symlink intermediate');
      const owningRequire = createRequire(path.join(source, 'config.cjs'));
      await expect(
        observeConfigSourceInputs(
          snapshot(source),
          async () => owningRequire(raw),
          isConfigInstalledDependencyPath,
        ),
      ).rejects.toThrow('unbounded symlink intermediate');
    }));

  it('rejects unbounded CJS extension probing while allowing covered extensionless helpers', async () =>
    fixture(async root => {
      const source = path.join(root, 'source');
      fs.mkdirSync(source);
      const helper = path.join(source, 'helper.js');
      fs.writeFileSync(helper, "module.exports = 'solid';");
      const shortcut = path.join(root, 'shortcut');
      fs.symlinkSync(helper, `${shortcut}.js`);
      const owningRequire = createRequire(path.join(source, 'config.cjs'));
      await expect(
        observeConfigSourceInputs(snapshot(source), async () =>
          owningRequire(shortcut),
        ),
      ).rejects.toThrow(
        'unbounded source request resolved through implicit Node candidates',
      );
      const observed = await observeConfigSourceInputs(
        snapshot(source),
        async () => owningRequire('./helper'),
      );
      expect(observed.value).toBe('solid');
    }));

  it('resolves the real installed caniuse-lite extensionless CJS path after Node normalizes dot segments', async () => {
    const owningRequire = createRequire(
      path.resolve(__dirname, '../../package.json'),
    );
    const babelRequire = createRequire(owningRequire.resolve('@babel/core'));
    const targetsRequire = createRequire(
      babelRequire.resolve('@babel/helper-compilation-targets'),
    );
    const browserslistRequire = createRequire(
      targetsRequire.resolve('browserslist'),
    );
    const caniuseRoot = path.dirname(
      browserslistRequire.resolve('caniuse-lite/package.json'),
    );
    const unpackerRequire = createRequire(
      path.join(caniuseRoot, 'dist/unpacker/browsers.js'),
    );
    const expected = unpackerRequire.resolve('../../data/browsers');
    const captured = captureConfigSourceSnapshot({
      sourceRoots: [caniuseRoot],
    });
    const observed = await observeConfigSourceInputs(
      captured,
      async () => {
        const selected = unpackerRequire.resolve('../../data/browsers');
        return { selected, browsers: unpackerRequire('../../data/browsers') };
      },
      isConfigInstalledDependencyPath,
    );
    expect(observed.value.selected).toBe(expected);
    expect(observed.value.browsers).toHaveProperty('A');
    expect(observed.consumedSourceInputs.observations).toEqual([]);
  });

  it('observes the preceding CJS file candidates without claiming lower-priority alternatives', async () =>
    fixture(async root => {
      fs.writeFileSync(
        path.join(root, 'helper.js'),
        "module.exports = 'solid';",
      );
      fs.writeFileSync(path.join(root, 'helper.json'), '"octane"');
      const owningRequire = createRequire(path.join(root, 'config.cjs'));
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => owningRequire('./helper'),
      );
      expect(observed.value).toBe('solid');
      const inputs = observations(observed.consumedSourceInputs, root);
      expect(inputs).toContainEqual({
        path: 'helper',
        canonicalPath: 'helper',
        operation: 'metadata',
        existed: false,
      });
      expect(inputs).toContainEqual({
        path: 'helper.js',
        canonicalPath: 'helper.js',
        operation: 'module',
        existed: true,
      });
      expect(inputs.some(input => input.path === 'helper.json')).toBe(false);
    }));

  it('observes the actual CJS directory main search and stops before the unused index fallback', async () =>
    fixture(async root => {
      const directory = path.join(root, 'helper');
      fs.mkdirSync(directory);
      fs.writeFileSync(
        path.join(directory, 'package.json'),
        '{"main":"./entry"}',
      );
      fs.writeFileSync(path.join(directory, 'entry.json'), '"solid"');
      fs.writeFileSync(
        path.join(directory, 'index.js'),
        "module.exports = 'octane';",
      );
      const owningRequire = createRequire(path.join(root, 'config.cjs'));
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => owningRequire('./helper/'),
      );
      expect(observed.value).toBe('solid');
      const inputs = observations(observed.consumedSourceInputs, root);
      expect(inputs).toContainEqual({
        path: 'helper/package.json',
        canonicalPath: 'helper/package.json',
        operation: 'content',
        existed: true,
      });
      expect(inputs).toContainEqual({
        path: 'helper/entry.js',
        canonicalPath: 'helper/entry.js',
        operation: 'metadata',
        existed: false,
      });
      expect(inputs).toContainEqual({
        path: 'helper/entry.json',
        canonicalPath: 'helper/entry.json',
        operation: 'module',
        existed: true,
      });
      expect(inputs.some(input => input.path === 'helper/index.js')).toBe(
        false,
      );
    }));

  it.each([
    './helper/',
    './helper/.',
    './helper/child/..',
  ])('preserves native CJS directory intent for %s despite a sibling file', async specifier =>
    fixture(async root => {
      const directory = path.join(root, 'helper');
      fs.mkdirSync(path.join(directory, 'child'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'helper.js'),
        "module.exports = 'octane';",
      );
      fs.writeFileSync(
        path.join(directory, 'index.js'),
        "module.exports = 'solid';",
      );
      const owningRequire = createRequire(path.join(root, 'config.cjs'));
      const observed = await observeConfigSourceInputs(
        snapshot(root),
        async () => owningRequire(specifier),
      );
      expect(observed.value).toBe('solid');
      const inputs = observations(observed.consumedSourceInputs, root);
      expect(inputs).toContainEqual({
        path: 'helper/package.json',
        canonicalPath: 'helper/package.json',
        operation: 'content',
        existed: false,
      });
      expect(inputs.some(input => input.path === 'helper.js')).toBe(false);
    }));

  it('rejects a new higher-priority candidate despite the native CJS resolution cache', async () =>
    fixture(async root => {
      fs.writeFileSync(
        path.join(root, 'helper.js'),
        "module.exports = 'solid';",
      );
      const owningRequire = createRequire(path.join(root, 'config.cjs'));
      await expect(
        observeConfigSourceInputs(snapshot(root), async () => {
          expect(owningRequire.resolve('./helper')).toBe(
            path.join(root, 'helper.js'),
          );
          fs.writeFileSync(
            path.join(root, 'helper'),
            "module.exports = 'octane';",
          );
          try {
            owningRequire.resolve('./helper');
          } catch {
            /* A caught mutation still invalidates the evaluation. */
          }
        }),
      ).rejects.toThrow(/changed during (resolution|observation)/u);
    }));

  it('rejects a candidate created and removed inside the actual native resolver', async () =>
    fixture(async root => {
      fs.writeFileSync(
        path.join(root, 'helper.js'),
        "module.exports = 'solid';",
      );
      const higherPriority = path.join(root, 'helper');
      const owningRequire = createRequire(path.join(root, 'config.cjs'));
      const hooks = registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier !== './helper') return nextResolve(specifier, context);
          fs.writeFileSync(higherPriority, "module.exports = 'octane';");
          try {
            return nextResolve(specifier, context);
          } finally {
            fs.rmSync(higherPriority);
          }
        },
      });
      try {
        await expect(
          observeConfigSourceInputs(snapshot(root), async () =>
            owningRequire.resolve('./helper'),
          ),
        ).rejects.toThrow('CJS source candidates changed during resolution');
        expect(fs.existsSync(higherPriority)).toBe(false);
      } finally {
        hooks.deregister();
      }
    }));

  it('rejects an authored candidate link created after capture even when its target is an installed dependency', async () =>
    fixture(async root => {
      const app = path.join(root, 'app');
      const installed = path.join(root, 'foreign/node_modules/plugin');
      fs.mkdirSync(path.join(app, 'helper'), { recursive: true });
      fs.mkdirSync(installed, { recursive: true });
      const target = path.join(installed, 'index.js');
      fs.writeFileSync(target, "module.exports = 'solid';");
      const captured = snapshot(app);
      const owningRequire = createRequire(path.join(app, 'config.cjs'));
      await expect(
        observeConfigSourceInputs(
          captured,
          async () => {
            fs.symlinkSync(target, path.join(app, 'helper.js'));
            return owningRequire('./helper');
          },
          isConfigInstalledDependencyPath,
        ),
      ).rejects.toThrow('uncaptured symlink intermediate');
    }));

  it('rejects a complete foreign installed provider through the actual owning compiler API without executing it', async () =>
    fixture(async root => {
      const app = path.join(root, 'app');
      const foreign = path.join(root, 'foreign');
      const shadow = path.join(app, 'shadow');
      const from = path.join(shadow, 'config.cjs');
      const provider = path.join(foreign, 'node_modules', '@effect', 'tsgo');
      const backend = path.join(foreign, 'node_modules', 'typescript');
      const effectName = `@effect/tsgo-${process.platform}-${process.arch}`;
      const nativeName = `@typescript/typescript-${process.platform}-${process.arch}`;
      const effectPlatform = path.join(foreign, 'node_modules', effectName);
      const nativePlatform = path.join(foreign, 'node_modules', nativeName);
      const gitHead = '2bd066d87f5bafd315be9f40889d0a60b9e58e0b';
      const binaryName = process.platform === 'win32' ? 'tsc.exe' : 'tsc';
      const artifact = path.join(
        effectPlatform,
        'artifacts',
        'typescript',
        '7.0.2',
        binaryName,
      );
      const marker = path.join(foreign, 'ran');
      const poison = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`;
      fs.mkdirSync(app);
      fs.mkdirSync(shadow);
      fs.mkdirSync(provider, { recursive: true });
      fs.mkdirSync(backend, { recursive: true });
      fs.mkdirSync(path.join(effectPlatform, 'lib'), { recursive: true });
      fs.mkdirSync(path.dirname(artifact), { recursive: true });
      fs.mkdirSync(path.join(nativePlatform, 'lib'), { recursive: true });
      fs.symlinkSync(
        path.join(foreign, 'node_modules'),
        path.join(shadow, 'node_modules'),
        'dir',
      );
      fs.writeFileSync(from, '{}');
      const authoredFrom = path.join(app, 'modern.config.cjs');
      fs.writeFileSync(authoredFrom, '{}');
      fs.writeFileSync(
        path.join(provider, 'package.json'),
        JSON.stringify({
          name: '@effect/tsgo',
          version: '0.45.0',
          bin: { 'effect-tsgo': 'poison.cjs' },
        }),
      );
      fs.writeFileSync(path.join(provider, 'poison.cjs'), poison);
      fs.writeFileSync(
        path.join(backend, 'package.json'),
        JSON.stringify({
          name: 'typescript',
          version: '7.0.2',
          gitHead,
          exports: { './package.json': './package.json' },
        }),
      );
      fs.writeFileSync(
        path.join(nativePlatform, 'package.json'),
        JSON.stringify({ name: nativeName, version: '7.0.2', gitHead }),
      );
      fs.writeFileSync(
        path.join(nativePlatform, 'lib', binaryName),
        `#!/usr/bin/env node\n${poison}`,
        { mode: 0o755 },
      );
      fs.writeFileSync(
        path.join(effectPlatform, 'package.json'),
        JSON.stringify({ name: effectName, version: '0.45.0' }),
      );
      fs.writeFileSync(
        path.join(effectPlatform, 'lib', 'upstream.json'),
        JSON.stringify({
          schemaVersion: 5,
          components: {
            typescript: {
              '7.0.2': { gitHead, provider: 'typescript-go' },
            },
          },
        }),
      );
      fs.writeFileSync(artifact, `#!/usr/bin/env node\n${poison}`, {
        mode: 0o755,
      });
      // The captured origin resolves this complete foreign installation
      // without executing anything. Rejection must come from cohort identity.
      expect(resolveEffectTsgoCompiler({ from })).toBe(artifact);
      expect(fs.existsSync(marker)).toBe(false);
      const generatorDirectory = path.resolve(
        __dirname,
        '../../../../toolkit/ultramodern-create',
      );
      await expect(
        withConfigDependencyResolution(
          {
            sourceRoots: [app],
            dependencyRoots: [generatorDirectory],
          },
          () => {
            const selection = resolveEffectCompilerSelection(authoredFrom);
            return observeConfigSourceInputs(
              snapshot(app),
              async () => resolveEffectTsgoCompiler({ from }),
              isConfigInstalledDependencyPath,
              {
                selections: [selection],
                install: installEffectCompilerSelectionValidator,
              },
            );
          },
        ),
      ).rejects.toThrow(
        'original authored origin or selected installed cohort',
      );
      expect(fs.existsSync(marker)).toBe(false);
    }));

  it('restores process wrappers after authored evaluation fails', async () =>
    fixture(async root => {
      const before = {
        readFile: fs.readFile,
        readFileSync: fs.readFileSync,
        promisesRead: fsPromises.readFile,
        execFile: childProcess.execFileSync,
      };
      const error = new Error('authored failure');
      await expect(
        observeConfigSourceInputs(snapshot(root), async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      expect(fs.readFile).toBe(before.readFile);
      expect(fs.readFileSync).toBe(before.readFileSync);
      expect(fsPromises.readFile).toBe(before.promisesRead);
      const second = await observeConfigSourceInputs(snapshot(root), async () =>
        fs.readFileSync(path.join(root, 'input.json'), 'utf8'),
      );
      expect(second.value).toContain('solid');
    }));
});
