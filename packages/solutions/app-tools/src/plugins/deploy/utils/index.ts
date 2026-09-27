import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ServerRoute } from '@modern-js/types';
import {
  fs as fse,
  getMeta,
  ROUTE_SPEC_FILE,
  SERVER_DIR,
} from '@modern-js/utils';
import { moduleResolve } from 'import-meta-resolve';
import path from 'path';

export type ServerAppContext = {
  sharedDirectory: string;
  apiDirectory: string;
  lambdaDirectory: string;
  metaName: string;
  bffRuntimeFramework: string;
};

export const normalizePath = (filePath: string) => filePath.replace(/\\/g, '/');

export const getProjectUsage = (
  appDirectory: string,
  distDirectory: string,
  metaName: string,
) => {
  const routeJSON = path.join(distDirectory, ROUTE_SPEC_FILE);
  const { routes } = fse.readJSONSync(routeJSON);

  let useSSR = false;
  let useAPI = false;
  routes.forEach((route: ServerRoute) => {
    if (route.isSSR) {
      useSSR = true;
    }

    if (route.isApi) {
      useAPI = true;
    }
  });

  const meta = getMeta(metaName);
  const serverConfigPath = path.resolve(
    appDirectory,
    SERVER_DIR,
    `${meta}.server`,
  );
  const isServerConfigExists = ['.ts', '.js'].some(ex => {
    return fse.existsSync(`${serverConfigPath}${ex}`);
  });

  return { useSSR, useAPI, useWebServer: isServerConfigExists };
};

export const getTemplatePath = (file: string) =>
  path.join(__dirname, '../platforms/templates', file);
export const readTemplate = async (file: string) =>
  (await fse.readFile(getTemplatePath(file))).toString();

const DEPLOY_CONDITIONS = ['node', 'import', 'module', 'default'];

export const resolveESMDependency = async (
  entry: string,
  fromDirectory?: string,
) => {
  const base = fromDirectory
    ? pathToFileURL(path.join(fromDirectory, 'package.json'))
    : pathToFileURL(`${__dirname}/`);
  try {
    return normalizePath(
      fileURLToPath(
        moduleResolve(entry, base, new Set(DEPLOY_CONDITIONS), false),
      ),
    );
  } catch (cause) {
    throw new Error(
      `Cannot resolve "${entry}" with conditions [${DEPLOY_CONDITIONS.join(', ')}] from ${base.href}: ${(cause as Error).message}`,
      { cause },
    );
  }
};
