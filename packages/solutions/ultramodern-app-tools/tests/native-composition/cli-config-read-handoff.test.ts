import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import {
  type CLIOptions,
  type CLIPlugin,
  type CLIPluginExtends,
  type ConfigPackageMetadataRead,
  createCli,
  type LoadedConfig,
  cli as nativeCli,
} from '@modern-js/plugin/cli';
import { run as runNativeCli } from '@modern-js/plugin/run';
import { program } from '@modern-js/utils/commander';
import { describe, expect, it } from '@rstest/core';
import { createRunOptions, run } from '../../src/native-composition/cli';
import { createDefineConfig } from '../../src/native-composition/config';
import { assertConfigSourceSnapshotUnchanged } from '../../src/native-composition/config-evaluator/source-snapshot';
import {
  getConfigurationSourceInputs,
  getConfigurationSourceNodes,
  getConfigurationSourceSnapshot,
  type ObservedConfigSourceInputs,
} from '../../src/native-composition/configuration-read-context';
import { createNativeConfigLoad } from '../../src/native-composition/native-config-load';

describe('native CLI configuration read handoff', () => {
  it('captures the original native monorepo load and guards shared inputs during user setup', async () => {
    const workspace = fs.realpathSync(
      fs.mkdtempSync(
        path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-native-load-'),
      ),
    );
    const root = path.join(workspace, 'verticals/billing');
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(workspace, 'shared'));
    fs.writeFileSync(
      path.join(workspace, 'pnpm-workspace.yaml'),
      'packages:\n  - verticals/*\n',
    );
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'native-config-workspace', private: true }),
    );
    const token = `__um_native_load_${path.basename(root)}`;
    const registry = globalThis as unknown as Record<string, unknown>;
    const manifestFile = path.join(root, 'package.json');
    const configFile = path.join(root, 'modern.config.js');
    const localFile = path.join(root, 'modern.config.local.js');
    const inputFile = path.join(workspace, 'shared/selection.json');
    const previousArgv = process.argv;
    const envKeys = [
      'NODE_ENV',
      'MODERN_ENV',
      'MODERN_ARGV',
      'MODERN_FACTORY_LOAD',
    ] as const;
    const previousEnv = envKeys.map(key => process.env[key]);
    const previousOptions = [...program.options];
    const previousName = program.name();
    const previousUsage = program.usage();
    const previousVersionListeners = new Set(
      EventEmitter.prototype.listeners.call(program, 'option:version'),
    );
    const owningCli = createCli<CLIPluginExtends>();
    const configLoad: Pick<CLIOptions, 'wrapConfigLoad' | 'internalPlugins'> =
      createNativeConfigLoad();
    const wrapConfigLoad = configLoad.wrapConfigLoad;
    if (!wrapConfigLoad)
      throw new Error('Native config factory omitted its load');
    const contexts: { env: string; command: string }[] = [];
    const stages: string[] = [];
    let originalLoaded: LoadedConfig<CLIPluginExtends['config']> | undefined;
    let forwardedReader: ConfigPackageMetadataRead | undefined;
    let nativeLoads = 0;
    let dispose: (() => Promise<unknown>) | undefined;
    let boundInputs: ObservedConfigSourceInputs | undefined;
    let boundSnapshot: ReturnType<typeof getConfigurationSourceSnapshot>;
    const consumer: CLIPlugin<CLIPluginExtends> = {
      name: 'original-native-config-load-consumer',
      setup(api) {
        stages.push('setup');
        expect(api.getAppContext().configFile).toBe(configFile);
        expect(api.getConfig()).toBe(originalLoaded?.config);
        expect(process.env.MODERN_FACTORY_LOAD).toBe('before-native-load');
        boundInputs = getConfigurationSourceInputs(api);
        const baseline = getConfigurationSourceSnapshot(api);
        boundSnapshot = baseline;
        const nodes = getConfigurationSourceNodes(api);
        expect(boundInputs).toBeDefined();
        expect(baseline).toBeDefined();
        expect(Object.isFrozen(baseline)).toBe(true);
        expect(baseline?.sourceRoots).toContain(workspace);
        expect(Object.isFrozen(nodes)).toBe(true);
        expect(nodes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              observation: {
                path: inputFile,
                canonicalPath: inputFile,
                operation: 'content',
                existed: true,
              },
              node: expect.objectContaining({
                kind: 'file',
                path: { lexical: inputFile, canonical: inputFile },
              }),
            }),
          ]),
        );
        expect(boundInputs?.packageMetadata).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: manifestFile,
              canonicalPath: manifestFile,
              field: 'name',
              value: 'original-native-config-load',
            }),
          ]),
        );
        dispose = () => api.getHooks().onBeforeExit.call();
        api.onPrepare(() => {
          stages.push('prepare');
          expect(getConfigurationSourceInputs(api)).toBe(boundInputs);
          expect(getConfigurationSourceSnapshot(api)).toBe(baseline);
          expect(getConfigurationSourceNodes(api)).toBe(nodes);
        });
      },
    };
    registry[token] = {
      primary(context: { env: string; command: string }) {
        stages.push('primary');
        contexts.push(context);
        expect(process.env.MODERN_FACTORY_LOAD).toBe('before-native-load');
        process.env.NODE_ENV = 'development';
        process.env.MODERN_ARGV = 'node host start';
        return { plugins: [consumer], primary: true, selected: 'primary' };
      },
      local(context: { env: string; command: string }) {
        stages.push('local');
        contexts.push(context);
        return { local: true, selected: 'local' };
      },
    };
    fs.writeFileSync(
      manifestFile,
      JSON.stringify({ name: 'original-native-config-load', type: 'commonjs' }),
    );
    fs.writeFileSync(
      path.join(root, '.env'),
      'MODERN_FACTORY_LOAD=before-native-load\n',
    );
    fs.writeFileSync(inputFile, '{"original":true}');
    fs.writeFileSync(
      configFile,
      `const fs = require('node:fs');
const path = require('node:path');
const selection = require('../../shared/selection.json');
module.exports = async context => {
  if (!selection.original || !JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../shared/selection.json'), 'utf8')).original) throw new Error('native input changed');
  return globalThis[${JSON.stringify(token)}].primary(context);
};\n`,
    );
    fs.writeFileSync(
      localFile,
      `module.exports = context => globalThis[${JSON.stringify(token)}].local(context);\n`,
    );
    try {
      process.argv = [process.execPath, 'modern', 'dev'];
      process.env.NODE_ENV = 'test';
      for (const key of ['MODERN_ENV', 'MODERN_ARGV', 'MODERN_FACTORY_LOAD'])
        delete process.env[key];
      const { appContext } = await owningCli.init({
        ...configLoad,
        cwd: root,
        command: 'dev',
        configFile,
        version: '0.0.0-native-config-factory-proof',
        async wrapConfigLoad(load, context) {
          expect(Object.isFrozen(context)).toBe(true);
          const returned = await wrapConfigLoad(async reader => {
            nativeLoads++;
            forwardedReader = reader;
            originalLoaded = await load(reader);
            return originalLoaded;
          }, context);
          expect(returned).toBe(originalLoaded);
          return returned;
        },
      });
      expect(nativeLoads).toBe(1);
      expect(forwardedReader).toBeTypeOf('function');
      expect(contexts).toEqual([
        { env: 'test', command: 'dev' },
        { env: 'development', command: 'start' },
      ]);
      expect(stages).toEqual(['primary', 'local', 'setup', 'prepare']);
      expect(appContext.configFile).toBe(configFile);
      expect(originalLoaded?.config).toEqual({
        plugins: [consumer],
        primary: true,
        local: true,
        selected: 'local',
      });
      expect(boundInputs?.observations).toContainEqual({
        path: inputFile,
        canonicalPath: inputFile,
        operation: 'module',
        existed: true,
      });
      if (!boundSnapshot)
        throw new Error('Native workspace baseline was not retained');
      expect(() =>
        assertConfigSourceSnapshotUnchanged(boundSnapshot),
      ).not.toThrow();
      fs.writeFileSync(inputFile, '{"original":false}');
      expect(() => assertConfigSourceSnapshotUnchanged(boundSnapshot)).toThrow(
        'Config source snapshot changed',
      );
    } finally {
      try {
        await dispose?.();
      } finally {
        owningCli.dispose();
        Array.prototype.splice.call(
          program.options,
          0,
          program.options.length,
          ...previousOptions,
        );
        program.name(previousName).usage(previousUsage);
        for (const listener of EventEmitter.prototype.listeners.call(
          program,
          'option:version',
        ))
          if (!previousVersionListeners.has(listener))
            EventEmitter.prototype.removeListener.call(
              program,
              'option:version',
              listener,
            );
        process.argv = previousArgv;
        for (const [index, key] of envKeys.entries()) {
          if (previousEnv[index] === undefined) delete process.env[key];
          else process.env[key] = previousEnv[index];
        }
        delete registry[token];
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    }
  });

  it('preserves the native environment and authored path before plugin registration', async () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(
        path.join(
          process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
          'um-cli-env-read-',
        ),
      ),
    );
    const token = `__um_cli_env_read_${path.basename(root)}`;
    const registry = globalThis as unknown as Record<string, unknown>;
    const configFile = path.join(root, 'modern.config.js');
    const envKeys = [
      'NODE_ENV',
      'MODERN_ENV',
      'MODERN_BASE',
      'MODERN_STAGE',
      'MODERN_ARGV',
    ] as const;
    const previousEnv = envKeys.map(key => process.env[key]);
    const previousArgv = process.argv;
    const previousCommands = [...program.commands];
    const previousName = program.name();
    const previousUsage = program.usage();
    const previousOptions = [...program.options];
    const previousVersionListeners = new Set(
      EventEmitter.prototype.listeners.call(program, 'option:version'),
    );
    const stages: {
      stage: string;
      env: string | undefined;
      base: string | undefined;
      alternate: string | undefined;
      configFile?: string | false;
    }[] = [];
    let dispose: (() => Promise<unknown>) | undefined;
    const record = (stage: string, authoredPath?: string | false) =>
      stages.push({
        stage,
        env: process.env.NODE_ENV,
        base: process.env.MODERN_BASE,
        alternate: process.env.MODERN_STAGE,
        ...(authoredPath === undefined ? {} : { configFile: authoredPath }),
      });
    const consumer: CliPlugin<AppTools> = {
      name: 'native-cli-environment-registration-consumer',
      _registryApi(getAppContext) {
        record('registry', getAppContext().configFile);
        return {};
      },
      setup(api) {
        record('setup', api.getAppContext().configFile);
        dispose = () => api.getHooks().onBeforeExit.call();
        api.onPrepare(() => {
          record('prepare', api.getAppContext().configFile);
        });
        api.addCommand(({ program: commandProgram }) => {
          commandProgram.command('build').action(() => {
            record('action', api.getAppContext().configFile);
          });
        });
      },
    };
    const defineConfig = createDefineConfig(() => ({
      name: '@modern-js/ultramodern-app-tools',
    }));
    registry[token] = defineConfig(async context => {
      expect(context).toEqual({ env: 'staging', command: 'build' });
      record('callback');
      return { renderer: 'solid', plugins: [consumer] };
    });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      '{"name":"native-cli-env-read-handoff"}',
    );
    fs.writeFileSync(path.join(root, '.env'), 'NODE_ENV=staging\n');
    fs.writeFileSync(
      path.join(root, '.env.production'),
      'MODERN_BASE=production\n',
    );
    fs.writeFileSync(
      path.join(root, '.env.staging'),
      'NODE_ENV=test\nMODERN_STAGE=staging\n',
    );
    fs.writeFileSync(
      configFile,
      `module.exports = async context => globalThis[${JSON.stringify(token)}](context);\n`,
    );
    try {
      const observations: (typeof stages)[] = [];
      for (const native of [true, false]) {
        process.argv = [process.execPath, 'ultramodern', 'build'];
        for (const key of envKeys) delete process.env[key];
        stages.length = 0;
        try {
          if (native)
            await runNativeCli(
              await createRunOptions({
                cwd: root,
                version: '0.0.0-native-env-proof',
              }),
            );
          else await run({ cwd: root, version: '0.0.0-native-env-proof' });
          observations.push([...stages]);
        } finally {
          await dispose?.();
          dispose = undefined;
          nativeCli.dispose();
          Array.prototype.splice.call(
            program.commands,
            0,
            program.commands.length,
            ...previousCommands,
          );
          program.name(previousName).usage(previousUsage);
          Array.prototype.splice.call(
            program.options,
            0,
            program.options.length,
            ...previousOptions,
          );
          for (const listener of EventEmitter.prototype.listeners.call(
            program,
            'option:version',
          ))
            if (!previousVersionListeners.has(listener))
              EventEmitter.prototype.removeListener.call(
                program,
                'option:version',
                listener,
              );
        }
      }
      expect(observations[0]).toEqual([
        {
          stage: 'callback',
          env: 'staging',
          base: 'production',
          alternate: undefined,
        },
        ...['registry', 'setup', 'prepare', 'action'].map(stage => ({
          stage,
          env: 'staging',
          base: 'production',
          alternate: undefined,
          configFile,
        })),
      ]);
      expect(observations[1]).toEqual(observations[0]);
    } finally {
      nativeCli.dispose();
      Array.prototype.splice.call(
        program.commands,
        0,
        program.commands.length,
        ...previousCommands,
      );
      program.name(previousName).usage(previousUsage);
      Array.prototype.splice.call(
        program.options,
        0,
        program.options.length,
        ...previousOptions,
      );
      for (const listener of EventEmitter.prototype.listeners.call(
        program,
        'option:version',
      ))
        if (!previousVersionListeners.has(listener))
          EventEmitter.prototype.removeListener.call(
            program,
            'option:version',
            listener,
          );
      process.argv = previousArgv;
      for (const [index, key] of envKeys.entries()) {
        if (previousEnv[index] === undefined) delete process.env[key];
        else process.env[key] = previousEnv[index];
      }
      delete registry[token];
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    { command: 'dev', env: undefined, callbackCommand: 'dev', local: true },
    {
      command: 'build',
      env: undefined,
      callbackCommand: 'build',
      local: false,
    },
    { command: 'dev', env: 'test', callbackCommand: 'start', local: true },
    { command: 'build', env: 'test', callbackCommand: 'dev', local: true },
    {
      command: 'dev',
      env: 'test',
      callbackCommand: 'dev',
      local: true,
      mutateContext: true,
    },
    {
      command: 'inspect',
      env: undefined,
      callbackCommand: 'inspect',
      local: false,
    },
  ] as const)('evaluates $command once with callback command $callbackCommand and env $env', async scenario => {
    const root = fs.realpathSync(
      fs.mkdtempSync(
        path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-cli-read-'),
      ),
    );
    const token = `__um_cli_read_${path.basename(root)}`;
    const registry = globalThis as unknown as Record<string, unknown>;
    const configFile = path.join(root, 'selected.config.js');
    const localFile = path.join(root, 'selected.config.local.js');
    const inputFile = path.join(root, 'config-data.json');
    const linkedFile = path.join(root, 'linked-config-data.json');
    const missingFile = path.join(root, 'missing-config-data.json');
    const helperFile = path.join(root, 'config-helper.cjs');
    const envKey = 'MODERN_ULTRAMODERN_CONFIG_HANDOFF';
    const previousArgv = process.argv;
    const previousEnv = process.env.NODE_ENV;
    const previousModernArgv = process.env.MODERN_ARGV;
    const previousAppEnv = process.env[envKey];
    const previousCommands = [...program.commands];
    const previousName = program.name();
    const previousUsage = program.usage();
    const previousOptions = [...program.options];
    const previousVersionListeners = new Set(
      EventEmitter.prototype.listeners.call(program, 'option:version'),
    );
    const listenerEvents = [
      'SIGINT',
      'SIGTERM',
      'unhandledRejection',
      'uncaughtException',
    ] as const;
    const previousListeners = listenerEvents.map(
      event => new Set(process.listeners(event)),
    );
    const callbackContexts: { env: string; command: string }[] = [];
    const localContexts: { env: string; command: string }[] = [];
    const setupNames: string[] = [];
    const lifecycle: string[] = [];
    const hookBuses: object[] = [];
    const handedInputs: (ObservedConfigSourceInputs | undefined)[] = [];
    let dispose: (() => Promise<unknown>) | undefined;
    let actions = 0;
    let moduleLoads = 0;
    const expectedEnv =
      scenario.env ??
      (scenario.command === 'build' ? 'production' : 'development');
    const mutateContext = 'mutateContext' in scenario && scenario.mutateContext;
    const hasCapture =
      scenario.command === 'dev' || scenario.command === 'build';
    const observe = (
      api: Parameters<NonNullable<CliPlugin<AppTools>['setup']>>[0],
    ) => {
      expect(api.getAppContext().configFile).toBe(configFile);
      expect(api.getAppContext().command).toBe(scenario.command);
      hookBuses.push(api.getHooks());
      handedInputs.push(getConfigurationSourceInputs(api));
    };
    const consumer: CliPlugin<AppTools> = {
      name: 'native-cli-config-read-consumer',
      setup(api) {
        setupNames.push('consumer');
        lifecycle.push('consumer');
        observe(api);
        dispose = () => api.getHooks().onBeforeExit.call();
        api.onPrepare(() => {
          lifecycle.push('prepare');
          observe(api);
          expect(api.getNormalizedConfig().output?.assetPrefix).toBe(
            scenario.local ? '/local/' : '/primary/',
          );
        });
        api.addCommand(({ program: commandProgram }) => {
          commandProgram
            .command(scenario.command)
            .option('-c, --config <file>')
            .action(() => {
              lifecycle.push('action');
              actions++;
              observe(api);
            });
        });
      },
    };
    const defineConfig = createDefineConfig(() => ({
      name: '@modern-js/ultramodern-app-tools',
      setup(api) {
        setupNames.push('base');
        lifecycle.push('base');
        observe(api);
        expect(api.getAppContext().plugins.map(plugin => plugin.name)).toEqual(
          hasCapture
            ? [
                '@modern-js/ultramodern-configuration-read-context',
                '@modern-js/ultramodern-app-tools',
                consumer.name,
              ]
            : ['@modern-js/ultramodern-app-tools', consumer.name],
        );
      },
    }));
    registry[token] = {
      moduleLoaded() {
        moduleLoads++;
      },
      primary: defineConfig(async context => {
        callbackContexts.push(context);
        lifecycle.push('primary');
        expect(process.env[envKey]).toBe('loaded-before-callback');
        if (mutateContext) {
          process.env.NODE_ENV = 'development';
          process.env.MODERN_ARGV = 'node host start';
        }
        return {
          renderer: 'solid',
          plugins: [consumer],
          output: { assetPrefix: '/primary/' },
        };
      }),
      local(context: { env: string; command: string }) {
        localContexts.push(context);
        lifecycle.push('local');
        return { output: { assetPrefix: '/local/' } };
      },
    };
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'native-cli-config-read-handoff' }),
    );
    fs.writeFileSync(
      path.join(root, '.env'),
      `${envKey}=loaded-before-callback\n`,
    );
    fs.writeFileSync(inputFile, '{"value":42}');
    fs.symlinkSync('config-data.json', linkedFile);
    fs.writeFileSync(
      helperFile,
      `globalThis[${JSON.stringify(token)}].moduleLoaded();\nmodule.exports = 42;\n`,
    );
    fs.writeFileSync(
      configFile,
      `const fs = require('node:fs');
const helper = require('./config-helper.cjs');
module.exports = async context => {
  if (JSON.parse(fs.readFileSync(${JSON.stringify(linkedFile)}, 'utf8')).value !== helper) throw new Error('config module input changed');
  fs.statSync(${JSON.stringify(linkedFile)});
  fs.readdirSync(${JSON.stringify(root)});
  if (fs.existsSync(${JSON.stringify(missingFile)})) throw new Error('unexpected config input');
  return globalThis[${JSON.stringify(token)}].primary(context);
};\n`,
    );
    fs.writeFileSync(
      localFile,
      `module.exports = async context => globalThis[${JSON.stringify(token)}].local(context);\n`,
    );
    try {
      process.argv = [
        process.execPath,
        'ultramodern',
        scenario.command,
        '-c',
        configFile,
      ];
      if (scenario.env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = scenario.env;
      if (scenario.callbackCommand === scenario.command)
        delete process.env.MODERN_ARGV;
      else process.env.MODERN_ARGV = `node host ${scenario.callbackCommand}`;
      delete process.env[envKey];
      await run({ cwd: root, version: '0.0.0-native-cli-read-proof' });
      expect(process.env.NODE_ENV).toBe(
        mutateContext ? 'development' : expectedEnv,
      );
      expect(callbackContexts).toEqual([
        { env: expectedEnv, command: scenario.callbackCommand },
      ]);
      expect(localContexts).toEqual(
        scenario.local
          ? [
              {
                env: mutateContext ? 'development' : expectedEnv,
                command: mutateContext ? 'start' : scenario.callbackCommand,
              },
            ]
          : [],
      );
      expect(moduleLoads).toBe(1);
      expect(setupNames).toEqual(['base', 'consumer']);
      expect(lifecycle).toEqual([
        'primary',
        ...(scenario.local ? ['local'] : []),
        'base',
        'consumer',
        'prepare',
        'action',
      ]);
      expect(actions).toBe(1);
      expect(hookBuses).toHaveLength(4);
      expect(hookBuses.every(hooks => hooks === hookBuses[0])).toBe(true);
      if (hasCapture) {
        const inputs = handedInputs[0]!;
        expect(inputs).toBeDefined();
        expect(handedInputs.every(value => value === inputs)).toBe(true);
        expect(Object.isFrozen(inputs)).toBe(true);
        expect(Object.isFrozen(inputs.observations)).toBe(true);
        expect(inputs.observations.every(Object.isFrozen)).toBe(true);
        expect(inputs.observations).toEqual(
          expect.arrayContaining([
            {
              path: linkedFile,
              canonicalPath: inputFile,
              operation: 'content',
              existed: true,
            },
            {
              path: linkedFile,
              canonicalPath: inputFile,
              operation: 'metadata',
              existed: true,
            },
            {
              path: root,
              canonicalPath: root,
              operation: 'directory',
              existed: true,
            },
            {
              path: missingFile,
              canonicalPath: missingFile,
              operation: 'metadata',
              existed: false,
            },
            {
              path: helperFile,
              canonicalPath: helperFile,
              operation: 'module',
              existed: true,
            },
          ]),
        );
        expect(
          inputs.observations.some(
            input => input.path === localFile && input.operation === 'module',
          ),
        ).toBe(scenario.local);
      } else
        expect(handedInputs).toEqual([
          undefined,
          undefined,
          undefined,
          undefined,
        ]);
    } finally {
      try {
        await dispose?.();
      } finally {
        nativeCli.dispose();
        Array.prototype.splice.call(
          program.commands,
          0,
          program.commands.length,
          ...previousCommands,
        );
        program.name(previousName).usage(previousUsage);
        Array.prototype.splice.call(
          program.options,
          0,
          program.options.length,
          ...previousOptions,
        );
        for (const listener of EventEmitter.prototype.listeners.call(
          program,
          'option:version',
        ))
          if (!previousVersionListeners.has(listener))
            EventEmitter.prototype.removeListener.call(
              program,
              'option:version',
              listener,
            );
        process.argv = previousArgv;
        if (previousEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnv;
        if (previousModernArgv === undefined) delete process.env.MODERN_ARGV;
        else process.env.MODERN_ARGV = previousModernArgv;
        if (previousAppEnv === undefined) delete process.env[envKey];
        else process.env[envKey] = previousAppEnv;
        for (const [index, event] of listenerEvents.entries())
          for (const listener of process.listeners(event))
            if (!previousListeners[index].has(listener))
              process.off(event, listener);
        delete registry[token];
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
