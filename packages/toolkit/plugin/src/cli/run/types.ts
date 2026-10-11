import type { CLIPlugin, CLIPluginExtends } from '../../types/cli';
export interface CLIOptions<
  Extends extends CLIPluginExtends = CLIPluginExtends,
> {
  cwd?: string;
  version?: string;
  metaName?: string;
  /**
   * The initial log message when CLI started
   */
  initialLog?: string;
  /**
   * other config, overrides config file content
   */
  config?: Extends['config'];
  configFile: string | false;
  internalPlugins?: CLIPlugin<Extends>[];
  handleSetupResult?: (
    params: any,
    api: Record<string, any>,
  ) => Promise<void> | void;
}

export type LoadedConfig<T> = {
  packageName: string;
  configFile: string | false;
  config: T;
  pkgConfig?: T;
  jsConfig?: T;
};

export interface CLIRunOptions<
  Extends extends CLIPluginExtends = CLIPluginExtends,
> extends CLIOptions<Extends> {
  command: string;
}
