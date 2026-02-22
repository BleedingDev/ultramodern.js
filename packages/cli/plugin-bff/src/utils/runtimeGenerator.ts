import path from 'path';
import { fs } from '@modern-js/utils';

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
  const source = `const { configure: _configure } = require(${runtimeImportPath});
    const initProducerClient = (options) => {
      return _configure({
        ...options,
        requestId: ${requestIdValue},
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

  const tsSource = `type IOptions<F = typeof fetch> = {
    request?: F;
    interceptor?: (request: F) => F;
    allowedHeaders?: string[];
    setDomain?: (ops?: {
      target: 'node' | 'browser';
      requestId: string;
    }) => string;
    requestId?: string;
  };
  export declare const initProducerClient: (options: IOptions) => void;
  export declare const configure: typeof initProducerClient;`;
  const pluginTypePath = path.join(pluginDir, 'index.d.ts');
  await fs.ensureFile(pluginTypePath);
  await fs.writeFile(pluginTypePath, tsSource);
}

export default runtimeGenerator;
