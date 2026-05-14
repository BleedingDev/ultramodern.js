import type { AppTools, CliPlugin } from '@modern-js/app-tools';

export {
  generateTanstackRouterTypesSourceForEntry,
  isTanstackRouterFrameworkEnabled,
} from './tanstackTypes';

export type TanstackRouterPluginOptions = {
  routesDir?: string;
  generatedDirName?: string;
};

export function tanstackRouterPlugin(
  _options: TanstackRouterPluginOptions = {},
): CliPlugin<AppTools> {
  throw new Error(
    '@modern-js/plugin-tanstack CLI wiring is not available in this scaffold slice.',
  );
}

export default tanstackRouterPlugin;
