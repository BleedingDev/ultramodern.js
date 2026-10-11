import fs from 'node:fs';
import path from 'node:path';
import { createRunOptions as createAppToolsRunOptions } from '@modern-js/app-tools/cli/run';
import type { CliPlugin } from '@modern-js/app-tools/cli-config';
import { type CLIOptions, createCli, type Plugin } from '@modern-js/plugin/cli';
import { run as runPluginCli } from '@modern-js/plugin/run';
import { getNodeEnv } from '@modern-js/utils';
import { Command } from '@modern-js/utils/commander';
import { loadEnv } from '@rsbuild/core';
import { loadUltramodernConfigFile } from './config';
import { createRouteGenerationCommand } from './native-entry-command';
import type { UltramodernConfigLoader } from './types';

type LauncherOptions = CLIOptions<UltramodernConfigLoader>;

export type RunOptions = Pick<
  LauncherOptions,
  'cwd' | 'initialLog' | 'metaName'
> & {
  configFile?: string;
  statePluginName?: string;
  version: string;
};

export interface CreatedRunOptions {
  cwd: LauncherOptions['cwd'];
  initialLog: NonNullable<LauncherOptions['initialLog']>;
  configFile: LauncherOptions['configFile'];
  metaName: NonNullable<LauncherOptions['metaName']>;
  internalPlugins: Plugin[];
  handleSetupResult: (
    setupResult: Record<string, (...args: any) => any>,
    api: Parameters<NonNullable<LauncherOptions['handleSetupResult']>>[1],
  ) => void;
}

/** The selected config owns runtime plugins, including React's runtime. */
async function createLauncherOptions(
  options: RunOptions,
): Promise<CreatedRunOptions> {
  const configFile = path.resolve(
    options.cwd ?? process.cwd(),
    options.configFile ?? 'modern.config',
  );
  const runOptions = await createAppToolsRunOptions({
    ...options,
    configFile,
    internalPlugins: {},
  });
  if (
    !runOptions.configFile &&
    options.configFile !== undefined &&
    fs.existsSync(configFile)
  ) {
    return { ...runOptions, configFile };
  }
  return runOptions;
}

export async function createRunOptions(
  options: RunOptions,
): Promise<CreatedRunOptions> {
  let routeConfig: string | undefined;
  if (process.argv[2] === 'routes-generate') {
    const command = createRouteGenerationCommand(
      new Command('ultramodern'),
    ).exitOverride();
    await command.parseAsync(process.argv.slice(3), { from: 'user' });
    routeConfig = command.opts<{ config?: string }>().config;
  }
  const runOptions = await createLauncherOptions(options);
  return routeConfig ? { ...runOptions, configFile: routeConfig } : runOptions;
}

/** Run the normal framework CLI without dependency-based renderer discovery. */
export async function run(options: RunOptions): Promise<void> {
  if (process.argv[2] === 'routes-generate') {
    const flags = process.argv.slice(3);
    if (flags.includes('-h') || flags.includes('--help')) {
      process.stdout.write(
        createRouteGenerationCommand(
          new Command('ultramodern'),
        ).helpInformation(),
      );
      return;
    }
    if (flags.includes('-V') || flags.includes('--version')) {
      process.stdout.write(`${options.version}\n`);
      return;
    }
  }
  const runOptions = await createRunOptions(options);
  if (process.argv[2] === 'routes-generate') {
    await generateRouteArtifacts({
      appDirectory: options.cwd ?? process.cwd(),
      configPath: runOptions.configFile || undefined,
      version: options.version,
    });
    return;
  }
  await runPluginCli(runOptions);
}

export interface GenerateRouteArtifactsOptions {
  appDirectory: string;
  /** Optional authored config file, resolved from the application directory. */
  configPath?: string;
  version?: string;
}

// Modern's command helpers use process context. Serialize calls in this host
// so one application's callback cannot observe another application's command.
let routeGenerationQueue: Promise<void> = Promise.resolve();
const routeGeneratorCli = createCli<UltramodernConfigLoader>();

/** Await the selected renderer's existing discovery and emission lifecycle. */
export function generateRouteArtifacts(
  options: GenerateRouteArtifactsOptions,
): Promise<void> {
  const task = routeGenerationQueue.then(async () => {
    const previousArgv = process.env.MODERN_ARGV;
    let dispose: (() => Promise<unknown>) | undefined;
    let getEntrypoints:
      | (() => UltramodernConfigLoader['extendContext']['entrypoints'])
      | undefined;
    let generationFailed = false;
    let generationError: unknown;
    let disposalFailed = false;
    let disposalError: unknown;

    process.env.MODERN_ARGV = 'node ultramodern routes-generate';
    try {
      const appDirectory = path.resolve(options.appDirectory);
      loadEnv({
        cwd: appDirectory,
        mode: process.env.MODERN_ENV || process.env.NODE_ENV,
        prefixes: ['MODERN_'],
      });
      const loaded = await loadUltramodernConfigFile({
        appDirectory,
        configFile: options.configPath,
        command: 'routes-generate',
        env: getNodeEnv(),
      });
      const runOptions = await createLauncherOptions({
        cwd: appDirectory,
        version: options.version ?? process.env.MODERN_JS_VERSION ?? '0.0.0',
      });
      const lifecycle: CliPlugin<UltramodernConfigLoader> = {
        name: '@modern-js/ultramodern-route-generation-lifecycle',
        setup(api) {
          api.updateAppContext({ configFile: loaded.configFile });
          dispose = () => api.getHooks().onBeforeExit.call();
          getEntrypoints = () => api.getAppContext().entrypoints;
        },
      };
      const { appContext } = await routeGeneratorCli.init({
        ...runOptions,
        configFile: false,
        config: loaded.config,
        command: 'routes-generate',
        internalPlugins: [lifecycle, ...runOptions.internalPlugins],
      });
      const entrypoints = getEntrypoints?.();
      if (!entrypoints?.length) {
        throw new Error('Route generation requires an application entry');
      }
      await appContext.hooks.generateEntryCode.call({
        entrypoints: [...entrypoints],
      });
    } catch (error) {
      generationFailed = true;
      generationError = error;
    } finally {
      try {
        await dispose?.();
      } catch (error) {
        disposalFailed = true;
        disposalError = error;
      } finally {
        try {
          routeGeneratorCli.dispose();
        } finally {
          if (previousArgv === undefined) delete process.env.MODERN_ARGV;
          else process.env.MODERN_ARGV = previousArgv;
        }
      }
    }
    if (generationFailed && disposalFailed) {
      throw new AggregateError(
        [generationError, disposalError],
        'Route generation failed and disposal also failed',
        { cause: generationError },
      );
    }
    if (generationFailed) throw generationError;
    if (disposalFailed) throw disposalError;
  });
  routeGenerationQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
