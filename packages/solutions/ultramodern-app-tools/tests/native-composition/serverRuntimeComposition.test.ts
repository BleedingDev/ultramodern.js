import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppTools } from '@modern-js/app-tools';
import { createCloudflarePreset } from '@modern-js/app-tools-extensions/cloudflare';
import { resolveNativeConfigLoadProvider } from '@modern-js/app-tools-extensions/native-config-load-provider';
import {
  createCli,
  initAppContext as initCliContext,
} from '@modern-js/plugin/cli';
import { applyPlugins, type ProdServerOptions } from '@modern-js/prod-server';
import { createServerBase } from '@modern-js/server-core';
import { loadServerPlugins } from '@modern-js/server-core/node';
import { ultramodernAppTools } from '@modern-js/ultramodern-app-tools';
import { build as buildApp } from '../../../app-tools/src/commands/build';
import { generateHandler } from '../../../app-tools/src/plugins/deploy/utils/generator';
import { initAppContext as initAppToolsContext } from '../../../app-tools/src/utils/initAppContext';
import { getServerPlugins } from '../../../app-tools/src/utils/loadPlugins';
import {
  type ConfigSourceSnapshot,
  captureConfigSourceSnapshot,
} from '../../src/native-composition/config-evaluator/source-snapshot';

const descriptorName = '@modern-js/ultramodern-app-tools/server-plugin';
const packageDirectory = path.resolve(__dirname, '../..');
const mappedPackageName = '@bleedingdev/modern-js-ultramodern-app-tools';
const requireFromPackage = createRequire(
  path.join(packageDirectory, 'package.json'),
);
const {
  createNativeConfigLoad,
}: typeof import('../../src/native-composition/native-config-load') =
  requireFromPackage('./dist/cjs/native-composition/native-config-load.js');
const {
  getConfigurationSourceSnapshot,
}: typeof import('../../src/native-composition/configuration-read-context') =
  requireFromPackage(
    './dist/cjs/native-composition/configuration-read-context.js',
  );

function createMappedServerOwner(
  root: string,
  label = 'mapped-sdk',
  subpath: 'server-plugin' | 'native-server-plugin' = 'server-plugin',
) {
  const owner = path.join(root, label);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
  );
  const serverExport = manifest.exports[`./${subpath}`].node;
  fs.mkdirSync(owner, { recursive: true });
  const sourceDist = path.join(packageDirectory, 'dist');
  const targetDist = path.join(owner, 'dist');
  // Preserve the actual emitted closure, including private registry imports.
  if (process.platform === 'darwin') {
    execFileSync('/bin/cp', ['-cR', sourceDist, targetDist]);
  } else {
    fs.cpSync(sourceDist, targetDist, {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  for (const entry of fs.readdirSync(sourceDist, { recursive: true })) {
    const source = path.join(sourceDist, entry);
    const target = path.join(targetDist, entry);
    const sourceState = fs.lstatSync(source);
    const targetState = fs.lstatSync(target);
    expect(targetState.isDirectory()).toBe(sourceState.isDirectory());
    expect(targetState.isFile()).toBe(sourceState.isFile());
    expect(targetState.isSymbolicLink()).toBe(sourceState.isSymbolicLink());
    if (sourceState.isFile()) {
      expect(fs.readFileSync(target).equals(fs.readFileSync(source))).toBe(
        true,
      );
    } else if (sourceState.isSymbolicLink()) {
      expect(fs.readlinkSync(target)).toBe(fs.readlinkSync(source));
    }
  }
  fs.writeFileSync(
    path.join(owner, 'package.json'),
    JSON.stringify({
      name: mappedPackageName,
      version: manifest.version,
      type: 'commonjs',
      exports: {
        [`./${subpath}`]: {
          node: {
            import: serverExport.import,
            require: serverExport.require,
          },
        },
      },
    }),
  );
  fs.symlinkSync(
    fs.realpathSync(path.join(packageDirectory, 'node_modules')),
    path.join(owner, 'node_modules'),
    'dir',
  );
  return {
    owner,
    registrar: path.join(owner, serverExport.require.default),
    version: manifest.version as string,
  };
}

function linkMappedComposer(
  appDirectory: string,
  owner: ReturnType<typeof createMappedServerOwner>,
  dependencyKey: string,
) {
  const dependency = path.join(appDirectory, 'node_modules', dependencyKey);
  fs.mkdirSync(path.dirname(dependency), { recursive: true });
  fs.symlinkSync(owner.owner, dependency, 'dir');
  fs.writeFileSync(
    path.join(appDirectory, 'package.json'),
    JSON.stringify({
      name: 'mapped-server-consumer',
      private: true,
      dependencies: {
        [dependencyKey]:
          dependencyKey === mappedPackageName
            ? owner.version
            : `npm:${mappedPackageName}@${owner.version}`,
      },
    }),
  );
}

function resolveMappedServerDescriptor(
  appDirectory: string,
  owner: ReturnType<typeof createMappedServerOwner>,
  snapshot?: ConfigSourceSnapshot,
) {
  return spawnSync(
    process.execPath,
    [
      '-e',
      `const { pathToFileURL } = require('node:url');
const { resolveReactServerPlugin } = require(process.argv[1]);
const snapshot = JSON.parse(process.argv[3]);
process.stdout.write(resolveReactServerPlugin(
  process.argv[4],
  snapshot ?? undefined,
  pathToFileURL(process.argv[2]).href,
));`,
      path.join(
        packageDirectory,
        'dist/cjs/native-composition/react-composition.js',
      ),
      owner.registrar,
      JSON.stringify(snapshot ?? null),
      appDirectory,
    ],
    {
      cwd: appDirectory,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '' },
    },
  );
}

async function createCliApi(appDirectory: string) {
  const base = ultramodernAppTools();
  const sourceDirectory = path.join(appDirectory, 'src');
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDirectory, 'App.jsx'),
    'export default function App() { return <main>server composition</main>; }',
  );
  const cli = createCli<AppTools>();
  try {
    const { appContext } = await cli.init({
      ...createNativeConfigLoad(),
      configFile: false,
      command: 'build',
      cwd: appDirectory,
      metaName: 'modern-js',
      config: { plugins: [base] },
    });
    const api = appContext.pluginAPI;
    expect(getConfigurationSourceSnapshot(api)).toBeDefined();
    expect(api.getAppContext().entrypoints).toHaveLength(1);
    return api;
  } finally {
    cli.dispose();
  }
}

const linkComposer = (appDirectory: string) => {
  const scope = path.join(appDirectory, 'node_modules/@modern-js');
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(
    packageDirectory,
    path.join(scope, 'ultramodern-app-tools'),
    'dir',
  );
  fs.writeFileSync(
    path.join(appDirectory, 'package.json'),
    JSON.stringify({
      name: 'isolated-server-consumer',
      private: true,
      dependencies: { '@modern-js/ultramodern-app-tools': 'workspace:*' },
    }),
  );
};

describe('server runtime composition', () => {
  test('resolves production serve server plugins from the original captured config', async () => {
    const appDirectory = fs.realpathSync(
      fs.mkdtempSync(
        path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-react-serve-'),
      ),
    );
    const cli = createCli<AppTools>();
    const previousArgv = process.argv;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousModernArgv = process.env.MODERN_ARGV;
    const token = `__um_serve_${path.basename(appDirectory)}`;
    const loads: { env: string; command: string }[] = [];
    const globals = globalThis as unknown as Record<string, unknown>;
    globals[token] = loads;
    let dispose: (() => Promise<unknown>) | undefined;
    try {
      linkComposer(appDirectory);
      // Match normal React build fixtures and the composed runtime imports.
      const requireFromRuntime = createRequire(
        path.join(
          packageDirectory,
          'node_modules/@modern-js/runtime/package.json',
        ),
      );
      const appManifestFile = path.join(appDirectory, 'package.json');
      const appManifest = JSON.parse(fs.readFileSync(appManifestFile, 'utf8'));
      for (const name of [
        'react',
        'react-dom',
        '@modern-js/runtime',
        '@modern-js/runtime-extensions',
        '@modern-js/runtime-renderer-extensions',
        '@modern-js/i18n-integration',
      ]) {
        const ownerDirectory =
          name === 'react' || name === 'react-dom'
            ? path.dirname(requireFromRuntime.resolve(`${name}/package.json`))
            : fs.realpathSync(
                path.join(packageDirectory, 'node_modules', name),
              );
        const ownerManifest = JSON.parse(
          fs.readFileSync(path.join(ownerDirectory, 'package.json'), 'utf8'),
        );
        expect(ownerManifest.name).toBe(name);
        const dependency = path.join(appDirectory, 'node_modules', name);
        fs.mkdirSync(path.dirname(dependency), { recursive: true });
        fs.symlinkSync(ownerDirectory, dependency, 'dir');
        appManifest.dependencies[name] = ownerManifest.version;
      }
      fs.writeFileSync(appManifestFile, JSON.stringify(appManifest));
      fs.mkdirSync(path.join(appDirectory, 'src'));
      fs.writeFileSync(
        path.join(appDirectory, 'src/App.jsx'),
        'export default function App() { return <main>production serve</main>; }',
      );
      const distDirectory = path.join(appDirectory, 'dist');
      const configFile = path.join(appDirectory, 'modern.config.js');
      fs.writeFileSync(
        configFile,
        `module.exports = context => { globalThis[${JSON.stringify(token)}].push(context); return {}; };`,
      );
      process.env.NODE_ENV = 'production';
      delete process.env.MODERN_ARGV;
      process.argv = [process.execPath, 'modern', 'build'];
      const buildCli = createCli<AppTools>();
      let disposeBuild: (() => Promise<unknown>) | undefined;
      try {
        const buildProvider = await resolveNativeConfigLoadProvider({
          appDirectory,
          command: 'build',
        });
        expect(buildProvider).toBeDefined();
        const { appContext: buildContext } = await buildCli.init({
          ...buildProvider,
          cwd: appDirectory,
          configFile,
          command: 'build',
          metaName: 'modern-js',
          config: { plugins: [ultramodernAppTools()] },
        });
        const buildApi = buildContext.pluginAPI;
        disposeBuild = () => buildApi.getHooks().onBeforeExit.call();
        await buildApp(buildApi);
        expect(loads).toEqual([{ env: 'production', command: 'build' }]);
        expect(fs.existsSync(path.join(distDirectory, 'route.json'))).toBe(
          true,
        );
        expect(
          fs.existsSync(path.join(distDirectory, 'renderer-build.json')),
        ).toBe(true);
      } finally {
        try {
          await disposeBuild?.();
        } finally {
          buildCli.dispose();
        }
      }
      const { routes } = JSON.parse(
        fs.readFileSync(path.join(distDirectory, 'route.json'), 'utf8'),
      );
      expect(routes).toEqual([
        expect.objectContaining({
          entryName: 'index',
          urlPath: '/',
          isSSR: false,
        }),
      ]);
      const builtEntryFile = path.resolve(distDirectory, routes[0].entryPath);
      expect(fs.statSync(builtEntryFile).isFile()).toBe(true);
      loads.length = 0;
      process.argv = [process.execPath, 'modern', 'serve'];
      const provider = await resolveNativeConfigLoadProvider({
        appDirectory,
        command: 'serve',
      });
      expect(provider).toBeDefined();
      const { appContext } = await cli.init({
        ...provider,
        cwd: appDirectory,
        configFile,
        command: 'serve',
        metaName: 'modern-js',
        config: { plugins: [ultramodernAppTools()] },
      });
      const api = appContext.pluginAPI;
      dispose = () => api.getHooks().onBeforeExit.call();
      expect(loads).toEqual([{ env: 'production', command: 'serve' }]);
      expect(api.getAppContext().entrypoints).toEqual([
        expect.objectContaining({
          entryName: 'index',
          entry: builtEntryFile,
        }),
      ]);
      const snapshot = getConfigurationSourceSnapshot(api);
      expect(snapshot?.states.some(state => state.path === configFile)).toBe(
        true,
      );
      const plugins = await getServerPlugins(api);
      expect(
        plugins.filter(plugin => plugin.name === descriptorName),
      ).toHaveLength(1);
      expect(getConfigurationSourceSnapshot(api)).toBe(snapshot);
      const manifestFile = path.join(appDirectory, 'package.json');
      const manifestBytes = fs.readFileSync(manifestFile);
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      fs.writeFileSync(
        manifestFile,
        JSON.stringify({ ...manifest, changed: true }),
      );
      try {
        await expect(getServerPlugins(api)).rejects.toThrow(
          'React server plugin declaration changed after configuration load',
        );
      } finally {
        fs.writeFileSync(manifestFile, manifestBytes);
      }
      expect(loads).toHaveLength(1);
    } finally {
      try {
        await dispose?.();
      } finally {
        cli.dispose();
        process.argv = previousArgv;
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        if (previousModernArgv === undefined) delete process.env.MODERN_ARGV;
        else process.env.MODERN_ARGV = previousModernArgv;
        delete globals[token];
        fs.rmSync(appDirectory, { recursive: true, force: true });
      }
    }
  });

  test.each([
    mappedPackageName,
    '@modern-js/ultramodern-app-tools',
  ])('loads the native server descriptor from its declared %s SDK owner', dependencyKey => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-native-server-'));
    const appDirectory = path.join(root, 'app');
    try {
      const owner = createMappedServerOwner(
        root,
        'mapped-native-sdk',
        'native-server-plugin',
      );
      linkMappedComposer(appDirectory, owner, dependencyKey);
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [],
        extraInputs: [
          path.join(appDirectory, 'package.json'),
          path.join(
            appDirectory,
            'node_modules',
            dependencyKey,
            'package.json',
          ),
        ],
      });
      const execution = execFileSync(
        process.execPath,
        [
          '-e',
          `const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const ownerRequire = createRequire(path.join(process.argv[1], 'package.json'));
const requireFromApp = createRequire(path.join(process.cwd(), 'package.json'));
const { resolveSdkServerPlugin } = ownerRequire('./dist/cjs/native-composition/server-plugin-resolution.js');
const { loadServerPlugins } = createRequire(path.join(process.argv[2], 'package.json'))('@modern-js/server-core/node');
const snapshot = JSON.parse(process.argv[3]);
const dependencyKey = process.argv[4];
const ownerExport = ownerRequire.resolve(${JSON.stringify(`${mappedPackageName}/native-server-plugin`)});
if (dependencyKey === ${JSON.stringify(mappedPackageName)}) {
  assert.throws(() => requireFromApp.resolve('@modern-js/ultramodern-app-tools/native-server-plugin'), { code: 'MODULE_NOT_FOUND' });
}
assert.throws(() => requireFromApp.resolve('@modern-js/renderer-core/server'), { code: 'MODULE_NOT_FOUND' });
(async () => {
  for (const originalSnapshot of [snapshot, undefined]) {
    const name = resolveSdkServerPlugin(
      process.cwd(),
      'native-server-plugin',
      pathToFileURL(ownerExport).href,
      originalSnapshot,
    );
    assert.equal(name, dependencyKey + '/native-server-plugin');
    assert.equal(fs.realpathSync(requireFromApp.resolve(name)), fs.realpathSync(ownerExport));
    const instances = await loadServerPlugins([
      { name, options: { renderer: 'solid', entries: {} } },
    ], process.cwd());
    assert.deepEqual(instances.map(plugin => plugin.name), ['@modern-js/native-node-server']);
    assert.ok(instances[0].usePlugins.some(plugin => plugin.name === '@modern-js/native-node-dispatch'));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });`,
          owner.owner,
          packageDirectory,
          JSON.stringify(snapshot),
          dependencyKey,
        ],
        {
          cwd: appDirectory,
          encoding: 'utf8',
          env: { ...process.env, NODE_PATH: '' },
        },
      );
      expect(execution).toBe('');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    mappedPackageName,
    '@modern-js/ultramodern-app-tools',
  ])('loads the same physical mapped SDK through portable %s handlers', async dependencyKey => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-mapped-server-'));
    const originalDirectory = path.join(root, 'original');
    const relocatedDirectory = path.join(root, 'relocated');
    try {
      const owner = createMappedServerOwner(root);
      linkMappedComposer(originalDirectory, owner, dependencyKey);
      const appContext = {
        ...initCliContext<AppTools>({
          appDirectory: originalDirectory,
          command: 'deploy',
          configFile: false,
          metaName: 'modern-js',
          packageName: 'mapped-server-consumer',
          plugins: [],
        }),
        ...initAppToolsContext({
          appDirectory: originalDirectory,
          metaName: 'modern-js',
          runtimeConfigFile: 'modern.runtime.ts',
        }),
      };
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [],
        extraInputs: [
          path.join(originalDirectory, 'package.json'),
          path.join(
            originalDirectory,
            'node_modules',
            dependencyKey,
            'package.json',
          ),
        ],
      });
      const resolution = resolveMappedServerDescriptor(
        originalDirectory,
        owner,
        snapshot,
      );
      if (resolution.status !== 0) {
        throw new Error(resolution.stdout + resolution.stderr, {
          cause: resolution.error,
        });
      }
      const descriptor = { name: resolution.stdout };
      expect(descriptor.name).toBe(`${dependencyKey}/server-plugin`);
      for (const isESM of [false, true]) {
        const code = await generateHandler({
          template: isESM
            ? 'p_genPluginImportsCode; export default p_plugins;'
            : 'p_genPluginImportsCode; module.exports = p_plugins;',
          appContext: {
            ...appContext,
            appDirectory: originalDirectory,
            sharedDirectory: path.join(originalDirectory, 'shared'),
            apiDirectory: path.join(originalDirectory, 'api'),
            lambdaDirectory: path.join(originalDirectory, 'lambda'),
            serverPlugins: [descriptor],
          },
          config: { bff: {} } as Parameters<
            typeof generateHandler
          >[0]['config'],
          isESM,
        });
        fs.writeFileSync(
          path.join(
            originalDirectory,
            `generated-server.${isESM ? 'mjs' : 'cjs'}`,
          ),
          code,
        );
      }
      fs.renameSync(originalDirectory, relocatedDirectory);
      const execution = execFileSync(
        process.execPath,
        [
          '-e',
          `const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { loadServerPlugins } = createRequire(path.join(process.argv[1], 'package.json'))('@modern-js/server-core/node');
const descriptor = JSON.parse(process.argv[2]);
const requireFromApp = createRequire(path.join(process.cwd(), 'package.json'));
assert.equal(fs.realpathSync(requireFromApp.resolve(descriptor.name)), fs.realpathSync(process.argv[3]));
if (process.argv[4] === ${JSON.stringify(mappedPackageName)}) {
  assert.throws(() => requireFromApp.resolve(${JSON.stringify(descriptorName)}), { code: 'MODULE_NOT_FOUND' });
}
assert.throws(() => requireFromApp.resolve('@modern-js/server-runtime-extensions/server-plugin'), { code: 'MODULE_NOT_FOUND' });
(async () => {
  const native = await loadServerPlugins([descriptor], process.cwd());
  const cjs = requireFromApp('./generated-server.cjs');
  const esm = (await import(pathToFileURL(path.join(process.cwd(), 'generated-server.mjs')).href)).default;
  for (const instances of [native, cjs, esm]) {
    assert.deepEqual(instances.map(plugin => plugin.name), ['@modern-js/ultramodern-server']);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });`,
          packageDirectory,
          JSON.stringify(descriptor),
          owner.registrar,
          dependencyKey,
        ],
        {
          cwd: relocatedDirectory,
          encoding: 'utf8',
          env: { ...process.env, NODE_PATH: '' },
        },
      );
      expect(execution).toBe('');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a declaration that resolves to a foreign physical SDK copy', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-foreign-server-'));
    const appDirectory = path.join(root, 'app');
    try {
      const owner = createMappedServerOwner(root, 'owning-sdk');
      const foreign = createMappedServerOwner(root, 'foreign-sdk');
      linkMappedComposer(
        appDirectory,
        foreign,
        '@modern-js/ultramodern-app-tools',
      );
      const missing = resolveMappedServerDescriptor(appDirectory, owner);
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain(
        'React server plugin requires the original configuration source snapshot',
      );
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [],
        extraInputs: [
          path.join(appDirectory, 'package.json'),
          path.join(
            appDirectory,
            'node_modules/@modern-js/ultramodern-app-tools/package.json',
          ),
        ],
      });
      const result = resolveMappedServerDescriptor(
        appDirectory,
        owner,
        snapshot,
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'React server plugin has no declared application import of its SDK owner',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a changed original SDK declaration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-changed-server-'));
    const appDirectory = path.join(root, 'app');
    try {
      const owner = createMappedServerOwner(root);
      linkMappedComposer(appDirectory, owner, mappedPackageName);
      const manifest = path.join(appDirectory, 'package.json');
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [],
        extraInputs: [
          manifest,
          path.join(
            appDirectory,
            'node_modules',
            mappedPackageName,
            'package.json',
          ),
        ],
      });
      fs.writeFileSync(
        manifest,
        JSON.stringify({ private: true, dependencies: {} }),
      );
      const result = resolveMappedServerDescriptor(
        appDirectory,
        owner,
        snapshot,
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'React server plugin declaration changed after configuration load',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    'unchanged',
    'declaration',
    'slot',
  ] as const)('preserves original server ownership through public Rsbuild: %s', mutation => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-rsbuild-server-'));
    const appDirectory = path.join(root, 'app');
    try {
      linkComposer(appDirectory);
      const foreign = createMappedServerOwner(root, 'foreign-sdk');
      fs.writeFileSync(
        path.join(appDirectory, 'modern.config.cjs'),
        `const { defineConfig } = require('@modern-js/ultramodern-app-tools');
process.stdout.write('AUTHORED_CONFIG_LOADED\\n');
module.exports = defineConfig({
  html: { title: 'original' },
  plugins: [{
    name: 'test-original-server-ownership',
    setup(api) {
      globalThis.originalServerOwnershipApi = api;
    },
  }],
  renderer: 'react',
});`,
      );
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          `const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
delete process.env.MODERN_LIB_FORMAT;
delete process.env.MODERN_ARGV;
delete process.env.MODERN_ENV;
const appDirectory = process.argv[1];
const mutation = process.argv[2];
const requireFromApp = createRequire(path.join(appDirectory, 'package.json'));
const rsbuildEntry = requireFromApp.resolve('@modern-js/ultramodern-app-tools/rsbuild');
const { resolveUltramodernRsbuildConfig } = requireFromApp('@modern-js/ultramodern-app-tools/rsbuild');
const { getConfigurationSourceSnapshot } = require(path.join(path.dirname(rsbuildEntry), 'configuration-read-context.js'));
const { resolveReactServerPlugin } = requireFromApp('@modern-js/ultramodern-app-tools/react-composition');
(async () => {
  const { rsbuildConfig } = await resolveUltramodernRsbuildConfig({
    command: 'build',
    cwd: appDirectory,
    configPath: path.join(appDirectory, 'modern.config.cjs'),
    modifyModernConfig(config) {
      if (mutation === 'declaration') {
        const manifestPath = path.join(appDirectory, 'package.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.dependencies['@modern-js/ultramodern-app-tools'] = '0.0.0-declaration-changed';
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      } else if (mutation === 'slot') {
        const slot = path.join(appDirectory, 'node_modules/@modern-js/ultramodern-app-tools');
        fs.unlinkSync(slot);
        fs.symlinkSync(process.argv[3], slot, 'dir');
      }
      return config;
    },
  });
  const pluginNames = rsbuildConfig.plugins.map(plugin => plugin.name);
  assert.ok(pluginNames.includes('builder-plugin-adapter-modern-basic'));
  assert.ok(pluginNames.includes('builder-plugin-support-modern-hooks'));
  const api = globalThis.originalServerOwnershipApi;
  assert.ok(api, 'The public loader must run the original consumer setup');
  const snapshot = getConfigurationSourceSnapshot(api);
  assert.ok(snapshot, 'The public loader must retain the original source snapshot');
  const name = resolveReactServerPlugin(api.getAppContext().appDirectory, snapshot);
  assert.equal(name, ${JSON.stringify(descriptorName)});
  process.stdout.write('ORIGINAL_SERVER_DESCRIPTOR:' + name + '\\n');
  process.stdout.write('PUBLIC_RSBUILD_RESOLVED\\n');
})().catch(error => { console.error(error); process.exitCode = 1; });`,
          appDirectory,
          mutation,
          foreign.owner,
        ],
        {
          cwd: appDirectory,
          encoding: 'utf8',
          env: { ...process.env, NODE_ENV: 'production', NODE_PATH: '' },
        },
      );
      expect(result.stdout.match(/AUTHORED_CONFIG_LOADED/g)).toHaveLength(1);
      if (mutation === 'unchanged') {
        if (result.status !== 0) {
          throw new Error(result.stdout + result.stderr, {
            cause: result.error,
          });
        }
        expect(result.stdout).toContain(
          `ORIGINAL_SERVER_DESCRIPTOR:${descriptorName}`,
        );
        expect(result.stdout).toContain('PUBLIC_RSBUILD_RESOLVED');
      } else {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          'React server plugin declaration changed after configuration load',
        );
        expect(result.stdout).not.toContain('PUBLIC_RSBUILD_RESOLVED');
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('loads the public server subpath from an isolated and relocated consumer', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'um-server-composition-'),
    );
    const originalDirectory = path.join(root, 'original');
    const appDirectory = path.join(root, 'relocated');
    let server: ReturnType<typeof createServerBase> | undefined;
    try {
      linkComposer(originalDirectory);
      const api = await createCliApi(originalDirectory);
      const result = await api
        .getHooks()
        ._internalServerPlugins.call({ plugins: [] });
      const descriptor = result.plugins.find(
        plugin => plugin.name === descriptorName,
      )!;
      expect(descriptor).toEqual({ name: descriptorName });
      const code = await generateHandler({
        template: 'p_genPluginImportsCode; module.exports = p_plugins;',
        appContext: {
          ...api.getAppContext(),
          appDirectory: originalDirectory,
          sharedDirectory: path.join(originalDirectory, 'shared'),
          apiDirectory: path.join(originalDirectory, 'api'),
          lambdaDirectory: path.join(originalDirectory, 'lambda'),
          serverPlugins: [descriptor],
        },
        config: { bff: {} } as Parameters<typeof generateHandler>[0]['config'],
      });
      fs.writeFileSync(
        path.join(originalDirectory, 'generated-server.cjs'),
        code,
      );
      fs.renameSync(originalDirectory, appDirectory);
      const require = createRequire(path.join(appDirectory, 'package.json'));
      // The test runner intercepts in-process resolution; use Node itself to
      // prove that the relocated consumer cannot import a transitive package.
      const isolatedResolution = execFileSync(
        process.execPath,
        [
          '-e',
          `const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const requireFromApp = createRequire(path.join(process.cwd(), 'package.json'));
assert.throws(
  () => requireFromApp.resolve('@modern-js/server-runtime-extensions/server-plugin'),
  { code: 'MODULE_NOT_FOUND' },
);`,
        ],
        {
          cwd: appDirectory,
          encoding: 'utf8',
          // Rstest adds its workspace to NODE_PATH; an isolated consumer has
          // only its declared dependency tree.
          env: { ...process.env, NODE_PATH: '' },
        },
      );
      expect(isolatedResolution).toBe('');
      const instances = await loadServerPlugins([descriptor], appDirectory);
      const generatedInstances = require('./generated-server.cjs');
      expect(
        generatedInstances.map((plugin: { name: string }) => plugin.name),
      ).toEqual(instances.map(plugin => plugin.name));
      expect(instances[0]!.name).toBe('@modern-js/ultramodern-server');

      const options = {
        pwd: appDirectory,
        appContext: { appDirectory, apiDirectory: '', lambdaDirectory: '' },
        config: {
          html: {},
          output: {},
          source: {},
          tools: {},
          server: { logger: false },
          bff: {},
          dev: {},
          security: {},
        },
        plugins: instances,
      } as ProdServerOptions;
      server = createServerBase(options);
      await applyPlugins(server, options);
      await server.init();
      const response = await server.request('/_modern/runtime/status', {}, {});
      expect(response.status).toBe(404);
    } finally {
      await server?.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('emits a working Cloudflare worker without importing Node server policies', async () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'um-server-worker-'),
    );
    try {
      linkComposer(appDirectory);
      const distDirectory = path.join(appDirectory, 'dist');
      fs.mkdirSync(path.join(distDirectory, 'html/main'), { recursive: true });
      fs.writeFileSync(
        path.join(distDirectory, 'html/main/index.html'),
        '<main>worker response</main>',
      );
      fs.writeFileSync(
        path.join(distDirectory, 'route.json'),
        JSON.stringify({
          routes: [
            {
              entryName: 'main',
              entryPath: 'html/main/index.html',
              urlPath: '/',
              isSSR: false,
            },
          ],
        }),
      );
      const api = await createCliApi(appDirectory);
      const { plugins } = await api
        .getHooks()
        ._internalServerPlugins.call({ plugins: [] });
      expect(plugins.some(plugin => plugin.name === descriptorName)).toBe(true);
      const preset = createCloudflarePreset({
        appContext: {
          apiOnly: false,
          appDirectory,
          distDirectory,
          serverPlugins: plugins,
        },
        modernConfig: {},
        api: { isPluginExists: () => false },
      });
      await preset.prepare?.();
      await preset.writeOutput?.();
      await preset.genEntry?.();
      const entryPath = path.join(appDirectory, '.output/server/index.mjs');
      const worker = (await import(pathToFileURL(entryPath).href)).default;
      const response = await worker.fetch(
        new Request('https://worker.example/'),
        {
          ASSETS: {
            fetch: async () => new Response('<main>worker response</main>'),
          },
        },
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('worker response');
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });
});
