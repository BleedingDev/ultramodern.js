import { initAppDir } from '@modern-js/plugin/cli';
import { run as CLIPluginRun } from '@modern-js/plugin/run';
import type { InternalPlugins } from '@modern-js/types';
import { chalk, minimist } from '@modern-js/utils';
import { handleSetupResult } from '../compat/hooks';
import { getConfigFile } from '../utils/getConfigFile';
import { loadInternalPlugins } from '../utils/loadPlugins';

export interface RunOptions {
  cwd?: string;
  configFile?: string;
  metaName?: string;
  statePluginName?: string;
  internalPlugins?: InternalPlugins;
  initialLog?: string;
  version: string;
}
export async function createRunOptions({
  cwd,
  initialLog,
  metaName = 'modern-js',
  version,
  internalPlugins,
  configFile,
}: RunOptions) {
  const nodeVersion = process.versions.node;
  const versionArr = nodeVersion.split('.').map(Number);

  if (versionArr[0] < 26 || (versionArr[0] === 26 && versionArr[1] < 7)) {
    throw new Error(`
  ${chalk.bgRed.white.bold(' UNSUPPORTED NODE.JS RUNTIME ')}

  ${chalk.red.bold(`UltraModern.js requires Node.js >=26.7.0; detected v${nodeVersion}.`)}
  ${chalk.red('- Legacy Node runtimes and TypeScript transpiler fallbacks are unsupported.')}

  ${chalk.yellow('▸ Detected Runtime:')}  ${chalk.yellow.bold(`Node.js v${nodeVersion}`)}
  ${chalk.green('▸ Required Minimum:')} ${chalk.green.bold('Node.js v26.7.0 or higher')}
  ${chalk.green('▸ Pinned Runtime:')} ${chalk.green.bold('Node.js v26.7.0')}

  ${chalk.cyan('Immediate Action Required:')}
    ${chalk.gray('├──')} ${chalk.yellow('Recommended Upgrade')}
       ${chalk.bold('mise install && mise exec -- node --version')}
    ${chalk.gray('├──')} ${chalk.yellow('Manual Installation')}
       ${chalk.underline('https://nodejs.org/download/release/v26.7.0/')}
     ${chalk.gray('└──')} ${chalk.yellow('Environment Verification')}
       ${chalk.bold('node -v && npm -v')}

  ${chalk.hex('#AAAAAA').italic('[Runtime Policy] Upgrade Node; UltraModern.js intentionally carries no legacy transpiler fallback.')}
      `);
  }
  const command = process.argv[2];

  const cliParams = minimist<{
    c?: string;
    config?: string;
  }>(process.argv.slice(2));
  /**
   * Commands that support specify config files
   * `new` command need to use `--config-file` params,because `--config` is already used
   */
  const SUPPORT_CONFIG_PARAM_COMMANDS = [
    'dev',
    'build',
    'deploy',
    'start',
    'serve',
    'inspect',
    'info',
    'upgrade',
  ];

  let customConfigFile;

  if (SUPPORT_CONFIG_PARAM_COMMANDS.includes(command)) {
    customConfigFile = cliParams.config || cliParams.c;
  }

  if (command === 'new') {
    customConfigFile = cliParams['config-file'];
  }

  const appDirectory = await initAppDir(cwd);
  const finalConfigFile = customConfigFile || getConfigFile(configFile);

  const plugins = await loadInternalPlugins(appDirectory, internalPlugins);

  return {
    cwd,
    initialLog: initialLog || `Modern.js Framework v${version}`,
    configFile: finalConfigFile,
    metaName,
    internalPlugins: plugins,
    handleSetupResult,
  };
}

export async function run(options: RunOptions) {
  const runOptions = await createRunOptions(options);
  await CLIPluginRun(runOptions);
}
