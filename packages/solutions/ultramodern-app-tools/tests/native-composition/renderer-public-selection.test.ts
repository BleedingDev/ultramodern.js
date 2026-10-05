import fs from 'node:fs';
import { createRequire as createActualRequire } from 'node:module' with {
  rstest: 'importActual',
};
import * as nodeModule from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { CliPlugin } from '@modern-js/app-tools';
import { createConfigOptions } from '@modern-js/plugin/cli';
import { createRsbuild } from '@rsbuild/core';
import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import { createRunOptions } from '../../src/native-composition/cli';
import {
  loadUltramodernConfigFile,
  resolveUltramodernConfig,
  resolveUltramodernEntryIdentities,
} from '../../src/native-composition/config';
import { defineConfig } from '../../src/native-composition/index';
import * as compilerActivation from '../../src/native-composition/renderer-compiler-activation';
import { resolveCandidateRendererProfile } from '../../src/native-composition/renderer-profile';
import { resolveRendererRegistration } from '../../src/native-composition/renderer-registration';
import { REACT_CLI_PLUGIN_NAMES } from '../../src/native-composition/renderer-selection';
import type { UltramodernConfigLoader } from '../../src/native-composition/types';

rstest.mock('node:module', { spy: true });
rstest.mock('../../src/native-composition/renderer-compiler-activation', {
  spy: true,
});

afterEach(() => {
  rstest.mocked(nodeModule.createRequire).mockReset();
  rstest
    .mocked(nodeModule.createRequire)
    .mockImplementation(createActualRequire);
  rstest.mocked(compilerActivation.activateNativeRendererCompiler).mockClear();
});

describe('public native selection through owning metadata and builder APIs', () => {
  it.each([
    'solid',
    'octane',
  ] as const)('selects the %s graph once before real metadata and Rsbuild initialization', async renderer => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-public-selection-'));
    const token = `__ultramodern_public_selection_${renderer}`;
    const registry = globalThis as unknown as Record<string, unknown>;
    const previousArgv = process.env.MODERN_ARGV;
    const previousEnv = process.env.NODE_ENV;
    const events = [
      'SIGINT',
      'SIGTERM',
      'unhandledRejection',
      'uncaughtException',
    ] as const;
    const previousListeners = events.map(
      event => new Set(process.listeners(event)),
    );
    let dispose: (() => Promise<unknown>) | undefined;
    let getNames: (() => readonly string[]) | undefined;
    type BuilderPlugins = ReturnType<
      Parameters<
        NonNullable<CliPlugin<UltramodernConfigLoader>['setup']>
      >[0]['getNormalizedConfig']
    >['builderPlugins'];
    let getBuilderPlugins: (() => BuilderPlugins) | undefined;
    let evaluations = 0;
    let setups = 0;
    const configFile = path.join(root, 'modern.config.js');
    const consumer: CliPlugin<UltramodernConfigLoader> = {
      name: 'public-native-selection-consumer',
      setup(api) {
        setups++;
        expect(api.getAppContext().command).toBe('build');
        expect(api.getAppContext().configFile).toBe(configFile);
        getNames = () => api.getAppContext().plugins.map(plugin => plugin.name);
        getBuilderPlugins = () => api.getNormalizedConfig().builderPlugins;
        api.modifyEntrypoints(({ entrypoints }) => ({
          entrypoints: entrypoints.map(entry => ({
            ...entry,
            entryName: `${api.getAppContext().command}-entry`,
          })),
        }));
        dispose = () => api.getHooks().onBeforeExit.call();
      },
    };
    try {
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(
        path.join(root, 'src', 'App.tsx'),
        'export default function App() { return "selection-only"; }',
      );
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          name: 'public-selection',
          dependencies: { '@modern-js/runtime': '3.8.3' },
        }),
      );
      registry[token] = defineConfig(async context => {
        evaluations++;
        expect(context).toEqual({ env: 'test', command: 'build' });
        return { renderer, plugins: [consumer] };
      });
      fs.writeFileSync(
        configFile,
        `module.exports = async context => globalThis[${JSON.stringify(token)}](context);`,
      );
      fs.writeFileSync(
        path.join(root, 'modern.config.ts'),
        'throw new Error("the owning JS config must win over TS");',
      );
      process.env.MODERN_ARGV = 'node ultramodern build';
      process.env.NODE_ENV = 'test';
      const loaded = await loadUltramodernConfigFile({
        appDirectory: root,
        env: 'test',
        command: 'build',
      });
      const launchOptions = await createRunOptions({
        cwd: root,
        version: '0.0.0-selection-proof',
      });
      expect(loaded.configFile).toBe(launchOptions.configFile);
      const metadata = await resolveUltramodernEntryIdentities({
        appDirectory: root,
        config: loaded.config,
        configFile: loaded.configFile,
        command: 'build',
      });
      expect(evaluations).toBe(1);
      expect(setups).toBe(1);
      expect(metadata.entries).toEqual([
        { entryName: 'build-entry', isMainEntry: true },
      ]);
      expect(metadata.primaryEntryName).toBe('build-entry');
      expect(
        fs.existsSync(
          path.join(root, '.modern-js', renderer, 'main', 'index.ts'),
        ),
      ).toBe(false);
      const names = getNames!();
      expect(names).toContain(`@modern-js/renderer-${renderer}-infrastructure`);
      expect(
        names.some(name =>
          REACT_CLI_PLUGIN_NAMES.some(forbidden => forbidden === name),
        ),
      ).toBe(false);
      expect(getBuilderPlugins!()).toEqual([]);
      await dispose?.();
      dispose = undefined;
      // The operational CLI initializes the installed provider and compiler.
      await createConfigOptions<UltramodernConfigLoader>({
        cwd: root,
        configFile: false,
        command: 'build',
        config: loaded.config,
        internalPlugins: [
          {
            name: 'public-native-operational-context',
            setup(api) {
              api.updateAppContext({ configFile: loaded.configFile });
            },
          },
        ],
      });
      expect(evaluations).toBe(1);
      expect(setups).toBe(2);
      expect(
        compilerActivation.activateNativeRendererCompiler,
      ).toHaveBeenCalledTimes(1);
      expect(
        compilerActivation.activateNativeRendererCompiler,
      ).toHaveBeenCalledWith(renderer, {
        rendererIdentities: expect.any(Function),
      });
      const rsbuild = await createRsbuild({
        cwd: root,
        rsbuildConfig: {
          plugins: getBuilderPlugins!(),
          source: { entry: { main: path.join(root, 'src', 'App.tsx') } },
          tools: { htmlPlugin: false },
        },
      });
      const configs = await rsbuild.initConfigs();
      expect(configs).toHaveLength(1);
      expect(
        configs
          .flatMap(config => config.plugins ?? [])
          .map(plugin => plugin?.constructor.name),
      ).not.toContain('ReactRefreshRspackPlugin');
    } finally {
      await dispose?.();
      if (previousArgv === undefined) delete process.env.MODERN_ARGV;
      else process.env.MODERN_ARGV = previousArgv;
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
      for (const [index, event] of events.entries())
        for (const listener of process.listeners(event))
          if (!previousListeners[index].has(listener))
            process.off(event, listener);
      delete registry[token];
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    'solid',
    'octane',
  ] as const)('reads %s entry metadata before adapter installation and requires it for operational setup', async renderer => {
    const root = fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'um-uninstalled-native-selection-',
      ),
    );
    const requests = new Set(
      resolveRendererRegistration(renderer).frameworkModules.map(
        module => module.request,
      ),
    );
    const attempted: string[] = [];
    const events = [
      'SIGINT',
      'SIGTERM',
      'unhandledRejection',
      'uncaughtException',
    ] as const;
    const previousListeners = events.map(
      event => new Set(process.listeners(event)),
    );
    let dispose: (() => Promise<unknown>) | undefined;
    rstest.mocked(nodeModule.createRequire).mockImplementation(anchor => {
      const request = createActualRequire(anchor);
      const resolve = request.resolve;
      rstest
        .spyOn(request, 'resolve')
        .mockImplementation((specifier, options) => {
          if (requests.has(specifier)) {
            attempted.push(specifier);
            throw Object.assign(
              new Error(`Cannot find module '${specifier}'`),
              { code: 'MODULE_NOT_FOUND' },
            );
          }
          return resolve(specifier, options);
        });
      return request;
    });
    try {
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(
        path.join(root, 'src', 'App.tsx'),
        'export default function App() { return null; }',
      );
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'uninstalled-native-selection' }),
      );
      const config = await resolveUltramodernConfig(
        defineConfig({
          renderer,
          plugins: [
            {
              name: 'uninstalled-native-selection-consumer',
              setup(api) {
                dispose = () => api.getHooks().onBeforeExit.call();
              },
            },
          ],
        }),
        { command: 'build', env: 'test' },
      );
      const metadata = await resolveUltramodernEntryIdentities({
        appDirectory: root,
        config,
        command: 'build',
      });
      expect(metadata.entries).toEqual([
        { entryName: 'index', isMainEntry: true },
      ]);
      expect(metadata.routerBindings.index.defaultProvider).toEqual({
        ...resolveCandidateRendererProfile(renderer).router,
        framework: resolveRendererRegistration(renderer).routerFrameworks[0],
      });
      expect(attempted).toEqual([]);
      expect(
        compilerActivation.activateNativeRendererCompiler,
      ).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false);
      expect(fs.existsSync(path.join(root, '.modern-js'))).toBe(false);
      await dispose?.();
      dispose = undefined;

      const unsupported = await resolveUltramodernConfig(
        defineConfig({ renderer, server: { rsc: true } }),
        { command: 'build', env: 'test' },
      );
      await expect(
        resolveUltramodernEntryIdentities({
          appDirectory: root,
          config: unsupported,
          command: 'build',
        }),
      ).rejects.toThrow('unsupported-renderer-capability');
      expect(attempted).toEqual([]);

      await expect(
        createConfigOptions<UltramodernConfigLoader>({
          cwd: root,
          configFile: false,
          command: 'build',
          config,
        }),
      ).rejects.toThrow(`Cannot find module '${[...requests][0]}'`);
      expect(attempted).toEqual([[...requests][0]]);
      expect(
        compilerActivation.activateNativeRendererCompiler,
      ).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(root, '.modern-js'))).toBe(false);
    } finally {
      await dispose?.();
      for (const [index, event] of events.entries())
        for (const listener of process.listeners(event))
          if (!previousListeners[index].has(listener))
            process.off(event, listener);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
