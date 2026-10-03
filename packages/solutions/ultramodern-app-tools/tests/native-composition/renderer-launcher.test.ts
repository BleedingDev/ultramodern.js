import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppTools } from '@modern-js/app-tools';
import { createAsyncHook } from '@modern-js/plugin';
import { createCli } from '@modern-js/plugin/cli';
import { createRsbuild } from '@rsbuild/core';
import { rstest } from '@rstest/core';
import {
  createRunOptions,
  generateRouteArtifacts,
  run,
} from '../../src/native-composition/cli';
import { createDefineConfig } from '../../src/native-composition/config';
import { nativeRendererIsolationPlugin } from '../../src/native-composition/renderer-selection';
import { resolveUltramodernRsbuildConfig } from '../../src/native-composition/rsbuild';

describe('renderer-owned launcher', () => {
  it.each([
    '-h',
    '--help',
    '-V',
    '--version',
    '--wat',
    '--config-file',
    '--config',
    'extra-argument',
  ])('handles route command %s without loading a poison config', async flag => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'um-cli-help-'));
    const originalArgv = process.argv;
    const configPath = path.join(fixture, 'modern.config.mjs');
    const marker = path.join(fixture, 'config-loaded');
    fs.writeFileSync(
      path.join(fixture, 'package.json'),
      JSON.stringify({ name: 'pure-route-help', type: 'module' }),
    );
    fs.writeFileSync(
      configPath,
      `import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(marker)}, 'loaded');
export default () => { throw new Error('Help must never evaluate config'); };`,
    );
    const output: string[] = [];
    const stdout = rstest
      .spyOn(process.stdout, 'write')
      .mockImplementation(chunk => {
        output.push(String(chunk));
        return true;
      });
    const errorOutput: string[] = [];
    const stderr = rstest
      .spyOn(process.stderr, 'write')
      .mockImplementation(chunk => {
        errorOutput.push(String(chunk));
        return true;
      });
    try {
      process.argv = [
        process.execPath,
        'ultramodern',
        'routes-generate',
        flag,
        '-c',
        configPath,
      ];
      const task = run({ cwd: fixture, version: '0.0.0-help-test' });
      if (
        ['--wat', '--config-file', '--config', 'extra-argument'].includes(flag)
      ) {
        await expect(task).rejects.toThrow(
          /unknown option|argument missing|too many arguments/,
        );
        expect(output).toEqual([]);
        expect(errorOutput.join('')).toContain('error:');
      } else {
        await task;
        if (flag === '-h' || flag === '--help') {
          expect(output.join('')).toContain('ultramodern routes-generate');
          expect(output.join('')).toContain('-c, --config <file>');
        } else {
          expect(output.join('')).toBe('0.0.0-help-test\n');
        }
        expect(errorOutput).toEqual([]);
      }
      expect(fs.existsSync(marker)).toBe(false);
      expect(fs.readdirSync(fixture).sort()).toEqual([
        'modern.config.mjs',
        'package.json',
      ]);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      process.argv = originalArgv;
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it.each([
    'solid',
    'octane',
  ] as const)('does not discover React from a %s app dependency in either launch path', async renderer => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'um-launcher-'));
    const token = `__ultramodern_launcher_${renderer}`;
    const globalRegistry = globalThis as unknown as Record<string, unknown>;
    const originalArgv = process.argv;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalModernArgv = process.env.MODERN_ARGV;
    const commandClis: ReturnType<typeof createCli<AppTools>>[] = [];
    const callbackContexts: { env: string; command: string }[] = [];
    const setupPaths: (string | false)[] = [];
    const pluginNames: string[][] = [];
    let builderSetups = 0;
    const configPath = path.join(fixture, 'modern.config.mjs');

    // Plain JS proves the owning config/launch path without claiming that a
    // native JSX compiler or application renderer has already been admitted.
    const defineConfig = createDefineConfig(selected => ({
      name: '@modern-js/ultramodern-app-tools',
      setup(api) {
        expect(selected).toBe(renderer);
        setupPaths.push(api.getAppContext().configFile);
        pluginNames.push(
          api.getAppContext().plugins.map(plugin => plugin.name),
        );
      },
    }));
    globalRegistry[token] = defineConfig(async context => {
      callbackContexts.push(context);
      return {
        renderer,
        source: { entry: { main: path.join(fixture, 'entry.js') } },
        output: { disableTsChecker: true, disableSvgr: true },
        builderPlugins: [
          nativeRendererIsolationPlugin(renderer),
          {
            name: 'launcher-consumer-builder',
            setup() {
              builderSetups += 1;
            },
          },
        ],
      };
    });
    fs.writeFileSync(
      path.join(fixture, 'package.json'),
      JSON.stringify({
        name: `launcher-${renderer}`,
        type: 'module',
        dependencies: { '@modern-js/runtime': 'workspace:*' },
      }),
    );
    fs.writeFileSync(
      path.join(fixture, 'entry.js'),
      'export const value = 42;',
    );
    fs.writeFileSync(
      configPath,
      `export default async context => globalThis[${JSON.stringify(token)}](context);`,
    );

    try {
      process.argv = [
        process.execPath,
        'ultramodern',
        'inspect',
        '-c',
        configPath,
      ];
      process.env.NODE_ENV = 'test';
      delete process.env.MODERN_ARGV;
      process.argv = [process.execPath, 'ultramodern', 'build'];
      const explicitFileOptions = await createRunOptions({
        cwd: fixture,
        configFile: 'modern.config.mjs',
        version: '0.0.0-launcher-test',
      });
      expect(explicitFileOptions.configFile).toBe(configPath);
      process.argv.push('-c', path.join(fixture, 'cli.config.mjs'));
      const cliOverrideOptions = await createRunOptions({
        cwd: fixture,
        configFile: configPath,
        version: '0.0.0-launcher-test',
      });
      expect(cliOverrideOptions.configFile).toBe(
        path.join(fixture, 'cli.config.mjs'),
      );
      process.argv[2] = 'routes-generate';
      const routeOverrideOptions = await createRunOptions({
        cwd: fixture,
        configFile: configPath,
        version: '0.0.0-launcher-test',
      });
      expect(routeOverrideOptions.configFile).toBe(
        path.join(fixture, 'cli.config.mjs'),
      );
      for (const command of ['dev', 'build', 'serve', 'inspect']) {
        process.argv = [process.execPath, 'ultramodern', command];
        if (command === 'inspect') process.argv.push('-c', configPath);
        const runOptions = await createRunOptions({
          cwd: fixture,
          version: '0.0.0-launcher-test',
        });
        expect(runOptions.internalPlugins).toEqual([]);
        expect(runOptions.configFile).toBe(configPath);
        const cli = createCli<AppTools>();
        commandClis.push(cli);
        await cli.init({ ...runOptions, command });
      }
      expect(callbackContexts).toEqual([
        { env: 'test', command: 'dev' },
        { env: 'test', command: 'build' },
        { env: 'test', command: 'serve' },
        { env: 'test', command: 'inspect' },
      ]);

      const { rsbuildConfig } = await resolveUltramodernRsbuildConfig({
        cwd: fixture,
        configPath,
        command: 'build',
      });
      expect(callbackContexts).toEqual([
        { env: 'test', command: 'dev' },
        { env: 'test', command: 'build' },
        { env: 'test', command: 'serve' },
        { env: 'test', command: 'inspect' },
        { env: 'test', command: 'build' },
      ]);
      expect(setupPaths).toEqual(Array(5).fill(configPath));
      for (const names of pluginNames) {
        expect(names).not.toContain('@modern-js/runtime');
      }
      expect(rsbuildConfig.plugins?.map(plugin => plugin?.name)).toEqual(
        expect.arrayContaining([
          'builder-plugin-adapter-modern-basic',
          'builder-plugin-support-modern-hooks',
          'launcher-consumer-builder',
        ]),
      );

      const rsbuild = await createRsbuild({ cwd: fixture, rsbuildConfig });
      const [rspackConfig] = await rsbuild.initConfigs();
      expect(builderSetups).toBe(1);
      expect(
        rspackConfig.plugins?.map(plugin => plugin?.constructor.name),
      ).not.toContain('ReactRefreshPlugin');
      expect(
        rspackConfig.plugins?.map(plugin => plugin?.constructor.name),
      ).not.toContain('ReactRefreshRspackPlugin');
    } finally {
      for (const cli of commandClis) cli.dispose();
      process.argv = originalArgv;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalModernArgv === undefined) delete process.env.MODERN_ARGV;
      else process.env.MODERN_ARGV = originalModernArgv;
      delete globalRegistry[token];
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it.each([
    'success',
    'direct CLI success',
    'host route arguments',
    'emission failure',
    'prepare failure',
    'emission and disposal failure',
  ] as const)('awaits route generation and disposes after %s', async outcome => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'um-route-helper-'));
    const token = `__ultramodern_route_helper_${outcome}`;
    const registry = globalThis as unknown as Record<string, unknown>;
    const originalArgv = process.argv;
    const originalModernArgv = process.env.MODERN_ARGV;
    const envKey = 'MODERN_ULTRAMODERN_LAUNCHER_TEST';
    const originalAppEnv = process.env[envKey];
    const listenerEvents = [
      'SIGINT',
      'SIGTERM',
      'unhandledRejection',
      'uncaughtException',
    ] as const;
    const listeners = listenerEvents.map(event => process.listeners(event));
    const contexts: { env: string; command: string }[] = [];
    const events: string[] = [];
    const configPath = path.join(
      fixture,
      outcome === 'direct CLI success'
        ? 'routes.config.mjs'
        : 'modern.config.mjs',
    );
    const defineConfig = createDefineConfig(() => ({
      name: '@modern-js/ultramodern-app-tools',
      registryHooks: {
        generateEntryCode:
          createAsyncHook<
            AppTools['extendHooks']['generateEntryCode']['call']
          >(),
      },
      setup(api) {
        expect(api.getAppContext().configFile).toBe(configPath);
        api.updateAppContext({
          entrypoints: [
            { entryName: 'main', entry: path.join(fixture, 'entry.js') },
          ],
        });
        api.onPrepare(() => {
          events.push('prepare');
          if (outcome === 'prepare failure') throw new Error(outcome);
        });
        api.generateEntryCode(async ({ entrypoints }) => {
          expect(entrypoints.map(entry => entry.entryName)).toEqual(['main']);
          events.push('emit start');
          await new Promise<void>(resolve => setTimeout(resolve, 5));
          events.push('emit end');
          if (
            outcome === 'emission failure' ||
            outcome === 'emission and disposal failure'
          ) {
            throw new Error('emission failure');
          }
        });
        api.onBeforeExit(async () => {
          await Promise.resolve();
          events.push('dispose');
          if (outcome === 'emission and disposal failure') {
            throw new Error('disposal failure');
          }
        });
      },
    }));
    registry[token] = defineConfig(async context => {
      expect(process.env[envKey]).toBe('target-app');
      contexts.push(context);
      return { renderer: 'solid' };
    });
    fs.writeFileSync(
      path.join(fixture, 'package.json'),
      JSON.stringify({ name: 'route-helper', type: 'module' }),
    );
    fs.writeFileSync(
      configPath,
      `export default async context => globalThis[${JSON.stringify(token)}](context);`,
    );
    fs.writeFileSync(path.join(fixture, '.env'), `${envKey}=target-app\n`);
    try {
      delete process.env[envKey];
      // A parent application's argv must not replace this app's config.
      process.argv = [
        process.execPath,
        'host',
        'build',
        '-c',
        '/missing.config.mjs',
      ];
      process.env.MODERN_ARGV = 'node host dev';
      if (outcome === 'direct CLI success') {
        process.argv = [
          process.execPath,
          'ultramodern',
          'routes-generate',
          '--config',
          configPath,
        ];
      } else if (outcome === 'host route arguments') {
        process.argv = [
          process.execPath,
          'host',
          'routes-generate',
          '--wat',
          '--config-file',
          '/missing.config.mjs',
        ];
      }
      const task =
        outcome === 'direct CLI success'
          ? run({ cwd: fixture, version: '0.0.0-launcher-test' })
          : generateRouteArtifacts({ appDirectory: fixture });
      if (
        outcome === 'success' ||
        outcome === 'direct CLI success' ||
        outcome === 'host route arguments'
      ) {
        await task;
      } else if (outcome === 'emission and disposal failure') {
        const error = await task.catch(error => error);
        expect(error).toBeInstanceOf(AggregateError);
        expect(error.errors.map((cause: Error) => cause.message)).toEqual([
          'emission failure',
          'disposal failure',
        ]);
      } else await expect(task).rejects.toThrow(outcome);
      expect(contexts).toHaveLength(1);
      expect(contexts[0].command).toBe('routes-generate');
      expect(events).toEqual(
        outcome === 'prepare failure'
          ? ['prepare', 'dispose']
          : ['prepare', 'emit start', 'emit end', 'dispose'],
      );
      expect(process.env.MODERN_ARGV).toBe('node host dev');
      for (const [index, event] of listenerEvents.entries()) {
        expect(process.listeners(event)).toEqual(listeners[index]);
      }
    } finally {
      process.argv = originalArgv;
      if (originalModernArgv === undefined) delete process.env.MODERN_ARGV;
      else process.env.MODERN_ARGV = originalModernArgv;
      if (originalAppEnv === undefined) delete process.env[envKey];
      else process.env[envKey] = originalAppEnv;
      delete registry[token];
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
