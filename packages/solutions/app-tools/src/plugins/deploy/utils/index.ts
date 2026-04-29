import { createRequire } from 'node:module';
import type { ServerRoute } from '@modern-js/types';
import {
  fs as fse,
  getMeta,
  ROUTE_SPEC_FILE,
  SERVER_DIR,
} from '@modern-js/utils';
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

const localRequire = createRequire(path.join(__dirname, 'package.json'));

const findNearestPackageJson = (resolvedEntry: string) => {
  let currentDir = path.dirname(resolvedEntry);

  while (currentDir !== path.dirname(currentDir)) {
    const manifestPath = path.join(currentDir, 'package.json');
    if (fse.existsSync(manifestPath)) {
      return manifestPath;
    }
    currentDir = path.dirname(currentDir);
  }
};

const splitPackageSpecifier = (entry: string) => {
  const segments = entry.split('/');

  if (entry.startsWith('@')) {
    const [scope, name, ...rest] = segments;
    return {
      packageName: `${scope}/${name}`,
      exportKey: rest.length > 0 ? `./${rest.join('/')}` : '.',
    };
  }

  const [name, ...rest] = segments;
  return {
    packageName: name,
    exportKey: rest.length > 0 ? `./${rest.join('/')}` : '.',
  };
};

export const resolveESMDependency = async (entry: string) => {
  try {
    const { packageName, exportKey } = splitPackageSpecifier(entry);
    const resolvedEntry = localRequire.resolve(entry);
    const packageJsonPath = findNearestPackageJson(
      localRequire.resolve(packageName),
    );

    if (!packageJsonPath) {
      return normalizePath(resolvedEntry);
    }

    const packageDir = path.dirname(packageJsonPath);
    const packageJson = fse.readJSONSync(packageJsonPath) as {
      exports?: Record<string, any>;
    };
    const exportConfig = packageJson.exports?.[exportKey];

    if (typeof exportConfig === 'string') {
      return normalizePath(path.join(packageDir, exportConfig));
    }

    const esmExportPath =
      exportConfig?.node?.import ||
      exportConfig?.import ||
      exportConfig?.default;

    if (typeof esmExportPath === 'string') {
      return normalizePath(path.join(packageDir, esmExportPath));
    }

    return normalizePath(resolvedEntry);
  } catch (err) {
    // ignore
  }
};
