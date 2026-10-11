import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type { Command } from '@modern-js/utils';

/** Build help without loading authored configuration or preparing plugins. */
export function createRouteGenerationCommand(program: Command): Command {
  return program
    .command('routes-generate')
    .description('Generate routes and entries for the configured renderer')
    .allowExcessArguments(false)
    .option('-c, --config <file>', 'Use the specified configuration file');
}

/** Reuse the selected renderer's discovery and emission lifecycle without a build. */
export function nativeEntryCommandPlugin(): CliPlugin<AppTools> {
  return {
    name: '@modern-js/renderer-native-entry-command',
    setup(api) {
      api.addCommand(({ program }) => {
        createRouteGenerationCommand(program).action(async () => {
          try {
            const { entrypoints } = api.getAppContext();
            if (!entrypoints.length) {
              throw new Error('Route generation requires an application entry');
            }
            await api.getHooks().generateEntryCode.call({ entrypoints });
          } finally {
            await api.getHooks().onBeforeExit.call();
          }
        });
      });
    },
  };
}
