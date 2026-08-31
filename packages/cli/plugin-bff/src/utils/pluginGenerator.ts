// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off
import { fs, logger, normalizeToPosixPath } from '@modern-js/utils';
import path from 'path';
import {
  API_DIR,
  DIST_DIR,
  EFFECT_ENTRY,
  LAMBDA_DIR,
  OPERATION_CONTRACTS_JSON,
  PACKAGE_NAME,
  PREFIX,
  REQUEST_ID,
  RUNTIME_FRAMEWORK,
} from './crossProjectApiPlugin';

function replaceContent(
  source: string,
  packageName: string,
  requestId: string,
  prefix: string,
  relativeDistPath: string,
  relativeApiPath: string,
  relativeLambdaPath: string,
  runtimeFramework: 'hono' | 'effect',
  relativeEffectEntry: string,
  operationContracts: Record<string, unknown>,
) {
  const updatedSource = source
    .replace(new RegExp(PACKAGE_NAME, 'g'), packageName)
    .replace(new RegExp(REQUEST_ID, 'g'), requestId)
    .replace(new RegExp(PREFIX, 'g'), prefix)
    .replace(new RegExp(DIST_DIR, 'g'), normalizeToPosixPath(relativeDistPath))
    .replace(new RegExp(API_DIR, 'g'), normalizeToPosixPath(relativeApiPath))
    .replace(
      new RegExp(LAMBDA_DIR, 'g'),
      normalizeToPosixPath(relativeLambdaPath),
    )
    .replace(new RegExp(RUNTIME_FRAMEWORK, 'g'), runtimeFramework)
    .replace(
      new RegExp(EFFECT_ENTRY, 'g'),
      normalizeToPosixPath(relativeEffectEntry),
    )
    .replace(`'${OPERATION_CONTRACTS_JSON}'`, () =>
      JSON.stringify(JSON.stringify(operationContracts)),
    );
  return updatedSource;
}

async function pluginGenerator({
  prefix,
  appDirectory,
  requestId,
  relativeDistPath,
  relativeApiPath,
  relativeLambdaPath,
  runtimeFramework,
  relativeEffectEntry,
  operationContracts,
}: {
  prefix: string;
  appDirectory: string;
  requestId: string;
  relativeDistPath: string;
  relativeApiPath: string;
  relativeLambdaPath: string;
  runtimeFramework: 'hono' | 'effect';
  relativeEffectEntry: string;
  operationContracts: Record<string, unknown>;
}) {
  try {
    const packageContent = await fs.readFile(
      path.resolve(appDirectory, './package.json'),
      'utf8',
    );
    const packageJson = JSON.parse(packageContent);

    const pluginDir = path.resolve(
      appDirectory,
      `./${relativeDistPath}`,
      'plugin',
    );
    const pluginPath = path.join(pluginDir, 'index.js');

    const pluginTemplate = await fs.readFile(
      path.resolve(__dirname, 'crossProjectApiPlugin.js'),
      'utf8',
    );
    const updatedPlugin = replaceContent(
      pluginTemplate,
      packageJson.name,
      requestId,
      prefix,
      relativeDistPath,
      relativeApiPath,
      relativeLambdaPath,
      runtimeFramework,
      relativeEffectEntry,
      operationContracts,
    );

    await fs.ensureFile(pluginPath);
    await fs.writeFile(pluginPath, updatedPlugin);

    const typeContent = `import type { AppTools, CliPlugin } from '@modern-js/app-tools';
      export declare const crossProjectApiPlugin: () => CliPlugin<AppTools>`;

    const pluginTypePath = path.join(pluginDir, 'index.d.ts');
    await fs.ensureFile(pluginTypePath);
    await fs.writeFile(pluginTypePath, typeContent);

    logger.info('Api plugin generate succeed');
  } catch (error) {
    logger.error('Api plugin generate failed:', error);
  }
}

export default pluginGenerator;
