// @effect-diagnostics nodeBuiltinImport:off strictBooleanExpressions:off
import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import path from 'path';

export const PACKAGE_NAME = '{packageName}';
export const PREFIX = '{prefix}';
export const API_DIR = '{apiDirectory}';
export const LAMBDA_DIR = '{lambdaDirectory}';
export const DIST_DIR = '{distDirectory}';
export const RUNTIME_FRAMEWORK: string = '{runtimeFramework}';
export const EFFECT_ENTRY = '{effectEntry}';
export const OPERATION_CONTRACTS_JSON = '{operationContracts}';

const NODE_MODULES = 'node_modules';

export const crossProjectApiPlugin = (): CliPlugin<AppTools> => ({
  name: '@modern-js/plugin-independent-bff',
  post: ['@modern-js/plugin-bff'],
  setup: api => {
    api.modifyResolvedConfig(resolvedConfig => {
      const { appDirectory: originAppDirectory } = api.getAppContext();

      const sdkPath = path.join(originAppDirectory, NODE_MODULES, PACKAGE_NAME);

      const sdkDistPath = path.join(sdkPath, DIST_DIR);
      const effectEntry = EFFECT_ENTRY
        ? path.join(sdkDistPath, EFFECT_ENTRY)
        : undefined;
      const apiDirectory = effectEntry
        ? path.dirname(effectEntry)
        : path.join(sdkDistPath, API_DIR);
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
      resolvedConfig.bff ??= {};
      resolvedConfig.bff.prefix = PREFIX;
      resolvedConfig.bff.runtimeFramework = RUNTIME_FRAMEWORK as
        | 'hono'
        | 'effect';
      if (EFFECT_ENTRY) {
        resolvedConfig.bff.effect = {
          ...resolvedConfig.bff.effect,
          entry: effectEntry,
        };
      }
      resolvedConfig.bff.isCrossProjectServer = true;
      resolvedConfig.bff.requestId =
        resolvedConfig.bff.requestId ||
        config?.bff?.requestId ||
        PACKAGE_NAME ||
        'default';
      const generatedOperationContracts =
        OPERATION_CONTRACTS_JSON === `{${'operationContracts'}}`
          ? {}
          : (JSON.parse(OPERATION_CONTRACTS_JSON) as Record<
              string,
              {
                schemaHash?: string;
                operationVersion?: number;
              }
            >);
      resolvedConfig.bff.crossProjectPolicy = {
        ...(resolvedConfig.bff.crossProjectPolicy || {}),
        enabled: resolvedConfig.bff.crossProjectPolicy?.enabled ?? true,
        requireEnvelope:
          resolvedConfig.bff.crossProjectPolicy?.requireEnvelope ?? true,
        requireOperationContext:
          resolvedConfig.bff.crossProjectPolicy?.requireOperationContext ??
          true,
        requireOperationContextDetails:
          resolvedConfig.bff.crossProjectPolicy
            ?.requireOperationContextDetails ?? true,
        requireOperationSchemaHash:
          resolvedConfig.bff.crossProjectPolicy?.requireOperationSchemaHash ??
          true,
        requireOperationVersion:
          resolvedConfig.bff.crossProjectPolicy?.requireOperationVersion ??
          true,
        allowUnknownOperations:
          resolvedConfig.bff.crossProjectPolicy?.allowUnknownOperations ??
          false,
        expectedOperationContracts: {
          ...(resolvedConfig.bff.crossProjectPolicy
            ?.expectedOperationContracts || {}),
          ...generatedOperationContracts,
        },
      };
      return resolvedConfig;
    });
  },
});

export default crossProjectApiPlugin;
