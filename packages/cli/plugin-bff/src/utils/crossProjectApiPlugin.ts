import path from 'path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools';

export const PACKAGE_NAME = '{packageName}';
export const PREFIX = '{prefix}';
export const API_DIR = '{apiDirectory}';
export const LAMBDA_DIR = '{lambdaDirectory}';
export const DIST_DIR = '{distDirectory}';
export const RUNTIME_FRAMEWORK: string = '{runtimeFramework}';

const NODE_MODULES = 'node_modules';

export const crossProjectApiPlugin = (): CliPlugin<AppTools> => ({
  name: '@modern-js/plugin-independent-bff',
  post: ['@modern-js/plugin-bff'],
  setup: api => {
    api.modifyResolvedConfig(resolvedConfig => {
      const { appDirectory: originAppDirectory } = api.getAppContext();

      const sdkPath = path.join(originAppDirectory, NODE_MODULES, PACKAGE_NAME);

      const sdkDistPath = path.join(sdkPath, DIST_DIR);
      const apiDirectory = path.join(sdkDistPath, API_DIR);
      const lambdaDirectory = path.resolve(sdkDistPath, LAMBDA_DIR);

      api.updateAppContext({
        apiDirectory,
        lambdaDirectory,
        bffRuntimeFramework: RUNTIME_FRAMEWORK as 'hono' | 'effect',
      });
      const config = api.getConfig();
      const configuredPrefix = config?.bff?.prefix;
      if (configuredPrefix) {
        const isSamePrefix = Array.isArray(configuredPrefix)
          ? configuredPrefix.length === 1 && configuredPrefix[0] === PREFIX
          : configuredPrefix === PREFIX;
        if (!isSamePrefix) {
          throw new Error(
            `[${PACKAGE_NAME}] Invalid bff.prefix for cross-project BFF. Detected "${configuredPrefix}", expected "${PREFIX}". Remove bff.prefix from the consumer app, or set it exactly to "${PREFIX}".`,
          );
        }
      }

      const configuredRuntimeFramework = config?.bff?.runtimeFramework;
      if (
        configuredRuntimeFramework &&
        configuredRuntimeFramework !== RUNTIME_FRAMEWORK
      ) {
        throw new Error(
          `[${PACKAGE_NAME}] Runtime framework mismatch for cross-project BFF. Detected "${configuredRuntimeFramework}", but producer SDK requires "${RUNTIME_FRAMEWORK}".`,
        );
      }
      resolvedConfig.bff.prefix = PREFIX;
      resolvedConfig.bff.runtimeFramework = RUNTIME_FRAMEWORK as
        | 'hono'
        | 'effect';
      resolvedConfig.bff.isCrossProjectServer = true;
      return resolvedConfig;
    });
  },
});

export default crossProjectApiPlugin;
