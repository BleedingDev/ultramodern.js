import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { ServerRoute } from '@modern-js/types';
import {
  dynamicImport,
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

export const resolveESMDependency = async (entry: string) => {
  const conditions = new Set(['node', 'import', 'module', 'default']);

  try {
    // `dynamicImport` keeps the import() expression intact in the CJS dist,
    // which is required because import-meta-resolve is ESM-only. But the
    // wrapper is a `new Function(...)` import with no module referrer, so a
    // bare specifier would resolve from process.cwd() — the user's app dir at
    // deploy time, where import-meta-resolve is not installed under pnpm's
    // strict layout. Resolve it from this package first so the import is
    // cwd-independent.
    const resolverPath = pathToFileURL(
      createRequire(__filename).resolve('import-meta-resolve'),
    ).href;
    const { moduleResolve } = (await dynamicImport(resolverPath)) as {
      moduleResolve: (
        specifier: string,
        base: URL,
        conditions?: Set<string>,
        preserveSymlinks?: boolean,
      ) => URL;
    };
    return normalizePath(
      moduleResolve(
        entry,
        pathToFileURL(`${__dirname}/`),
        conditions,
        false,
      ).pathname.replace(/^\/(\w):/, '$1:'),
    );
  } catch (err) {
    // ignore
  }
};
