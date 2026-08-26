import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES } from '../src/ultramodern-workspace/shared-patches';
import {
  DRIZZLE_ORM_VERSION,
  MODULE_FEDERATION_VERSION,
  TANSTACK_ROUTER_CORE_VERSION,
  TYPES_NODE_VERSION,
} from '../src/ultramodern-workspace/versions';

const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '../../..');
const repoPatchDir = path.join(repoRoot, 'patches');
const templatePatchDir = path.join(packageRoot, 'template-workspace/patches');
const pnpmModulesDir = path.join(repoRoot, 'node_modules/.pnpm');
const require = createRequire(import.meta.url);

function packageStoreDirectory(prefix: string, packagePath: string): string {
  const packageStoreEntry = fs
    .readdirSync(pnpmModulesDir)
    .find(entry => entry.startsWith(prefix));
  assert.ok(
    packageStoreEntry,
    `${prefix} must be installed for patch validation`,
  );
  return path.join(
    pnpmModulesDir,
    packageStoreEntry,
    'node_modules',
    packagePath,
  );
}

function moduleFederationPackageDirectory(packageName: string): string {
  return packageStoreDirectory(
    `@module-federation+${packageName}@${MODULE_FEDERATION_VERSION}_patch_hash=`,
    `@module-federation/${packageName}`,
  );
}

function listPatchFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter(file => file.endsWith('.patch'))
    .sort();
}

function assertPatchReversesAndReapplies(packageName: string): void {
  const patchFile = `@module-federation__${packageName}@${MODULE_FEDERATION_VERSION}.patch`;
  const patchPath = path.join(repoPatchDir, patchFile);
  const installedPackageDir = moduleFederationPackageDirectory(packageName);
  const temporaryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `modern-js-mf-${packageName}-patch-`),
  );

  try {
    fs.cpSync(installedPackageDir, temporaryDir, { recursive: true });
    execFileSync('git', ['apply', '--reverse', '--check', patchPath], {
      cwd: temporaryDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', '--reverse', patchPath], {
      cwd: temporaryDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', '--check', patchPath], {
      cwd: temporaryDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', patchPath], {
      cwd: temporaryDir,
      stdio: 'pipe',
    });
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function compileRuntimeCoreProof(temporaryDir: string): void {
  const proofPath = path.join(temporaryDir, 'runtime-core-proof.ts');
  const environmentProofPath = path.join(
    temporaryDir,
    'runtime-core-environment.d.ts',
  );
  fs.writeFileSync(
    environmentProofPath,
    'declare var global: typeof globalThis;\n',
  );
  fs.writeFileSync(
    proofPath,
    [
      "import { ModuleFederation } from '@module-federation/runtime-core';",
      "import type { ResourceLoadContext } from '@module-federation/runtime-core/types';",
      'export type LoadEntryHook =',
      "  ModuleFederation['remoteHandler']['hooks']['lifecycle']['loadEntry'];",
      'export type ResourceContext = ResourceLoadContext;',
    ].join('\n'),
  );
  try {
    execFileSync(
      path.join(
        repoRoot,
        `node_modules/.bin/${process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo'}`,
      ),
      [
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        'false',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        '--target',
        'ES2022',
        '--lib',
        'ES2022,DOM,DOM.Iterable,ESNext.Disposable',
        environmentProofPath,
        proofPath,
      ],
      { cwd: temporaryDir, stdio: 'pipe' },
    );
  } catch (error) {
    const commandError = error as Error & {
      stderr?: Buffer | string;
      stdout?: Buffer | string;
    };
    throw new Error(
      [
        commandError.message,
        commandError.stdout?.toString(),
        commandError.stderr?.toString(),
      ].join('\n'),
      { cause: error },
    );
  }
}

function assertRuntimeCorePatchIsLoadBearing(): void {
  const patchFile = SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES.find(file =>
    file.startsWith('@module-federation__runtime-core@'),
  );
  assert.ok(patchFile, 'runtime-core patch must be in the shared patch list');
  const patchPath = path.join(repoPatchDir, patchFile);
  const installedPackageDir = moduleFederationPackageDirectory('runtime-core');
  const storeModulesDir = path.resolve(installedPackageDir, '../..');
  const temporaryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-js-mf-runtime-core-patch-'),
  );

  try {
    const temporaryPackageDir = path.join(
      temporaryDir,
      'node_modules/@module-federation/runtime-core',
    );
    fs.mkdirSync(path.dirname(temporaryPackageDir), { recursive: true });
    fs.cpSync(installedPackageDir, temporaryPackageDir, { recursive: true });
    const webpackStubDir = path.join(temporaryDir, 'node_modules/webpack');
    fs.mkdirSync(webpackStubDir, { recursive: true });
    fs.writeFileSync(
      path.join(webpackStubDir, 'package.json'),
      `${JSON.stringify({ name: 'webpack', types: './index.d.ts' })}\n`,
    );
    fs.writeFileSync(
      path.join(webpackStubDir, 'index.d.ts'),
      [
        'export = webpack;',
        'declare namespace webpack {',
        '  interface Compiler {}',
        '  interface Compilation {}',
        '}',
      ].join('\n'),
    );
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(installedPackageDir, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    for (const dependencyName of Object.keys(packageJson.dependencies)) {
      const temporaryDependencyPath = path.join(
        temporaryDir,
        'node_modules',
        dependencyName,
      );
      fs.mkdirSync(path.dirname(temporaryDependencyPath), { recursive: true });
      fs.cpSync(
        fs.realpathSync(path.join(storeModulesDir, dependencyName)),
        temporaryDependencyPath,
        { recursive: true },
      );
    }

    compileRuntimeCoreProof(temporaryDir);
    execFileSync('git', ['apply', '--reverse', patchPath], {
      cwd: temporaryPackageDir,
      stdio: 'pipe',
    });
    assert.throws(
      () => compileRuntimeCoreProof(temporaryDir),
      error => {
        const commandError = error as Error & {
          stderr?: Buffer | string;
          stdout?: Buffer | string;
        };
        const output = [
          commandError.message,
          commandError.stdout?.toString(),
          commandError.stderr?.toString(),
        ].join('\n');
        assert.match(output, /ResourceLoadContext/u);
        return true;
      },
      'unpatched runtime-core declaration must fail strict library checking',
    );
    execFileSync('git', ['apply', patchPath], {
      cwd: temporaryPackageDir,
      stdio: 'pipe',
    });
    compileRuntimeCoreProof(temporaryDir);
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function compileTanstackSsrProof(temporaryDir: string): void {
  const proofPath = path.join(temporaryDir, 'router-core-ssr-proof.ts');
  fs.writeFileSync(
    proofPath,
    [
      "import type { DehydratedMatch } from '@tanstack/router-core/ssr/client';",
      "export type BeforeLoadContextProof = DehydratedMatch['b'];",
    ].join('\n'),
  );
  execFileSync(
    path.join(
      repoRoot,
      `node_modules/.bin/${process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo'}`,
    ),
    [
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      'false',
      '--module',
      'ESNext',
      '--moduleResolution',
      'Bundler',
      '--target',
      'ES2022',
      '--lib',
      'ES2022,DOM,DOM.Iterable,ESNext.Disposable',
      '--types',
      'node',
      proofPath,
    ],
    { cwd: temporaryDir, stdio: 'pipe' },
  );
}

function assertTanstackRouterCorePatchIsLoadBearing(): void {
  const patchFile = SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES.find(file =>
    file.startsWith('@tanstack__router-core@'),
  );
  assert.ok(patchFile, 'router-core patch must be in the shared patch list');
  const patchPath = path.join(repoPatchDir, patchFile);
  const storeEntry = fs
    .readdirSync(pnpmModulesDir)
    .find(entry =>
      entry.startsWith(
        `@tanstack+router-core@${TANSTACK_ROUTER_CORE_VERSION}_patch_hash=`,
      ),
    );
  assert.ok(
    storeEntry,
    `patched @tanstack/router-core@${TANSTACK_ROUTER_CORE_VERSION} must be installed for patch validation`,
  );
  const storeModulesDir = path.join(pnpmModulesDir, storeEntry, 'node_modules');
  const installedPackageDir = path.join(
    storeModulesDir,
    '@tanstack/router-core',
  );
  const temporaryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-js-router-core-patch-'),
  );

  try {
    const temporaryPackageDir = path.join(
      temporaryDir,
      'node_modules/@tanstack/router-core',
    );
    fs.mkdirSync(path.dirname(temporaryPackageDir), { recursive: true });
    fs.cpSync(installedPackageDir, temporaryPackageDir, { recursive: true });
    const routerCorePackageJson = JSON.parse(
      fs.readFileSync(path.join(installedPackageDir, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    for (const dependencyName of Object.keys(
      routerCorePackageJson.dependencies ?? {},
    )) {
      const temporaryDependencyPath = path.join(
        temporaryDir,
        'node_modules',
        dependencyName,
      );
      fs.mkdirSync(path.dirname(temporaryDependencyPath), { recursive: true });
      fs.symlinkSync(
        fs.realpathSync(path.join(storeModulesDir, dependencyName)),
        temporaryDependencyPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }

    // The dist declarations reference node builtins, so strict lib checks
    // need @types/node resolvable from the proof workspace.
    const typesNodeVersion = TYPES_NODE_VERSION.replace(/^\^/, '');
    const typesNodeStoreEntry = fs
      .readdirSync(pnpmModulesDir)
      .find(entry => entry.startsWith(`@types+node@${typesNodeVersion}`));
    assert.ok(
      typesNodeStoreEntry,
      `@types/node@${typesNodeVersion} must be installed for router-core patch validation`,
    );
    const typesNodeModulesDir = path.join(
      pnpmModulesDir,
      typesNodeStoreEntry,
      'node_modules',
    );
    for (const dependencyName of ['@types/node', 'undici-types']) {
      const temporaryDependencyPath = path.join(
        temporaryDir,
        'node_modules',
        dependencyName,
      );
      fs.mkdirSync(path.dirname(temporaryDependencyPath), { recursive: true });
      fs.symlinkSync(
        fs.realpathSync(path.join(typesNodeModulesDir, dependencyName)),
        temporaryDependencyPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }

    // The installed package must already carry the canonical patch.
    execFileSync('git', ['apply', '--reverse', '--check', patchPath], {
      cwd: temporaryPackageDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', '--reverse', patchPath], {
      cwd: temporaryPackageDir,
      stdio: 'pipe',
    });

    // Unpatched 1.171.27 declarations must still fail under
    // skipLibCheck:false; when an upstream release fixes them, this forces a
    // conscious retirement of the patch instead of a silent stale copy.
    assert.throws(
      () => compileTanstackSsrProof(temporaryDir),
      'unpatched @tanstack/router-core ssr declarations should fail strict lib checks; retire the patch if upstream fixed them',
    );

    execFileSync('git', ['apply', '--check', patchPath], {
      cwd: temporaryPackageDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', patchPath], {
      cwd: temporaryPackageDir,
      stdio: 'pipe',
    });
    compileTanstackSsrProof(temporaryDir);
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function runNodeProof(source: string, env: NodeJS.ProcessEnv = {}): void {
  execFileSync(process.execPath, ['--input-type=commonjs', '--eval', source], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
}

function assertModuleFederationRuntimePatchBehavior(): void {
  const manifestUtils = path.join(
    moduleFederationPackageDirectory('manifest'),
    'dist/utils.js',
  );
  const rspackPlugin = path.join(
    moduleFederationPackageDirectory('rspack'),
    'dist/ModuleFederationPlugin.js',
  );
  runNodeProof(
    `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const Module = require('node:module');
      const { createRequire } = Module;
      const originalLoad = Module._load;
      Module._load = function (request) {
        if (request === '@module-federation/dts-plugin/core' || request === '@module-federation/dts-plugin') {
          throw new Error('DTS modules must stay unloaded when dts is false');
        }
        return originalLoad.apply(this, arguments);
      };
      const { getTypesMetaInfo } = require(process.env.MANIFEST_UTILS);
      assert.deepEqual(getTypesMetaInfo({ dts: false }, process.cwd()), {
        path: '', name: '', zip: '', api: '',
      });

      let manifestDtsProjectChecks = 0;
      let manifestDtsAssetLookups = 0;
      Module._load = function (request) {
        if (request === '@module-federation/dts-plugin/core') {
          return {
            isTSProject(dts, context) {
              assert.equal(dts, undefined);
              assert.equal(context, process.cwd());
              manifestDtsProjectChecks += 1;
              return true;
            },
            retrieveTypesAssetsInfo(options) {
              assert.equal(options.context, process.cwd());
              assert.equal(options.generateAPITypes, true);
              assert.equal(options.compileInChildProcess, true);
              assert.equal(options.moduleFederationConfig.name, 'manifest_default_dts');
              manifestDtsAssetLookups += 1;
              return {
                apiFileName: 'manifest-default.d.ts',
                zipName: 'manifest-default.zip',
              };
            },
          };
        }
        return originalLoad.apply(this, arguments);
      };
      assert.deepEqual(
        getTypesMetaInfo({ name: 'manifest_default_dts' }, process.cwd()),
        {
          path: '',
          name: '',
          zip: 'manifest-default.zip',
          api: 'manifest-default.d.ts',
        },
      );
      assert.equal(manifestDtsProjectChecks, 1);
      assert.equal(manifestDtsAssetLookups, 1);

      const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-rspack-proof-'));
      try {
        fs.writeFileSync(path.join(temporaryDir, 'entry.js'), 'export default 1;');
        const pluginRequire = createRequire(process.env.RSPACK_PLUGIN);
        const { rspack } = pluginRequire('@rspack/core');
        const { ModuleFederationPlugin } = require(process.env.RSPACK_PLUGIN);
        const compiler = rspack({
          context: temporaryDir,
          entry: './entry.js',
          mode: 'production',
          output: { path: path.join(temporaryDir, 'dist') },
          plugins: [new ModuleFederationPlugin({
            name: 'patch_behavior', dts: false, manifest: false,
          })],
        });
        compiler.run((error, stats) => {
          compiler.close(closeError => {
            if (error) throw error;
            if (closeError) throw closeError;
            const compilationErrors = stats?.toJson({ all: false, errors: true }).errors ?? [];
            assert.deepEqual(compilationErrors, []);
          });
        });

        let defaultDtsConstructions = 0;
        let defaultDtsApplications = 0;
        let defaultDtsRuntimeRegistrations = 0;
        Module._load = function (request) {
          if (request === '@module-federation/dts-plugin') {
            return {
              DtsPlugin: class {
                constructor(options) {
                  assert.notEqual(options.dts, false);
                  defaultDtsConstructions += 1;
                }
                apply() {
                  defaultDtsApplications += 1;
                }
                addRuntimePlugins() {
                  defaultDtsRuntimeRegistrations += 1;
                }
              },
            };
          }
          return originalLoad.apply(this, arguments);
        };
        rspack({
          context: temporaryDir,
          entry: './entry.js',
          mode: 'production',
          output: { path: path.join(temporaryDir, 'dist-default-dts') },
          plugins: [new ModuleFederationPlugin({
            name: 'default_dts_behavior', manifest: false,
          })],
        });
        assert.equal(defaultDtsConstructions, 1);
        assert.equal(defaultDtsApplications, 1);
        assert.equal(defaultDtsRuntimeRegistrations, 1);
      } finally {
        process.on('exit', () => fs.rmSync(temporaryDir, { recursive: true, force: true }));
      }
    `,
    {
      MANIFEST_UTILS: manifestUtils,
      RSPACK_PLUGIN: rspackPlugin,
    },
  );
}

function assertModernJsV3PatchBehavior(): Promise<void> {
  const packageDir = moduleFederationPackageDirectory('modern-js-v3');
  const configPluginPath = path.join(
    packageDir,
    'dist/cjs/cli/configPlugin.js',
  );
  const configPlugin = require(configPluginPath) as {
    moduleFederationConfigPlugin: (config: Record<string, unknown>) => {
      setup(api: Record<string, unknown>): Promise<void>;
    };
    patchMFConfig(
      config: Record<string, unknown>,
      isServer: boolean,
    ): Record<string, unknown>;
    patchBundlerConfig(options: Record<string, unknown>): void;
  };
  const remoteConfig = {
    name: 'consumer',
    remotes: { catalog: 'catalog@https://example.test/mf-manifest.json' },
  };
  let configCallback: (() => { dev: { lazyCompilation: boolean } }) | undefined;
  return configPlugin
    .moduleFederationConfigPlugin({
      originPluginOptions: { config: remoteConfig },
      csrConfig: remoteConfig,
    })
    .setup({
      getConfig: () => ({ dev: { lazyCompilation: true } }),
      modifyBundlerChain: () => undefined,
      config: (callback: typeof configCallback) => {
        configCallback = callback;
      },
    })
    .then(() => {
      assert.equal(configCallback?.().dev.lazyCompilation, false);

      const serverWorkspace = fs.mkdtempSync(
        path.join(os.tmpdir(), 'modern-js-v3-server-proof-'),
      );
      const runtimePackageDir = path.join(
        serverWorkspace,
        'node_modules/@modern-js/runtime',
      );
      const manifestRecoveryPath = path.join(
        runtimePackageDir,
        'dist/cjs/module-federation/manifest-recovery-runtime-plugin.js',
      );
      fs.mkdirSync(path.dirname(manifestRecoveryPath), { recursive: true });
      fs.writeFileSync(
        path.join(runtimePackageDir, 'package.json'),
        `${JSON.stringify({ main: './index.js', name: '@modern-js/runtime' })}\n`,
      );
      fs.writeFileSync(
        path.join(runtimePackageDir, 'index.js'),
        'module.exports = {};\n',
      );
      fs.writeFileSync(
        manifestRecoveryPath,
        "module.exports = () => ({ name: 'manifest-recovery-proof' });\n",
      );
      const originalCwd = process.cwd();
      process.chdir(serverWorkspace);
      try {
        const serverMfConfig = {
          exposes: {},
          name: 'server_consumer',
          runtimePlugins: [],
        };
        configPlugin.patchMFConfig(serverMfConfig, true);
        assert.equal(serverMfConfig.dts, false);
        assert.deepEqual(serverMfConfig.library, {
          name: 'server_consumer',
          type: 'commonjs-module',
        });
        const manifestRecoveryRealPath = fs.realpathSync(manifestRecoveryPath);
        assert.ok(
          serverMfConfig.runtimePlugins.some(plugin => {
            const pluginPath = Array.isArray(plugin) ? plugin[0] : plugin;
            return fs.realpathSync(pluginPath) === manifestRecoveryRealPath;
          }),
          'server federation must inject the resolvable manifest recovery runtime',
        );
        assert.deepEqual(require(manifestRecoveryPath)(), {
          name: 'manifest-recovery-proof',
        });
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(serverWorkspace, { recursive: true, force: true });
      }

      const splitChunks = { cacheGroups: {}, chunks: 'all' };
      const values = new Map<string, unknown>();
      const output = {
        get: (key: string) => values.get(key),
        chunkLoadingGlobal: (value: unknown) =>
          values.set('chunkLoadingGlobal', value),
        uniqueName: (value: unknown) => values.set('uniqueName', value),
      };
      configPlugin.patchBundlerConfig({
        chain: {
          get: () => undefined,
          ignoreWarnings: () => undefined,
          optimization: {
            delete: () => undefined,
            splitChunks: { entries: () => splitChunks },
          },
          output,
        },
        modernjsConfig: {},
        isServer: false,
        mfConfig: { name: 'consumer' },
        enableSSR: true,
      });
      assert.equal(splitChunks.chunks, 'async');

      const defaultSplitChunks = { cacheGroups: {} };
      configPlugin.patchBundlerConfig({
        chain: {
          get: () => undefined,
          ignoreWarnings: () => undefined,
          optimization: {
            delete: () => undefined,
            splitChunks: { entries: () => defaultSplitChunks },
          },
          output,
        },
        modernjsConfig: {},
        isServer: false,
        mfConfig: { name: 'default_consumer' },
        enableSSR: true,
      });
      assert.equal(Object.hasOwn(defaultSplitChunks, 'chunks'), false);

      const serverSplitChunks = { cacheGroups: {}, chunks: 'all' };
      const serverOutputValues = new Map<string, unknown>([
        ['chunkFilename', '[name].js'],
      ]);
      configPlugin.patchBundlerConfig({
        chain: {
          get: () => undefined,
          ignoreWarnings: () => undefined,
          optimization: {
            delete: () => undefined,
            splitChunks: { entries: () => serverSplitChunks },
          },
          output: {
            get: (key: string) => serverOutputValues.get(key),
            chunkFilename: (value: unknown) =>
              serverOutputValues.set('chunkFilename', value),
            chunkLoadingGlobal: (value: unknown) =>
              serverOutputValues.set('chunkLoadingGlobal', value),
            uniqueName: (value: unknown) =>
              serverOutputValues.set('uniqueName', value),
          },
        },
        modernjsConfig: {},
        isServer: true,
        mfConfig: { name: 'server_consumer' },
        enableSSR: true,
      });
      assert.equal(serverSplitChunks.chunks, 'all');
      assert.notEqual(serverOutputValues.get('chunkFilename'), '[name].js');
    });
}

function assertModernJsRuntimeWrapperBehavior(): void {
  const packageDir = moduleFederationPackageDirectory('modern-js-v3');
  for (const relativePath of [
    'dist/esm/react/index.mjs',
    'dist/esm/react/data-fetch.mjs',
  ]) {
    const temporaryDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-js-v3-wrapper-proof-'),
    );
    try {
      const bridgePackageDir = path.join(
        temporaryDir,
        'node_modules/@module-federation/bridge-react',
      );
      fs.mkdirSync(bridgePackageDir, { recursive: true });
      fs.writeFileSync(
        path.join(bridgePackageDir, 'package.json'),
        `${JSON.stringify({
          name: '@module-federation/bridge-react',
          type: 'module',
          exports: { '.': './index.js', './data-fetch': './index.js' },
        })}\n`,
      );
      fs.writeFileSync(
        path.join(bridgePackageDir, 'index.js'),
        'export const createLazyComponent = options => options;\n',
      );
      const wrapperPath = path.join(temporaryDir, 'wrapper.mjs');
      fs.copyFileSync(path.join(packageDir, relativePath), wrapperPath);
      runNodeProof(
        `
          const assert = require('node:assert/strict');
          import(process.env.WRAPPER_URL).then(module => {
            assert.equal(module.createLazyComponent({ name: 'catalog' }).injectLink, false);
            assert.equal(module.createLazyComponent({ name: 'catalog', injectLink: true }).injectLink, true);
          });
        `,
        { WRAPPER_URL: pathToFileURL(wrapperPath).href },
      );
    } finally {
      fs.rmSync(temporaryDir, { recursive: true, force: true });
    }
  }
}

function assertDeclarationPatchesCompile(): void {
  const temporaryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-declaration-patch-proof-'),
  );
  try {
    const bridgePackageDir = moduleFederationPackageDirectory('bridge-react');
    const temporaryBridgeDir = path.join(
      temporaryDir,
      'node_modules/@module-federation/bridge-react',
    );
    fs.mkdirSync(path.dirname(temporaryBridgeDir), { recursive: true });
    fs.cpSync(bridgePackageDir, temporaryBridgeDir, { recursive: true });
    const runtimeStubDir = path.join(
      temporaryDir,
      'node_modules/@module-federation/runtime',
    );
    fs.mkdirSync(runtimeStubDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeStubDir, 'package.json'),
      `${JSON.stringify({
        name: '@module-federation/runtime',
        type: 'module',
        exports: { '.': { types: './index.d.ts', default: './index.js' } },
      })}\n`,
    );
    fs.writeFileSync(
      path.join(runtimeStubDir, 'index.d.ts'),
      [
        'export declare const getInstance: () => unknown;',
        'export interface ModuleFederationRuntimePlugin {}',
        'export interface ModuleFederation {}',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(runtimeStubDir, 'index.js'), 'export {};\n');
    const webpackStubDir = path.join(temporaryDir, 'node_modules/webpack');
    fs.mkdirSync(webpackStubDir, { recursive: true });
    fs.writeFileSync(
      path.join(webpackStubDir, 'package.json'),
      `${JSON.stringify({ name: 'webpack', types: './index.d.ts' })}\n`,
    );
    fs.writeFileSync(
      path.join(webpackStubDir, 'index.d.ts'),
      'export interface Compiler {}\nexport interface Compilation {}\n',
    );
    const rootPackageJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
    ) as { devDependencies: Record<string, string> };
    const dependencyVersions: Record<string, string | undefined> = {
      '@module-federation/sdk': MODULE_FEDERATION_VERSION,
      '@types/node': TYPES_NODE_VERSION.replace(/^\^/, ''),
      '@types/react': rootPackageJson.devDependencies['@types/react']?.replace(
        /^\^/,
        '',
      ),
      '@types/react-dom': rootPackageJson.devDependencies[
        '@types/react-dom'
      ]?.replace(/^\^/, ''),
      'undici-types': undefined,
    };
    for (const [packageName, exactVersion] of Object.entries(
      dependencyVersions,
    )) {
      const normalizedPrefix = packageName.replace(/^@/, '@').replace('/', '+');
      const storeEntry = fs
        .readdirSync(pnpmModulesDir)
        .find(entry =>
          entry.startsWith(
            `${normalizedPrefix}@${exactVersion ? exactVersion : ''}`,
          ),
        );
      assert.ok(
        storeEntry,
        `${packageName} must be installed for declaration proof`,
      );
      const installedDependencyPath = path.join(
        pnpmModulesDir,
        storeEntry,
        'node_modules',
        packageName,
      );
      const temporaryDependencyPath = path.join(
        temporaryDir,
        'node_modules',
        packageName,
      );
      fs.mkdirSync(path.dirname(temporaryDependencyPath), { recursive: true });
      if (packageName === '@module-federation/sdk') {
        fs.cpSync(installedDependencyPath, temporaryDependencyPath, {
          recursive: true,
        });
      } else {
        fs.symlinkSync(
          fs.realpathSync(installedDependencyPath),
          temporaryDependencyPath,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      }
    }

    const installedDrizzleDir = packageStoreDirectory(
      `drizzle-orm@${DRIZZLE_ORM_VERSION}`,
      'drizzle-orm',
    );
    const temporaryDrizzleDir = path.join(
      temporaryDir,
      'node_modules/drizzle-orm',
    );
    fs.cpSync(installedDrizzleDir, temporaryDrizzleDir, { recursive: true });
    const drizzlePatchPath = path.join(
      templatePatchDir,
      'drizzle-orm-ts7-strict-declarations.patch',
    );
    execFileSync('git', ['apply', '--check', drizzlePatchPath], {
      cwd: temporaryDrizzleDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', drizzlePatchPath], {
      cwd: temporaryDrizzleDir,
      stdio: 'pipe',
    });

    const proofPath = path.join(temporaryDir, 'declaration-proof.ts');
    fs.writeFileSync(
      proofPath,
      [
        "import { createRemoteAppComponent } from '@module-federation/bridge-react';",
        "import { pgTable, serial, text } from 'drizzle-orm/pg-core';",
        "import { sqliteTable, integer } from 'drizzle-orm/sqlite-core';",
        'export const Remote = createRemoteAppComponent;',
        "export const pg = pgTable('items', { id: serial().primaryKey(), name: text() });",
        "export const sqlite = sqliteTable('items', { id: integer().primaryKey() });",
      ].join('\n'),
    );
    execFileSync(
      path.join(
        repoRoot,
        `node_modules/.bin/${process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo'}`,
      ),
      [
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        'false',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        '--target',
        'ES2022',
        '--lib',
        'ES2022,DOM,DOM.Iterable,ESNext.Disposable',
        '--types',
        'node',
        proofPath,
      ],
      { cwd: temporaryDir, stdio: 'inherit' },
    );
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

test('shared UltraModern workspace patch list matches files present in both patch directories', () => {
  const repoPatchFiles = new Set(listPatchFiles(repoPatchDir));
  const templatePatchFiles = new Set(listPatchFiles(templatePatchDir));
  const actualSharedPatchFiles = [...repoPatchFiles].filter(file =>
    templatePatchFiles.has(file),
  );

  assert.deepEqual(
    [...SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES].sort(),
    actualSharedPatchFiles.sort(),
  );
});

for (const packageName of [
  'bridge-react',
  'dts-plugin',
  'manifest',
  'modern-js-v3',
  'rspack',
  'runtime-core',
]) {
  test(`Module Federation ${packageName} patch reverses and reapplies cleanly`, () => {
    assertPatchReversesAndReapplies(packageName);
  });
}

test('TanStack router-core declaration patch is applied and load-bearing', () => {
  assertTanstackRouterCorePatchIsLoadBearing();
});

test('Module Federation runtime-core declaration patch is applied and load-bearing', () => {
  assertRuntimeCorePatchIsLoadBearing();
});

test('Module Federation patches preserve default DTS, explicit opt-out, consumer, and SSR behavior', async () => {
  assertModuleFederationRuntimePatchBehavior();
  await assertModernJsV3PatchBehavior();
  assertModernJsRuntimeWrapperBehavior();
});

test('Module Federation and Drizzle declaration patches compile on strict TypeScript 7', () => {
  assertDeclarationPatchesCompile();
});
