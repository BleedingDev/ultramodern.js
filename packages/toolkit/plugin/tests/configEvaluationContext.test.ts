import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { program } from '@modern-js/utils/commander';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { type CLIPlugin, createCli, type LoadedConfig } from '../src/cli';
import { createLoadedConfig } from '../src/cli/run/config/createLoadedConfig';

type ConfigForm = 'object' | 'sync' | 'async';
type ConfigExtension = 'js' | 'ts';

interface FixtureConfig {
  label: string;
  settings: {
    primary?: boolean;
    local?: boolean;
    programmatic?: boolean;
    value: string;
  };
  values: string[];
}

interface ConfigInvocation {
  source: string;
  context: { env: string; command: string };
}

type NativeCLIExtends = {
  config: FixtureConfig & { plugins?: CLIPlugin<NativeCLIExtends>[] };
  normalizedConfig: FixtureConfig;
};

describe('config evaluation context', () => {
  const tempDirs: string[] = [];
  let originalArgv: string[];
  let originalEnv: { NODE_ENV?: string; MODERN_ARGV?: string };

  beforeEach(() => {
    originalArgv = process.argv;
    originalEnv = {
      NODE_ENV: process.env.NODE_ENV,
      MODERN_ARGV: process.env.MODERN_ARGV,
    };
    delete process.env.MODERN_ARGV;
  });

  afterEach(async () => {
    process.argv = originalArgv;
    for (const key of ['NODE_ENV', 'MODERN_ARGV'] as const) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await Promise.all(
      tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })),
    );
  });

  async function createFixture(extension: ConfigExtension, form: ConfigForm) {
    const cwd = await mkdtemp(path.join(tmpdir(), 'modern-config-context-'));
    tempDirs.push(cwd);
    const traceFile = path.join(cwd, 'config-invocations.jsonl');
    await writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'config-evaluation-context-test' }),
    );
    await writeFile(traceFile, '');

    for (const source of ['primary', 'local'] as const) {
      const filename =
        source === 'primary'
          ? `modern.config.${extension}`
          : `modern.config.local.${extension}`;
      const config = JSON.stringify({
        label: source,
        settings: { [source]: true, value: source },
        values: ['shared', source],
      });
      const exportPrefix =
        extension === 'js' ? 'module.exports = ' : 'export default ';
      const fsImport =
        extension === 'js'
          ? "const { appendFileSync } = require('node:fs');"
          : "import { appendFileSync } from 'node:fs';";
      const callbackArgument =
        extension === 'ts'
          ? '(context: { env: string; command: string })'
          : '(context)';
      const contents =
        form === 'object'
          ? `${exportPrefix}${config};`
          : `${fsImport}
${exportPrefix}${form === 'async' ? 'async ' : ''}${callbackArgument} => {
  appendFileSync(${JSON.stringify(traceFile)}, JSON.stringify({ source: ${JSON.stringify(source)}, context }) + '\\n');
  ${form === 'async' ? 'await Promise.resolve();' : ''}
  return ${config};
};`;
      await writeFile(path.join(cwd, filename), contents);
    }

    return {
      cwd,
      filename: `modern.config.${extension}`,
      async invocations(): Promise<ConfigInvocation[]> {
        const trace = await readFile(traceFile, 'utf8');
        return trace
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line));
      },
    };
  }

  for (const extension of ['js', 'ts'] as const) {
    describe(`.${extension} config`, () => {
      it('isolates callback mutation from its caller and local evaluation', async () => {
        process.argv = ['node', 'modern', 'build'];
        const fixture = await createFixture(extension, 'sync');
        const file = path.join(fixture.cwd, fixture.filename);
        const source = await readFile(file, 'utf8');
        await writeFile(
          file,
          source.replace(
            'return {',
            "context.env = 'changed'; context.command = 'build'; return {",
          ),
        );
        const context = { env: 'staging', command: 'dev' };
        const loaded = await createLoadedConfig<FixtureConfig>(
          fixture.cwd,
          fixture.filename,
          undefined,
          context,
        );
        expect(context).toEqual({ env: 'staging', command: 'dev' });
        expect(loaded.config.label).toBe('local');
        expect(await fixture.invocations()).toEqual([
          { source: 'primary', context: { env: 'staging', command: 'dev' } },
          { source: 'local', context: { env: 'staging', command: 'dev' } },
        ]);
      });
      it.each([
        'object',
        'sync',
        'async',
      ] as const)('loads %s primary and local exports with an explicit dev context', async form => {
        process.argv = ['node', 'modern', 'build'];
        process.env.NODE_ENV = 'production';
        const fixture = await createFixture(extension, form);
        const context = { env: 'staging', command: 'dev' };

        const loaded = await createLoadedConfig<FixtureConfig>(
          fixture.cwd,
          fixture.filename,
          undefined,
          context,
        );

        expect(loaded.config).toEqual({
          label: 'local',
          settings: { primary: true, local: true, value: 'local' },
          values: ['shared', 'primary', 'local'],
        });
        expect(await fixture.invocations()).toEqual(
          form === 'object'
            ? []
            : [
                { source: 'primary', context },
                { source: 'local', context },
              ],
        );
      });

      it.each([
        'sync',
        'async',
      ] as const)('skips the local %s callback during an explicit build despite dev argv', async form => {
        process.argv = ['node', 'modern', 'dev'];
        process.env.NODE_ENV = 'development';
        const fixture = await createFixture(extension, form);
        const context = { env: 'preview', command: 'build' };

        const loaded = await createLoadedConfig<FixtureConfig>(
          fixture.cwd,
          fixture.filename,
          undefined,
          context,
        );

        expect(loaded.config).toEqual({
          label: 'primary',
          settings: { primary: true, value: 'primary' },
          values: ['shared', 'primary'],
        });
        expect(await fixture.invocations()).toEqual([
          { source: 'primary', context },
        ]);
      });

      it('loads local config for an explicit start command despite build argv', async () => {
        process.argv = ['node', 'modern', 'build'];
        const fixture = await createFixture(extension, 'sync');
        const context = { env: 'preview', command: 'start' };

        const loaded = await createLoadedConfig<FixtureConfig>(
          fixture.cwd,
          fixture.filename,
          undefined,
          context,
        );

        expect(loaded.config.label).toBe('local');
        expect(await fixture.invocations()).toEqual([
          { source: 'primary', context },
          { source: 'local', context },
        ]);
      });

      it('preserves argv, NODE_ENV, and start-command local loading without an explicit context', async () => {
        process.argv = ['node', 'modern', 'build'];
        process.env.MODERN_ARGV = 'node modern start';
        process.env.NODE_ENV = 'production';
        const fixture = await createFixture(extension, 'async');

        const loaded = await createLoadedConfig<FixtureConfig>(
          fixture.cwd,
          fixture.filename,
        );

        expect(loaded.config.label).toBe('local');
        expect(await fixture.invocations()).toEqual([
          {
            source: 'primary',
            context: { env: 'production', command: 'start' },
          },
          {
            source: 'local',
            context: { env: 'production', command: 'start' },
          },
        ]);
      });

      it('defaults an absent NODE_ENV to development without an explicit context', async () => {
        process.argv = ['node', 'modern', 'build'];
        delete process.env.NODE_ENV;
        const fixture = await createFixture(extension, 'sync');

        const loaded = await createLoadedConfig<FixtureConfig>(
          fixture.cwd,
          fixture.filename,
        );

        expect(loaded.config.label).toBe('primary');
        expect(await fixture.invocations()).toEqual([
          {
            source: 'primary',
            context: { env: 'development', command: 'build' },
          },
        ]);
      });

      it('merges programmatic config after evaluated primary and local config', async () => {
        const fixture = await createFixture(extension, 'async');
        const context = { env: 'test', command: 'dev' };

        const loaded = await createLoadedConfig<FixtureConfig>(
          fixture.cwd,
          fixture.filename,
          {
            label: 'programmatic',
            settings: { programmatic: true, value: 'programmatic' },
            values: ['shared', 'programmatic'],
          },
          context,
        );

        expect(loaded.config).toEqual({
          label: 'programmatic',
          settings: {
            primary: true,
            local: true,
            programmatic: true,
            value: 'programmatic',
          },
          values: ['shared', 'primary', 'local', 'programmatic'],
        });
        expect(await fixture.invocations()).toEqual([
          { source: 'primary', context },
          { source: 'local', context },
        ]);
      });
    });
  }

  describe('native CLI config load', () => {
    const extraEnvKeys = ['MODERN_ENV', 'BASE', 'STAGE'] as const;
    const cliEvents = [
      'SIGINT',
      'SIGTERM',
      'unhandledRejection',
      'uncaughtException',
    ] as const;
    let originalExtraEnv: Partial<
      Record<(typeof extraEnvKeys)[number], string>
    >;

    beforeEach(() => {
      originalExtraEnv = {};
      for (const key of extraEnvKeys) {
        originalExtraEnv[key] = process.env[key];
        delete process.env[key];
      }
    });

    afterEach(() => {
      for (const key of extraEnvKeys) {
        const value = originalExtraEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it.each([
      false,
      true,
    ])('preserves the sole env load, config metadata, and plugin lifecycle with wrapping=%s', async wrapped => {
      process.argv = ['node', 'modern', 'build'];
      process.env.MODERN_ARGV = 'node modern dev';
      process.env.NODE_ENV = 'production';
      const fixture = await createFixture('js', 'sync');
      const file = path.join(fixture.cwd, fixture.filename);
      const traceFile = path.join(fixture.cwd, 'config-invocations.jsonl');
      await Promise.all([
        writeFile(path.join(fixture.cwd, '.env'), 'NODE_ENV=staging\n'),
        writeFile(
          path.join(fixture.cwd, '.env.production'),
          'BASE=production\n',
        ),
        writeFile(
          path.join(fixture.cwd, '.env.staging'),
          'NODE_ENV=test\nSTAGE=staging\n',
        ),
        writeFile(
          file,
          `const { appendFileSync } = require('node:fs');
const traceFile = ${JSON.stringify(traceFile)};
function record(source, context) {
  appendFileSync(traceFile, JSON.stringify({ source, context: {
    ...context, base: process.env.BASE, stage: process.env.STAGE,
  } }) + '\\n');
}
function lifecycleContext(appContext) {
  return {
    env: process.env.NODE_ENV, command: appContext.command,
    appDirectory: appContext.appDirectory, configFile: appContext.configFile,
    packageName: appContext.packageName, isProd: appContext.isProd,
  };
}
const plugin = {
  name: 'native-config-lifecycle',
  _registryApi(getAppContext) {
    record('_registryApi', lifecycleContext(getAppContext()));
    return {};
  },
  setup(api) {
    record('setup', lifecycleContext(api.getAppContext()));
    api.onPrepare(() => record('onPrepare', lifecycleContext(api.getAppContext())));
  },
};
module.exports = async context => {
  record('primary', context);
  await Promise.resolve();
  return {
    label: 'primary', settings: { primary: true, value: 'primary' },
    values: ['shared', 'primary'], plugins: [plugin],
  };
};`,
        ),
        writeFile(
          path.join(fixture.cwd, 'modern.config.local.js'),
          `const { appendFileSync } = require('node:fs');
module.exports = context => {
  appendFileSync(${JSON.stringify(traceFile)}, JSON.stringify({ source: 'local', context: {
    ...context, base: process.env.BASE, stage: process.env.STAGE,
  } }) + '\\n');
  return {
    label: 'local', settings: { local: true, value: 'local' },
    values: ['shared', 'local'],
  };
};`,
        ),
      ]);

      const cli = createCli<NativeCLIExtends>();
      const priorListeners = new Map(
        cliEvents.map(event => [event, process.listeners(event)]),
      );
      const priorProgramOptions = [...program.options];
      const priorProgramName = program.name();
      const priorProgramUsage = program.usage();
      const priorVersionListeners = EventEmitter.prototype.listeners.call(
        program,
        'option:version',
      );
      let wrapperCalls = 0;
      let loaded: LoadedConfig<NativeCLIExtends['config']> | undefined;
      try {
        const { appContext } = await cli.init({
          cwd: fixture.cwd,
          configFile: fixture.filename,
          command: 'routes-generate',
          config: {
            label: 'programmatic',
            settings: { programmatic: true, value: 'programmatic' },
            values: ['shared', 'programmatic'],
          },
          ...(wrapped
            ? {
                async wrapConfigLoad(load, context) {
                  wrapperCalls += 1;
                  expect(context).toEqual({
                    appDirectory: fixture.cwd,
                    configFile: fixture.filename,
                  });
                  expect(Object.isFrozen(context)).toBe(true);
                  expect(Reflect.set(context, 'appDirectory', 'changed')).toBe(
                    false,
                  );
                  expect(context.appDirectory).toBe(fixture.cwd);
                  expect(process.env.NODE_ENV).toBe('staging');
                  expect(process.env.BASE).toBe('production');
                  expect(process.env.STAGE).toBeUndefined();
                  expect(await fixture.invocations()).toEqual([]);
                  loaded = await load();
                  return loaded;
                },
              }
            : {}),
        });

        expect(wrapperCalls).toBe(wrapped ? 1 : 0);
        expect(appContext.config).toEqual({
          label: 'programmatic',
          settings: {
            primary: true,
            local: true,
            programmatic: true,
            value: 'programmatic',
          },
          values: ['shared', 'primary', 'local', 'programmatic'],
          plugins: [
            {
              name: 'native-config-lifecycle',
              _registryApi: expect.any(Function),
              setup: expect.any(Function),
            },
          ],
        });
        expect(appContext.packageName).toBe('config-evaluation-context-test');
        expect(appContext.configFile).toBe(file);
        expect(appContext.appDirectory).toBe(fixture.cwd);
        expect(appContext.command).toBe('routes-generate');
        if (wrapped) {
          expect(loaded).toBeDefined();
          if (!loaded) throw new Error('The native loader was not observed');
          expect(appContext.config).toBe(loaded.config);
          expect(loaded.packageName).toBe(appContext.packageName);
          expect(loaded.configFile).toBe(file);
          expect(loaded.pkgConfig).toBeUndefined();
          expect(loaded.jsConfig).toEqual(expect.any(Function));
          expect(appContext.plugins[0]).toBe(loaded.config.plugins?.[0]);
          expect(appContext.plugins[0].setup).toBe(
            loaded.config.plugins?.[0].setup,
          );
          expect(appContext.plugins[0]._registryApi).toBe(
            loaded.config.plugins?.[0]._registryApi,
          );
        }

        const callbackContext = {
          env: 'staging',
          command: 'dev',
          base: 'production',
        };
        const lifecycleContext = {
          env: 'staging',
          command: 'routes-generate',
          appDirectory: fixture.cwd,
          configFile: file,
          packageName: 'config-evaluation-context-test',
          isProd: false,
          base: 'production',
        };
        expect(await fixture.invocations()).toEqual([
          { source: 'primary', context: callbackContext },
          { source: 'local', context: callbackContext },
          { source: '_registryApi', context: lifecycleContext },
          { source: 'setup', context: lifecycleContext },
          { source: 'onPrepare', context: lifecycleContext },
        ]);
        expect(process.env.NODE_ENV).toBe('staging');
        expect(process.env.BASE).toBe('production');
        expect(process.env.STAGE).toBeUndefined();
      } finally {
        cli.dispose();
        program.name(priorProgramName).usage(priorProgramUsage);
        Array.prototype.splice.call(
          program.options,
          0,
          program.options.length,
          ...priorProgramOptions,
        );
        for (const listener of EventEmitter.prototype.listeners.call(
          program,
          'option:version',
        )) {
          if (!priorVersionListeners.includes(listener))
            EventEmitter.prototype.removeListener.call(
              program,
              'option:version',
              listener,
            );
        }
        expect(program.options).toEqual(priorProgramOptions);
        expect(program.name()).toBe(priorProgramName);
        expect(program.usage()).toBe(priorProgramUsage);
        expect(
          EventEmitter.prototype.listeners.call(program, 'option:version'),
        ).toEqual(priorVersionListeners);
        for (const event of cliEvents)
          expect(process.listeners(event)).toEqual(priorListeners.get(event));
      }
    });

    it.each([
      { initialCommand: 'build', nextCommand: 'start', loadLocal: true },
      { initialCommand: 'dev', nextCommand: 'build', loadLocal: false },
    ])('reevaluates native callback context and local loading after $initialCommand changes to $nextCommand', async ({
      initialCommand,
      nextCommand,
      loadLocal,
    }) => {
      process.argv = ['node', 'modern', 'deploy'];
      process.env.MODERN_ARGV = `node modern ${initialCommand}`;
      process.env.NODE_ENV = 'production';
      const fixture = await createFixture('js', 'sync');
      const file = path.join(fixture.cwd, fixture.filename);
      const source = await readFile(file, 'utf8');
      await writeFile(
        file,
        source.replace(
          'return {',
          `process.env.NODE_ENV = 'preview'; process.env.MODERN_ARGV = 'node modern ${nextCommand}'; return {`,
        ),
      );

      const cli = createCli<NativeCLIExtends>();
      const priorListeners = new Map(
        cliEvents.map(event => [event, process.listeners(event)]),
      );
      const priorProgramOptions = [...program.options];
      const priorProgramName = program.name();
      const priorProgramUsage = program.usage();
      const priorVersionListeners = EventEmitter.prototype.listeners.call(
        program,
        'option:version',
      );
      let wrapperCalls = 0;
      let loaded: LoadedConfig<NativeCLIExtends['config']> | undefined;
      try {
        const { appContext } = await cli.init({
          cwd: fixture.cwd,
          configFile: fixture.filename,
          command: 'routes-generate',
          async wrapConfigLoad(load) {
            wrapperCalls += 1;
            loaded = await load();
            return loaded;
          },
        });

        expect(wrapperCalls).toBe(1);
        expect(loaded).toBeDefined();
        expect(appContext.config).toBe(loaded?.config);
        expect(appContext.config.label).toBe(loadLocal ? 'local' : 'primary');
        expect(appContext.command).toBe('routes-generate');
        expect(appContext.configFile).toBe(file);
        expect(await fixture.invocations()).toEqual([
          {
            source: 'primary',
            context: { env: 'production', command: initialCommand },
          },
          ...(loadLocal
            ? [
                {
                  source: 'local',
                  context: { env: 'preview', command: nextCommand },
                },
              ]
            : []),
        ]);
        expect(process.env.NODE_ENV).toBe('preview');
        expect(process.env.MODERN_ARGV).toBe(`node modern ${nextCommand}`);
      } finally {
        cli.dispose();
        program.name(priorProgramName).usage(priorProgramUsage);
        Array.prototype.splice.call(
          program.options,
          0,
          program.options.length,
          ...priorProgramOptions,
        );
        for (const listener of EventEmitter.prototype.listeners.call(
          program,
          'option:version',
        )) {
          if (!priorVersionListeners.includes(listener))
            EventEmitter.prototype.removeListener.call(
              program,
              'option:version',
              listener,
            );
        }
        expect(program.options).toEqual(priorProgramOptions);
        expect(program.name()).toBe(priorProgramName);
        expect(program.usage()).toBe(priorProgramUsage);
        expect(
          EventEmitter.prototype.listeners.call(program, 'option:version'),
        ).toEqual(priorVersionListeners);
        for (const event of cliEvents)
          expect(process.listeners(event)).toEqual(priorListeners.get(event));
      }
    });
  });
});
