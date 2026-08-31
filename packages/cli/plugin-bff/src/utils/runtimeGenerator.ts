// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off processEnv:off
import { renderProducerRuntimeDefaults } from '@modern-js/plugin-bff-extensions/cross-project-generation';
import { fs } from '@modern-js/utils';
import path from 'path';

/**
 * Get package name from package.json file
 * @param appDirectory - Application directory path
 * @returns Package name or undefined if not found
 */
const getPackageName = (appDirectory: string): string | undefined => {
  try {
    const packageJsonPath = path.resolve(appDirectory, './package.json');
    const packageJson = require(packageJsonPath);
    return packageJson.name;
  } catch (error) {
    // If package.json doesn't exist or is invalid, return undefined
    return undefined;
  }
};

async function runtimeGenerator({
  runtime,
  appDirectory,
  relativeDistPath,
  packageName,
}: {
  runtime: string;
  appDirectory: string;
  relativeDistPath: string;
  packageName?: string;
}) {
  const pluginDir = path.resolve(
    appDirectory,
    `./${relativeDistPath}`,
    'runtime',
  );

  const requestId =
    packageName ||
    getPackageName(appDirectory) ||
    process.env.npm_package_name ||
    'default';

  const runtimeImportPath = JSON.stringify(runtime);
  const requestIdValue = JSON.stringify(requestId);
  const source = `'use strict'; const { configure: _configure } = require(${runtimeImportPath});
    const defaultSecureOptions = ${renderProducerRuntimeDefaults(requestIdValue)};
    const initProducerClient = (options) => {
      return _configure({
        ...defaultSecureOptions,
        ...options,
        identityBinding: {
          ...defaultSecureOptions.identityBinding,
          ...(options && options.identityBinding ? options.identityBinding : {}),
        },
        operationContract: {
          ...defaultSecureOptions.operationContract,
          ...(options && options.operationContract ? options.operationContract : {}),
        },
      });
    }
    const configure = initProducerClient;
    Object.defineProperty(exports, '__esModule', { value: true });
    exports.initProducerClient = initProducerClient;
    exports.configure = configure;
  `;
  const pluginPath = path.join(pluginDir, 'index.js');
  await fs.ensureFile(pluginPath);
  await fs.writeFile(pluginPath, source);

  const tsSource = `type ProducerRuntimeModule = typeof import(${runtimeImportPath});
  type ProducerClientOptions = ProducerRuntimeModule extends {
    configure: (options: infer TOptions) => unknown;
  }
    ? TOptions
    : {
        request?: typeof fetch;
        interceptor?: (request: typeof fetch) => typeof fetch;
        allowedHeaders?: string[];
        requireEnvelope?: boolean;
        allowCrossOriginEnvelope?: boolean;
        identityBinding?: {
          enabled?: boolean;
          strict?: boolean;
          protectedHeaders?: string[];
        };
        operationContract?: {
          enabled?: boolean;
          strict?: boolean;
          requireSchemaHash?: boolean;
          requireOperationVersion?: boolean;
        };
        setDomain?: (ops?: {
          target: 'server' | 'browser';
          requestId?: string;
        }) => string;
        requestId?: string;
      };
  export declare const initProducerClient: (options?: ProducerClientOptions) => ReturnType<ProducerRuntimeModule['configure']>;
  export declare const configure: typeof initProducerClient;`;
  const pluginTypePath = path.join(pluginDir, 'index.d.ts');
  await fs.ensureFile(pluginTypePath);
  await fs.writeFile(pluginTypePath, tsSource);
}

export default runtimeGenerator;
