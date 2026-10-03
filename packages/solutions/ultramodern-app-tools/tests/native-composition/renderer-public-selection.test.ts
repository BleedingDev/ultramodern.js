import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CliPlugin } from '@modern-js/app-tools';
import { createRsbuild } from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import { createRunOptions } from '../../src/native-composition/cli';
import {
  loadUltramodernConfigFile,
  resolveUltramodernEntryIdentities,
} from '../../src/native-composition/config';
import { defineConfig } from '../../src/native-composition/index';
import { REACT_CLI_PLUGIN_NAMES } from '../../src/native-composition/renderer-selection';
import type { UltramodernConfigLoader } from '../../src/native-composition/types';

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
      // This metadata read initializes the real selected compiler; UI compilation,
      // rendering and admission belong to the native application gates.
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
});
