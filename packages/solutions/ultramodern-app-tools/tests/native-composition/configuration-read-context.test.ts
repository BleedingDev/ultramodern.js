import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createPluginManager } from '@modern-js/plugin';
import {
  type CLIPluginAPI,
  type CLIPluginExtends,
  createContext,
  createLoadedConfig,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import { loadEnv } from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  type LoadedUltramodernConfig,
  loadUltramodernConfigFile,
  observeUltramodernConfigLoad,
} from '../../src/native-composition/config';
import {
  createConfigurationReadContextPlugin,
  getConfigurationSourceInputs,
  getConfigurationSourceNodes,
  getConfigurationSourceSnapshot,
} from '../../src/native-composition/configuration-read-context';
import type { UltramodernAppUserConfig } from '../../src/native-composition/types';

const ownedRoots: string[] = [];

afterEach(() => {
  for (const root of ownedRoots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(
    path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-config-reads-'),
  );
  ownedRoots.push(root);
  const appDirectory = path.join(root, 'app');
  fs.mkdirSync(path.join(appDirectory, 'data'), { recursive: true });
  fs.mkdirSync(path.join(appDirectory, 'node_modules/@modern-js'), {
    recursive: true,
  });
  fs.symlinkSync(
    path.resolve(__dirname, '../..'),
    path.join(appDirectory, 'node_modules/@modern-js/ultramodern-app-tools'),
    'dir',
  );
  fs.writeFileSync(
    path.join(appDirectory, 'package.json'),
    JSON.stringify({ name: 'configuration-read-context-fixture' }),
  );
  fs.writeFileSync(path.join(appDirectory, 'data/value.txt'), 'authored');
  fs.symlinkSync('data', path.join(appDirectory, 'linked'));
  fs.writeFileSync(
    path.join(appDirectory, 'selection.ts'),
    'export const selected = "module-input";\n',
  );
  fs.writeFileSync(
    path.join(appDirectory, 'native-selection.cjs'),
    'module.exports = "native-module-input";\n',
  );
  const trace = path.join(root, 'callbacks.jsonl');
  const configFile = path.join(appDirectory, 'modern.config.ts');
  fs.writeFileSync(
    configFile,
    `import { ultramodernAppTools } from '@modern-js/ultramodern-app-tools';
import fs from 'node:fs';
import { selected } from './selection.ts';
import nativeSelected from './native-selection.cjs';
export default async context => {
  fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ kind: 'primary', context }) + '\\n');
  await Promise.resolve();
  const lexical = ${JSON.stringify(path.join(appDirectory, 'linked/value.txt'))};
  const canonical = ${JSON.stringify(path.join(appDirectory, 'data/value.txt'))};
  const value = fs.readFileSync(lexical, 'utf8');
  fs.readFileSync(canonical, 'utf8');
  fs.statSync(lexical);
  fs.readdirSync(${JSON.stringify(path.join(appDirectory, 'linked'))});
  fs.existsSync(${JSON.stringify(path.join(appDirectory, 'linked/missing.txt'))});
  return { plugins: [ultramodernAppTools()], html: { title: selected + '/' + nativeSelected + '/' + value }, source: { define: { PRIMARY: '"primary"' } } };
};\n`,
  );
  fs.writeFileSync(
    path.join(appDirectory, 'modern.config.local.ts'),
    `import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
export default async context => {
  fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ kind: 'local', context }) + '\\n');
  await readFile(${JSON.stringify(path.join(appDirectory, 'linked/value.txt'))}, 'utf8');
  return { source: { define: { LOCAL: '"local"' } } };
};\n`,
  );
  return {
    root,
    appDirectory,
    configFile,
    trace,
    invocations() {
      return fs.existsSync(trace)
        ? fs
            .readFileSync(trace, 'utf8')
            .trim()
            .split('\n')
            .map(line => JSON.parse(line))
        : [];
    },
  };
}

function installFixturePackage(
  app: ReturnType<typeof fixture>,
  name: string,
  owner: Record<string, unknown>,
  source: string,
) {
  const directory = fs.mkdtempSync(path.join(app.root, 'installed-owner-'));
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', exports: './index.ts', ...owner }),
  );
  fs.writeFileSync(path.join(directory, 'index.ts'), source);
  const slot = path.join(app.appDirectory, 'node_modules', name);
  fs.mkdirSync(path.dirname(slot), { recursive: true });
  fs.symlinkSync(directory, slot, 'dir');
  return { directory, slot };
}

function declareFixtureDependencies(
  app: ReturnType<typeof fixture>,
  declarations: Record<string, Record<string, string>>,
) {
  const filename = path.join(app.appDirectory, 'package.json');
  fs.writeFileSync(
    filename,
    JSON.stringify({
      ...JSON.parse(fs.readFileSync(filename, 'utf8')),
      ...declarations,
    }),
  );
}

async function nativeContext(
  appDirectory: string,
  loaded: LoadedUltramodernConfig,
  bind:
    | boolean
    | ReturnType<typeof createConfigurationReadContextPlugin> = true,
  configFile = loaded.configFile,
) {
  const manager = createPluginManager<CLIPluginAPI<CLIPluginExtends>>();
  manager.addPlugins(
    bind
      ? [
          typeof bind === 'boolean'
            ? createConfigurationReadContextPlugin(
                () => loaded.consumedSourceInputs,
              )
            : bind,
        ]
      : [],
  );
  const plugins = manager.getPlugins();
  const context = await createContext<CLIPluginExtends>({
    appContext: initAppContext({
      packageName: loaded.packageName,
      configFile,
      appDirectory,
      command: 'dev',
      metaName: 'modern-js',
      plugins,
    }),
    config: loaded.config,
    normalizedConfig: {},
  });
  const api = initPluginAPI({ context, pluginManager: manager });
  for (const plugin of plugins) await plugin.setup?.(api);
  return {
    api,
    nextAPI: () => initPluginAPI({ context, pluginManager: manager }),
  };
}

describe('ordinary configuration reads and public hook context', () => {
  it('captures one primary and local load, installed framework imports, and lexical/canonical reads', async () => {
    const app = fixture();
    const methods = {
      readFile: fs.readFileSync,
      realpath: fs.realpathSync,
      nativeRealpath: fs.realpathSync.native,
      exists: fs.existsSync,
      promiseRead: fsPromises.readFile,
      spawn: childProcess.spawn,
    };
    const previousCache = process.env.JITI_FS_CACHE;
    process.env.JITI_FS_CACHE = 'true';
    let loaded: LoadedUltramodernConfig;
    try {
      loaded = await loadUltramodernConfigFile({
        appDirectory: app.appDirectory,
        env: 'exact-fixture-env',
        command: 'dev',
        observeSourceInputs: true,
        config: { source: { define: { PROGRAMMATIC: '"programmatic"' } } },
      });
      expect(process.env.JITI_FS_CACHE).toBe('true');
    } finally {
      if (previousCache === undefined) delete process.env.JITI_FS_CACHE;
      else process.env.JITI_FS_CACHE = previousCache;
    }
    expect(app.invocations()).toEqual([
      {
        kind: 'primary',
        context: { env: 'exact-fixture-env', command: 'dev' },
      },
      { kind: 'local', context: { env: 'exact-fixture-env', command: 'dev' } },
    ]);
    expect(loaded.config.renderer).toBe('react');
    expect(loaded.config.html?.title).toBe(
      'module-input/native-module-input/authored',
    );
    expect(loaded.config.source?.define).toEqual({
      PRIMARY: '"primary"',
      LOCAL: '"local"',
      PROGRAMMATIC: '"programmatic"',
    });
    const inputs = loaded.consumedSourceInputs!;
    expect(Object.isFrozen(inputs)).toBe(true);
    expect(Object.isFrozen(inputs.observations)).toBe(true);
    expect(inputs.observations.every(Object.isFrozen)).toBe(true);
    const canonicalRoot = fs.realpathSync(app.appDirectory);
    for (const [relative, operation, existed, canonical] of [
      ['modern.config.ts', 'content', true, 'modern.config.ts'],
      ['modern.config.local.ts', 'content', true, 'modern.config.local.ts'],
      ['selection.ts', 'content', true, 'selection.ts'],
      ['native-selection.cjs', 'module', true, 'native-selection.cjs'],
      ['linked/value.txt', 'content', true, 'data/value.txt'],
      ['data/value.txt', 'content', true, 'data/value.txt'],
      ['linked/value.txt', 'metadata', true, 'data/value.txt'],
      ['linked', 'directory', true, 'data'],
      ['linked/missing.txt', 'metadata', false, 'data/missing.txt'],
    ] as const)
      expect(inputs.observations).toContainEqual({
        path: path.join(app.appDirectory, relative),
        canonicalPath: path.join(canonicalRoot, canonical),
        operation,
        existed,
      });
    expect(fs.readFileSync).toBe(methods.readFile);
    expect(fs.realpathSync).toBe(methods.realpath);
    expect(fs.realpathSync.native).toBe(methods.nativeRealpath);
    expect(fs.existsSync).toBe(methods.exists);
    expect(fsPromises.readFile).toBe(methods.promiseRead);
    expect(childProcess.spawn).toBe(methods.spawn);
  });

  it('binds the exact frozen read set across distinct native API proxies and preserves the native file', async () => {
    const app = fixture();
    const loaded = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      env: 'development',
      command: 'build',
      observeSourceInputs: true,
    });
    expect(app.invocations()).toEqual([
      { kind: 'primary', context: { env: 'development', command: 'build' } },
    ]);
    const nativeFile = path.join(app.root, 'native-command.config.ts');
    const native = await nativeContext(
      app.appDirectory,
      loaded,
      true,
      nativeFile,
    );
    const secondAPI = native.nextAPI();
    expect(secondAPI).not.toBe(native.api);
    expect(secondAPI.getHooks()).toBe(native.api.getHooks());
    expect(getConfigurationSourceInputs(native.api)).toBe(
      loaded.consumedSourceInputs,
    );
    expect(getConfigurationSourceInputs(secondAPI)).toBe(
      loaded.consumedSourceInputs,
    );
    expect(secondAPI.getAppContext().configFile).toBe(nativeFile);
    expect(secondAPI.getConfig()).toBe(loaded.config);
    const foreign = await nativeContext(app.appDirectory, loaded, false);
    expect(getConfigurationSourceInputs(foreign.api)).toBeUndefined();
    expect(getConfigurationSourceSnapshot(foreign.api)).toBeUndefined();
    expect(getConfigurationSourceNodes(foreign.api)).toBeUndefined();
    expect(() =>
      createConfigurationReadContextPlugin(() =>
        Object.freeze({
          kind: 'observed-config-source-inputs',
          version: 1,
          observations: Object.freeze([]),
          packageMetadata: Object.freeze([]),
        }),
      ).setup?.(secondAPI),
    ).toThrow('already has an owner');
    expect(app.invocations()).toHaveLength(1);
  });

  it('fails closed on caught unsupported reads and restores wrappers before the next load', async () => {
    const app = fixture();
    const previousCache = process.env.JITI_FS_CACHE;
    const previousRead = fs.readFileSync;
    fs.writeFileSync(
      app.configFile,
      `import fs from 'node:fs';
export default async context => {
  fs.appendFileSync(${JSON.stringify(app.trace)}, 'failed\\n');
  try { fs.createReadStream(${JSON.stringify(path.join(app.appDirectory, 'data/value.txt'))}); } catch {}
  return { plugins: [{ name: '@modern-js/ultramodern-app-tools' }] };
};\n`,
    );
    await expect(
      loadUltramodernConfigFile({
        appDirectory: app.appDirectory,
        env: 'fixture-env',
        command: 'build',
        observeSourceInputs: true,
      }),
    ).rejects.toThrow(
      'Unsupported config source observation: fs.createReadStream',
    );
    expect(fs.readFileSync).toBe(previousRead);
    expect(process.env.JITI_FS_CACHE).toBe(previousCache);
    fs.writeFileSync(
      app.configFile,
      "export default { plugins: [{ name: '@modern-js/ultramodern-app-tools' }] };\n",
    );
    const loaded = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      env: 'fixture-env',
      command: 'build',
      observeSourceInputs: true,
    });
    expect(loaded.config.renderer).toBe('react');
    expect(loaded.consumedSourceInputs?.observations).toContainEqual({
      path: app.configFile,
      canonicalPath: fs.realpathSync(app.configFile),
      operation: 'content',
      existed: true,
    });
    expect(fs.readFileSync(app.trace, 'utf8')).toBe('failed\n');
  });

  it('keeps unobserved loads available to an outer evaluator and rejects a missing or mutable handoff', async () => {
    const app = fixture();
    const loaded = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      env: 'fixture-env',
      command: 'build',
    });
    expect(loaded.consumedSourceInputs).toBeUndefined();
    const native = await nativeContext(app.appDirectory, loaded, false);
    expect(() =>
      createConfigurationReadContextPlugin(() => undefined).setup?.(native.api),
    ).toThrow('requires a captured load');
    expect(() =>
      createConfigurationReadContextPlugin(() => ({
        kind: 'observed-config-source-inputs',
        version: 1,
        observations: [],
        packageMetadata: [],
      })).setup?.(native.api),
    ).toThrow('requires immutable inputs');
  });

  it('captures declared shared source aliases without granting uncovered reads', async () => {
    const app = fixture();
    const shared = path.join(app.root, 'shared');
    fs.mkdirSync(shared);
    fs.writeFileSync(
      path.join(shared, 'authored.d.ts'),
      'authored declaration input',
    );
    fs.symlinkSync('../shared', path.join(app.appDirectory, 'shared-alias'));
    fs.writeFileSync(
      app.configFile,
      `import fs from 'node:fs';
export default () => {
  const value = fs.readFileSync(${JSON.stringify(path.join(app.appDirectory, 'shared-alias/authored.d.ts'))}, 'utf8');
  return { html: { title: value }, plugins: [{ name: '@modern-js/ultramodern-app-tools' }] };
};\n`,
    );
    const loaded = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      sourceRoots: [shared],
      env: 'development',
      command: 'build',
      observeSourceInputs: true,
    });
    expect(loaded.config.html?.title).toBe('authored declaration input');
    expect(loaded.consumedSourceInputs?.observations).toContainEqual({
      path: path.join(app.appDirectory, 'shared-alias/authored.d.ts'),
      canonicalPath: fs.realpathSync(path.join(shared, 'authored.d.ts')),
      operation: 'content',
      existed: true,
    });
    await expect(
      loadUltramodernConfigFile({
        appDirectory: app.appDirectory,
        env: 'development',
        command: 'build',
        observeSourceInputs: true,
      }),
    ).rejects.toThrow('symlink escapes captured coverage');
  });

  it('wraps the real native loader once and returns its unmodified result identity', async () => {
    const app = fixture();
    let nativeLoaded: LoadedUltramodernConfig | undefined;
    let inputs: LoadedUltramodernConfig['consumedSourceInputs'];
    let getterCalls = 0;
    const deferredPlugin = createConfigurationReadContextPlugin(() => {
      getterCalls++;
      return inputs;
    });
    expect(getterCalls).toBe(0);
    let invocations = 0;
    const observed = await observeUltramodernConfigLoad(
      { appDirectory: app.appDirectory, configFile: app.configFile },
      async () => {
        invocations++;
        nativeLoaded = await createLoadedConfig<UltramodernAppUserConfig>(
          app.appDirectory,
          app.configFile,
          { source: { define: { PROGRAMMATIC: '"programmatic"' } } },
          { env: 'native-env', command: 'dev' },
        );
        return nativeLoaded;
      },
    );
    expect(invocations).toBe(1);
    expect(observed.value).toBe(nativeLoaded);
    expect(Object.hasOwn(observed.value, 'consumedSourceInputs')).toBe(false);
    expect(observed.value.configFile).toBe(app.configFile);
    expect(app.invocations()).toEqual([
      { kind: 'primary', context: { env: 'native-env', command: 'dev' } },
      { kind: 'local', context: { env: 'native-env', command: 'dev' } },
    ]);
    expect(observed.consumedSourceInputs.observations).toContainEqual({
      path: app.configFile,
      canonicalPath: fs.realpathSync(app.configFile),
      operation: 'content',
      existed: true,
    });
    inputs = observed.consumedSourceInputs;
    const native = await nativeContext(
      app.appDirectory,
      observed.value,
      deferredPlugin,
    );
    expect(getterCalls).toBe(1);
    expect(getConfigurationSourceInputs(native.nextAPI())).toBe(inputs);
    expect(getterCalls).toBe(1);
    expect(native.api.getAppContext().configFile).toBe(app.configFile);
  });

  it('normalizes a relative capture directory without changing the native load closure', async () => {
    const app = fixture();
    const relativeDirectory = path.relative(process.cwd(), app.appDirectory);
    expect(path.isAbsolute(relativeDirectory)).toBe(false);
    let invocations = 0;
    let nativeLoaded: LoadedUltramodernConfig | undefined;
    const observed = await observeUltramodernConfigLoad(
      { appDirectory: relativeDirectory, configFile: 'modern.config.ts' },
      async () => {
        invocations++;
        nativeLoaded = await createLoadedConfig<UltramodernAppUserConfig>(
          app.appDirectory,
          app.configFile,
          undefined,
          { env: 'relative-env', command: 'build' },
        );
        return nativeLoaded;
      },
    );
    expect(invocations).toBe(1);
    expect(observed.value).toBe(nativeLoaded);
    expect(observed.value.configFile).toBe(app.configFile);
    expect(observed.consumedSourceInputs.observations).toContainEqual({
      path: app.configFile,
      canonicalPath: fs.realpathSync(app.configFile),
      operation: 'content',
      existed: true,
    });
    expect(app.invocations()).toEqual([
      { kind: 'primary', context: { env: 'relative-env', command: 'build' } },
    ]);
  });

  it('retains the original immutable baseline through deferred native setup without recapturing changed reads', async () => {
    const app = fixture();
    const contentFile = path.join(app.appDirectory, 'data/value.txt');
    fs.writeFileSync(
      app.configFile,
      fs
        .readFileSync(app.configFile, 'utf8')
        .replace(
          '  return { plugins:',
          `  fs.writeFileSync(${JSON.stringify(contentFile)}, 'changed during configuration evaluation');\n  return { plugins:`,
        ),
    );
    const loaded = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      env: 'baseline-env',
      command: 'build',
      observeSourceInputs: true,
    });
    expect(loaded.config.html?.title).toBe(
      'module-input/native-module-input/authored',
    );
    expect(fs.readFileSync(contentFile, 'utf8')).toBe(
      'changed during configuration evaluation',
    );
    const missingFile = path.join(app.appDirectory, 'data/missing.txt');
    fs.writeFileSync(contentFile, 'changed after configuration evaluation');
    fs.writeFileSync(missingFile, 'created after configuration evaluation');
    const native = await nativeContext(app.appDirectory, loaded);
    const snapshot = getConfigurationSourceSnapshot(native.api)!;
    expect(snapshot.kind).toBe('bounded-config-source-snapshot');
    expect(snapshot.version).toBe(1);
    expect(getConfigurationSourceSnapshot(native.nextAPI())).toBe(snapshot);
    expect(snapshot.sourceRoots).toContain(app.appDirectory);
    expect(
      snapshot.states.find(state => state.path === contentFile),
    ).toMatchObject({
      kind: 'file',
      sha256: createHash('sha256').update('authored').digest('hex'),
    });
    expect(snapshot.states.some(state => state.path === missingFile)).toBe(
      false,
    );
    for (const value of [
      snapshot,
      snapshot.sourceRoots,
      snapshot.extraInputs,
      snapshot.exclusions,
      snapshot.coverage,
      snapshot.states,
      ...snapshot.coverage,
      ...snapshot.states,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    expect(Object.keys(loaded.consumedSourceInputs!)).toEqual([
      'kind',
      'version',
      'observations',
      'packageMetadata',
    ]);
    const copiedInputs = Object.freeze({ ...loaded.consumedSourceInputs! });
    const copiedContext = await nativeContext(app.appDirectory, {
      ...loaded,
      consumedSourceInputs: copiedInputs,
    });
    expect(getConfigurationSourceInputs(copiedContext.api)).toBe(copiedInputs);
    expect(getConfigurationSourceSnapshot(copiedContext.api)).toBeUndefined();
    expect(getConfigurationSourceNodes(copiedContext.api)).toBeUndefined();
    expect(app.invocations()).toHaveLength(1);
  });

  it('retains actual physical metadata, excluded entry kinds, lexical aliases, and original missing ancestry', async () => {
    const app = fixture();
    const directory = path.join(app.appDirectory, 'data');
    const canonicalDirectory = fs.realpathSync(directory);
    const excluded = path.join(directory, 'dist');
    fs.mkdirSync(excluded);
    fs.writeFileSync(path.join(excluded, 'hidden.txt'), 'excluded child');
    const missing = path.join(app.appDirectory, 'linked/absent/deep.json');
    fs.writeFileSync(
      app.configFile,
      fs
        .readFileSync(app.configFile, 'utf8')
        .replace(
          '  return { plugins:',
          `  fs.existsSync(${JSON.stringify(missing)});\n  return { plugins:`,
        ),
    );
    const before = fs.lstatSync(directory, { bigint: true });
    const loaded = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      env: 'node-baseline',
      command: 'build',
      observeSourceInputs: true,
    });
    fs.rmSync(excluded, { recursive: true });
    fs.writeFileSync(excluded, 'same name, changed kind after evaluation');
    fs.mkdirSync(path.join(directory, 'absent'));
    fs.writeFileSync(path.join(directory, 'absent/deep.json'), '{}');
    const native = await nativeContext(app.appDirectory, loaded);
    const nodes = getConfigurationSourceNodes(native.api)!;
    expect(getConfigurationSourceNodes(native.nextAPI())).toBe(nodes);
    expect(nodes).toHaveLength(
      loaded.consumedSourceInputs!.observations.length +
        loaded.consumedSourceInputs!.packageMetadata.length,
    );
    const listing = nodes.find(
      pair =>
        pair.observation.operation === 'directory' &&
        pair.observation.path === path.join(app.appDirectory, 'linked'),
    )!;
    expect(listing.node.path).toEqual({
      lexical: path.join(app.appDirectory, 'linked'),
      canonical: canonicalDirectory,
    });
    if (listing.node.kind !== 'directory')
      throw new Error('Expected an original directory node');
    expect(listing.node.entries).toEqual([
      { name: 'dist', kind: 'directory' },
      { name: 'value.txt', kind: 'file' },
    ]);
    expect(listing.node.metadata).toEqual({
      device: String(before.dev),
      inode: String(before.ino),
      mode: Number(before.mode),
      uid: Number(before.uid),
      gid: Number(before.gid),
      size: Number(before.size),
      nlink: Number(before.nlink),
      blocks: Number(before.blocks),
      birthtimeNs: String(before.birthtimeNs),
      mtimeNs: String(before.mtimeNs),
      ctimeNs: String(before.ctimeNs),
    });
    const absent = nodes.find(pair => pair.observation.path === missing)!;
    expect(absent.node).toEqual({
      path: {
        lexical: missing,
        canonical: path.join(canonicalDirectory, 'absent/deep.json'),
      },
      kind: 'missing',
    });
    expect(
      absent.requiredAncestors?.map(node => ({
        kind: node.kind,
        path: node.path,
      })),
    ).toEqual([
      {
        kind: 'directory',
        path: { lexical: canonicalDirectory, canonical: canonicalDirectory },
      },
      {
        kind: 'missing',
        path: {
          lexical: path.join(canonicalDirectory, 'absent'),
          canonical: path.join(canonicalDirectory, 'absent'),
        },
      },
    ]);
    expect(
      nodes.some(
        pair => pair.node.path.canonical === path.join(excluded, 'hidden.txt'),
      ),
    ).toBe(false);
    for (const pair of nodes) {
      if (loaded.consumedSourceInputs!.observations.includes(pair.observation))
        expect(loaded.consumedSourceInputs!.observations).toContain(
          pair.observation,
        );
      else
        expect(
          loaded.consumedSourceInputs!.packageMetadata.map(input => ({
            path: input.path,
            canonicalPath: input.canonicalPath,
            operation: 'metadata',
            existed: true,
          })),
        ).toContainEqual(pair.observation);
      expect(pair.node.path.lexical).toBe(pair.observation.path);
      expect(pair.node.path.canonical).toBe(pair.observation.canonicalPath);
      for (const value of [pair, pair.observation, pair.node, pair.node.path])
        expect(Object.isFrozen(value)).toBe(true);
      if (pair.node.kind !== 'missing')
        expect(Object.isFrozen(pair.node.metadata)).toBe(true);
      if (pair.node.kind === 'directory') {
        expect(Object.isFrozen(pair.node.entries)).toBe(true);
        for (const entry of pair.node.entries)
          expect(Object.isFrozen(entry)).toBe(true);
      }
      if (pair.requiredAncestors) {
        expect(Object.isFrozen(pair.requiredAncestors)).toBe(true);
        for (const ancestor of pair.requiredAncestors) {
          expect(Object.isFrozen(ancestor)).toBe(true);
          expect(Object.isFrozen(ancestor.path)).toBe(true);
          if (ancestor.kind !== 'missing')
            expect(Object.isFrozen(ancestor.metadata)).toBe(true);
        }
      }
    }
    expect(Object.isFrozen(nodes)).toBe(true);
  });

  it('retains the original file blocker when a missing read reports ENOTDIR', async () => {
    const app = fixture();
    const blocker = path.join(app.appDirectory, 'block');
    const requested = path.join(blocker, 'child.json');
    fs.writeFileSync(blocker, 'original path blocker');
    const canonicalBlocker = fs.realpathSync(blocker);
    const before = fs.lstatSync(blocker, { bigint: true });
    fs.writeFileSync(
      app.configFile,
      `import fs from 'node:fs';
export default () => {
  let code;
  try { fs.statSync(${JSON.stringify(requested)}); }
  catch (error) { code = error.code; }
  fs.appendFileSync(${JSON.stringify(app.trace)}, JSON.stringify({ kind: 'primary', code }) + '\\n');
  return { html: { title: code }, plugins: [{ name: '@modern-js/ultramodern-app-tools' }] };
};\n`,
    );
    const loaded = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      env: 'missing-blocker',
      command: 'build',
      observeSourceInputs: true,
    });
    expect(loaded.config.html?.title).toBe('ENOTDIR');
    fs.unlinkSync(blocker);
    fs.mkdirSync(blocker);
    expect(fs.existsSync(requested)).toBe(false);
    let currentCode: string | undefined;
    try {
      fs.statSync(requested);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error)
        currentCode = String(error.code);
    }
    expect(currentCode).toBe('ENOENT');
    const native = await nativeContext(app.appDirectory, loaded);
    const pair = getConfigurationSourceNodes(native.api)!.find(
      candidate => candidate.observation.path === requested,
    )!;
    expect(pair.node.kind).toBe('missing');
    expect(pair.requiredAncestors).toHaveLength(1);
    const ancestor = pair.requiredAncestors![0]!;
    expect(ancestor.path).toEqual({
      lexical: canonicalBlocker,
      canonical: canonicalBlocker,
    });
    if (ancestor.kind !== 'file')
      throw new Error('Expected the original blocking file');
    expect(ancestor.byteDigest).toBe(
      createHash('sha256').update('original path blocker').digest('hex'),
    );
    expect(ancestor.metadata.inode).toBe(String(before.ino));
    expect(ancestor.metadata.device).toBe(String(before.dev));
    expect(app.invocations()).toEqual([{ kind: 'primary', code: 'ENOTDIR' }]);
  });

  it.each([
    {
      name: 'readdirSync',
      read: `return fs.readdirSync(directory, { recursive: true });`,
    },
    {
      name: 'readdir',
      read: `return new Promise((resolve, reject) => {
        fs.readdir(directory, { recursive: true }, (error, entries) => {
          record({ event: 'callback' });
          if (error) reject(error); else resolve(entries);
        });
        record({ event: 'scheduled' });
      });`,
    },
    {
      name: 'promises.readdir',
      read: `return promises.readdir(directory, { recursive: true });`,
    },
    {
      name: 'opendirSync',
      read: `const handle = fs.opendirSync(directory, { recursive: true });
      try { const names = []; let entry; while ((entry = handle.readSync())) names.push(entry.name); return names; }
      finally { handle.closeSync(); }`,
    },
    {
      name: 'opendir',
      read: `return new Promise((resolve, reject) => {
        fs.opendir(directory, { recursive: true }, (error, handle) => {
          record({ event: 'callback' });
          if (error) { reject(error); return; }
          try { const names = []; let entry; while ((entry = handle.readSync())) names.push(entry.name); resolve(names); }
          catch (error) { reject(error); }
          finally { handle.closeSync(); }
        });
        record({ event: 'scheduled' });
      });`,
    },
    {
      name: 'promises.opendir',
      read: `const handle = await promises.opendir(directory, { recursive: true });
      try { const names = []; let entry; while ((entry = handle.readSync())) names.push(entry.name); return names; }
      finally { handle.closeSync(); }`,
    },
  ])('preserves native $name values, errors, and callback order before rejecting recursive admission', async ({
    name,
    read,
  }) => {
    const app = fixture();
    const originalDirectoryReads = {
      readdir: fs.readdir,
      readdirSync: fs.readdirSync,
      opendir: fs.opendir,
      opendirSync: fs.opendirSync,
      promiseReaddir: fsPromises.readdir,
      promiseOpendir: fsPromises.opendir,
    };
    const previousCache = process.env.JITI_FS_CACHE;
    fs.writeFileSync(
      app.configFile,
      `import fs from 'node:fs';
import promises from 'node:fs/promises';
const record = value => fs.appendFileSync(${JSON.stringify(app.trace)}, JSON.stringify(value) + '\\n');
const readDirectory = async directory => { ${read} };
export default async context => {
  record({ event: 'start', context });
  record({ event: 'read', entries: await readDirectory(${JSON.stringify(path.join(app.appDirectory, 'data'))}) });
  try { await readDirectory(${JSON.stringify(path.join(app.appDirectory, 'data/not-present'))}); }
  catch (error) { record({ event: 'error', code: error.code }); }
  record({ event: 'return' });
  return { plugins: [{ name: '@modern-js/ultramodern-app-tools' }] };
};\n`,
    );
    await expect(
      loadUltramodernConfigFile({
        appDirectory: app.appDirectory,
        env: 'recursive-native',
        command: 'build',
        observeSourceInputs: true,
      }),
    ).rejects.toThrow('Unsupported configuration read mode: recursive');
    const events = app.invocations();
    expect(events[0]).toEqual({
      event: 'start',
      context: { env: 'recursive-native', command: 'build' },
    });
    expect(events.filter(event => event.event === 'start')).toHaveLength(1);
    expect(events.find(event => event.event === 'read')).toEqual({
      event: 'read',
      entries: ['value.txt'],
    });
    expect(events.find(event => event.event === 'error')).toEqual({
      event: 'error',
      code: 'ENOENT',
    });
    expect(events.at(-1)).toEqual({ event: 'return' });
    if (name === 'readdir' || name === 'opendir')
      expect(events.map(event => event.event)).toEqual([
        'start',
        'scheduled',
        'callback',
        'read',
        'scheduled',
        'callback',
        'error',
        'return',
      ]);
    expect(fs.readdir).toBe(originalDirectoryReads.readdir);
    expect(fs.readdirSync).toBe(originalDirectoryReads.readdirSync);
    expect(fs.opendir).toBe(originalDirectoryReads.opendir);
    expect(fs.opendirSync).toBe(originalDirectoryReads.opendirSync);
    expect(fsPromises.readdir).toBe(originalDirectoryReads.promiseReaddir);
    expect(fsPromises.opendir).toBe(originalDirectoryReads.promiseOpendir);
    expect(process.env.JITI_FS_CACHE).toBe(previousCache);
  });

  it('preserves a native loader failure after recursive reads and releases the private scope', async () => {
    const app = fixture();
    const originalRead = fs.readdirSync;
    fs.writeFileSync(
      app.configFile,
      `import fs from 'node:fs';
export default () => {
  fs.readdirSync(${JSON.stringify(path.join(app.appDirectory, 'data'))}, { recursive: true });
  throw new Error('original native callback failure');
};\n`,
    );
    await expect(
      loadUltramodernConfigFile({
        appDirectory: app.appDirectory,
        env: 'native-failure',
        command: 'build',
        observeSourceInputs: true,
      }),
    ).rejects.toThrow('original native callback failure');
    expect(fs.readdirSync).toBe(originalRead);
    fs.writeFileSync(
      app.configFile,
      `export default { plugins: [{ name: '@modern-js/ultramodern-app-tools' }] };\n`,
    );
    const next = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      env: 'native-failure',
      command: 'build',
      observeSourceInputs: true,
    });
    const native = await nativeContext(app.appDirectory, next);
    expect(getConfigurationSourceNodes(native.api)).toBeDefined();
    expect(fs.readdirSync).toBe(originalRead);
  });

  it('captures the genuine MF host native config import graph without running plugin setup or compilation', async () => {
    const appDirectory = path.resolve(
      __dirname,
      '../../../../../tests/integration/routes-tanstack-mf/mf-host',
    );
    const configFile = path.join(appDirectory, 'modern.config.ts');
    const previousEnv = process.env.NODE_ENV;
    const previousArgv = process.env.MODERN_ARGV;
    let cleanupEnvironment = () => {};
    try {
      process.env.NODE_ENV = 'development';
      process.env.MODERN_ARGV = 'node ultramodern dev';
      cleanupEnvironment = loadEnv({
        cwd: appDirectory,
        mode: process.env.MODERN_ENV || 'development',
        prefixes: ['MODERN_'],
      }).cleanup;
      const observed = await observeUltramodernConfigLoad(
        { appDirectory, configFile },
        () =>
          createLoadedConfig<UltramodernAppUserConfig>(
            appDirectory,
            configFile,
          ),
      );
      expect(observed.value.packageName).toBe('routes-tanstack-mf-host');
      expect(observed.value.configFile).toBe(configFile);
      expect(
        observed.value.config.plugins?.map(plugin => plugin.name),
      ).toContain('@modern-js/plugin-module-federation');
      expect(observed.consumedSourceInputs.observations).toContainEqual({
        path: configFile,
        canonicalPath: fs.realpathSync(configFile),
        operation: 'content',
        existed: true,
      });
      expect(Object.isFrozen(observed.consumedSourceInputs)).toBe(true);
    } finally {
      cleanupEnvironment();
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
      if (previousArgv === undefined) delete process.env.MODERN_ARGV;
      else process.env.MODERN_ARGV = previousArgv;
    }
  });

  it('accepts an installed alias with subpath-only exports and a declared workspace package', async () => {
    const app = fixture();
    installFixturePackage(
      app,
      '@fixture/alias',
      { name: '@fixture/actual-owner', exports: { './feature': './index.ts' } },
      'export default "alias";\n',
    );
    installFixturePackage(
      app,
      '@fixture/workspace',
      {},
      'export default "workspace";\n',
    );
    declareFixtureDependencies(app, {
      dependencies: { '@fixture/alias': 'npm:@fixture/actual-owner@1.0.0' },
      devDependencies: { '@fixture/workspace': 'workspace:*' },
      optionalDependencies: { '@fixture/not-installed': '^1.0.0' },
    });
    fs.writeFileSync(
      app.configFile,
      `import alias from '@fixture/alias/feature';
import workspace from '@fixture/workspace';
export default { html: { title: alias + '/' + workspace }, plugins: [{ name: '@modern-js/ultramodern-app-tools' }] };\n`,
    );
    const loaded = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      env: 'development',
      command: 'build',
      observeSourceInputs: true,
    });
    expect(loaded.config.html?.title).toBe('alias/workspace');
    expect(loaded.consumedSourceInputs?.observations).toContainEqual({
      path: app.configFile,
      canonicalPath: fs.realpathSync(app.configFile),
      operation: 'content',
      existed: true,
    });
  });

  it('ignores an unused declared package available only through the runner global CJS fallback', async () => {
    const app = fixture();
    const name = '@modern-js/runtime';
    declareFixtureDependencies(app, {
      dependencies: { [name]: 'workspace:*' },
    });
    const appRequire = createRequire(
      path.join(app.appDirectory, 'package.json'),
    );
    // pnpm's Rstest launcher exposes workspace packages through NODE_PATH.
    // This app has no native dependency slot and never imports this package.
    const fallbackManifest = appRequire.resolve
      .paths(name)
      ?.map(directory => path.join(directory, name, 'package.json'))
      .find(filename => fs.existsSync(filename));
    expect(fallbackManifest).toBeDefined();
    for (let directory = app.appDirectory; ; ) {
      expect(fs.existsSync(path.join(directory, 'node_modules', name))).toBe(
        false,
      );
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    fs.writeFileSync(
      app.configFile,
      `export default { html: { title: 'unused-global-declaration' }, plugins: [{ name: '@modern-js/ultramodern-app-tools' }] };\n`,
    );
    const loaded = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      env: 'development',
      command: 'build',
      observeSourceInputs: true,
    });
    expect(loaded.config.html?.title).toBe('unused-global-declaration');
    const native = await nativeContext(app.appDirectory, loaded);
    const snapshot = getConfigurationSourceSnapshot(native.api)!;
    const canonicalInputs = snapshot.extraInputs.map(filename =>
      fs.realpathSync(filename),
    );
    expect(canonicalInputs).not.toContain(fs.realpathSync(fallbackManifest!));
    expect(loaded.consumedSourceInputs?.observations).toContainEqual({
      path: app.configFile,
      canonicalPath: fs.realpathSync(app.configFile),
      operation: 'content',
      existed: true,
    });
  });

  it.each([
    { location: 'app', exportKind: 'require-only' },
    { location: 'ancestor', exportKind: 'require-only' },
    { location: 'app', exportKind: 'custom-conditional' },
    { location: 'ancestor', exportKind: 'custom-conditional' },
  ] as const)('accepts $exportKind exports at the native $location dependency slot', async ({
    location,
    exportKind,
  }) => {
    const app = fixture();
    const name = '@fixture/conditional-owner';
    const expected = `${location}/${exportKind}`;
    const installed = installFixturePackage(
      app,
      name,
      {
        type: 'commonjs',
        exports:
          exportKind === 'require-only'
            ? { require: './entry.cjs' }
            : {
                '.': { 'ultramodern-fixture': './condition-only.cjs' },
                './feature': { require: './entry.cjs' },
              },
      },
      'throw new Error("The unexported source must not load");\n',
    );
    fs.writeFileSync(
      path.join(installed.directory, 'entry.cjs'),
      `module.exports = ${JSON.stringify(expected)};\n`,
    );
    fs.writeFileSync(
      path.join(installed.directory, 'condition-only.cjs'),
      'throw new Error("The custom root condition must not load");\n',
    );
    let slot = installed.slot;
    if (location === 'ancestor') {
      slot = path.join(app.root, 'node_modules', name);
      fs.mkdirSync(path.dirname(slot), { recursive: true });
      fs.renameSync(installed.slot, slot);
    }
    declareFixtureDependencies(app, {
      dependencies: { [name]: 'workspace:*' },
    });
    const specifier = exportKind === 'require-only' ? name : `${name}/feature`;
    fs.writeFileSync(
      app.configFile,
      `import { createRequire } from 'node:module';
const requireFromConfig = createRequire(__filename);
export default () => ({ html: { title: requireFromConfig(${JSON.stringify(specifier)}) }, plugins: [{ name: '@modern-js/ultramodern-app-tools' }] });\n`,
    );
    const loaded = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      env: 'development',
      command: 'build',
      observeSourceInputs: true,
    });
    expect(loaded.config.html?.title).toBe(expected);
    expect(loaded.consumedSourceInputs?.observations).toContainEqual({
      path: app.configFile,
      canonicalPath: fs.realpathSync(app.configFile),
      operation: 'content',
      existed: true,
    });
    const native = await nativeContext(app.appDirectory, loaded);
    const snapshot = getConfigurationSourceSnapshot(native.api)!;
    const manifest = path.join(slot, 'package.json');
    expect(snapshot.extraInputs).toContain(manifest);
    expect(snapshot.states).toContainEqual(
      expect.objectContaining({
        path: manifest,
        resolvedPath: fs.realpathSync(manifest),
        kind: 'file',
        sha256: createHash('sha256')
          .update(fs.readFileSync(manifest))
          .digest('hex'),
      }),
    );
  });

  it.each([
    'self',
    'application',
    'parent',
  ] as const)('rejects %s as an installed dependency ownership root', async mode => {
    const app = fixture();
    const name =
      mode === 'self' ? 'configuration-read-context-fixture' : '@fixture/owner';
    declareFixtureDependencies(app, {
      dependencies: { [name]: 'workspace:*' },
    });
    if (mode !== 'self') {
      const directory = mode === 'application' ? app.appDirectory : app.root;
      if (mode === 'parent')
        fs.writeFileSync(
          path.join(directory, 'package.json'),
          JSON.stringify({ name, version: '1.0.0' }),
        );
      const slot = path.join(app.appDirectory, 'node_modules', name);
      fs.mkdirSync(path.dirname(slot), { recursive: true });
      fs.symlinkSync(directory, slot, 'dir');
    }
    await expect(
      loadUltramodernConfigFile({
        appDirectory: app.appDirectory,
        env: 'development',
        command: 'build',
        observeSourceInputs: true,
      }),
    ).rejects.toThrow('cannot own');
    expect(app.invocations()).toEqual([]);
  });

  it('keeps an undeclared authored sibling outside an installed package ownership grant', async () => {
    const app = fixture();
    const sibling = path.join(app.root, 'unrelated-authored.txt');
    fs.writeFileSync(sibling, 'authored');
    installFixturePackage(
      app,
      '@fixture/provider',
      {},
      `import fs from 'node:fs'; export default () => fs.readFileSync(${JSON.stringify(sibling)}, 'utf8');\n`,
    );
    declareFixtureDependencies(app, {
      dependencies: { '@fixture/provider': 'workspace:*' },
    });
    fs.writeFileSync(
      app.configFile,
      "import read from '@fixture/provider'; export default () => ({ html: { title: read() }, plugins: [{ name: '@modern-js/ultramodern-app-tools' }] });\n",
    );
    await expect(
      loadUltramodernConfigFile({
        appDirectory: app.appDirectory,
        env: 'development',
        command: 'build',
        observeSourceInputs: true,
      }),
    ).rejects.toThrow(`uncovered source path ${sibling}`);
  });

  it('preserves a native missing optional import when another installed plugin owns a provider', async () => {
    const app = fixture();
    const provider = installFixturePackage(
      app,
      '@fixture/provider',
      { dependencies: { '@fixture/optional': '1.0.0' } },
      'export default "provider";\n',
    );
    const optional = path.join(
      provider.directory,
      'node_modules/@fixture/optional',
    );
    fs.mkdirSync(optional, { recursive: true });
    fs.writeFileSync(
      path.join(optional, 'package.json'),
      JSON.stringify({
        name: '@fixture/optional',
        version: '1.0.0',
        exports: './index.cjs',
      }),
    );
    fs.writeFileSync(
      path.join(optional, 'index.cjs'),
      'module.exports = "foreign-provider";\n',
    );
    declareFixtureDependencies(app, {
      dependencies: { '@fixture/provider': 'workspace:*' },
      optionalDependencies: { '@fixture/optional': '1.0.0' },
    });
    fs.writeFileSync(
      app.configFile,
      `import { createRequire } from 'node:module';
export default () => {
  let title;
  try { title = createRequire(__filename)('@fixture/optional'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; title = 'native-missing'; }
  return { html: { title }, plugins: [{ name: '@modern-js/ultramodern-app-tools' }] };
};\n`,
    );
    const loaded = await loadUltramodernConfigFile({
      appDirectory: app.appDirectory,
      env: 'development',
      command: 'build',
      observeSourceInputs: true,
    });
    expect(loaded.config.html?.title).toBe('native-missing');
  });

  it('preserves a present package export failure instead of selecting another provider', async () => {
    const app = fixture();
    installFixturePackage(
      app,
      '@fixture/broken',
      { exports: { './feature': './index.ts' } },
      'export default "unused";\n',
    );
    declareFixtureDependencies(app, {
      dependencies: { '@fixture/broken': 'workspace:*' },
    });
    fs.writeFileSync(
      app.configFile,
      "import value from '@fixture/broken'; export default { html: { title: value }, plugins: [{ name: '@modern-js/ultramodern-app-tools' }] };\n",
    );
    await expect(
      loadUltramodernConfigFile({
        appDirectory: app.appDirectory,
        env: 'development',
        command: 'build',
        observeSourceInputs: true,
      }),
    ).rejects.toThrow('No "exports" main defined');
  });

  it('rejects an installed alias retargeted during the actual load and restores the cache scope', async () => {
    const app = fixture();
    const first = installFixturePackage(
      app,
      '@fixture/retarget',
      {},
      'export default "first";\n',
    );
    const second = fs.mkdtempSync(path.join(app.root, 'retarget-owner-'));
    fs.writeFileSync(
      path.join(second, 'package.json'),
      JSON.stringify({
        name: '@fixture/retarget',
        version: '2.0.0',
        exports: './index.ts',
      }),
    );
    fs.writeFileSync(
      path.join(second, 'index.ts'),
      'export default "second";\n',
    );
    declareFixtureDependencies(app, {
      dependencies: { '@fixture/retarget': 'workspace:*' },
    });
    const previousCache = process.env.JITI_FS_CACHE;
    await expect(
      observeUltramodernConfigLoad(
        { appDirectory: app.appDirectory, configFile: app.configFile },
        async () => {
          fs.unlinkSync(first.slot);
          fs.symlinkSync(second, first.slot, 'dir');
          return { original: true };
        },
      ),
    ).rejects.toThrow('symlink escapes captured coverage');
    expect(process.env.JITI_FS_CACHE).toBe(previousCache);
    const fresh = await observeUltramodernConfigLoad(
      { appDirectory: app.appDirectory, configFile: app.configFile },
      async () => ({
        current: fs.readFileSync(path.join(first.slot, 'index.ts'), 'utf8'),
      }),
    );
    expect(fresh.value.current).toBe('export default "second";\n');
  });
});
