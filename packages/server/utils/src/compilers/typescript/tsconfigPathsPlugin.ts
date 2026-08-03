import { findMatchedSourcePath, findSourceEntry } from '@modern-js/utils';
import type { MatchPath } from '@modern-js/utils/tsconfig-paths';
import { createMatchPath } from '@modern-js/utils/tsconfig-paths';
import path from 'path';

const windowsAbsolutePathRE = /^[A-Za-z]:[\\/]/u;

const isAbsolutePath = (input: string) =>
  path.isAbsolute(input) || path.win32.isAbsolute(input);

const pathApiFor = (...inputs: string[]) =>
  inputs.some(input => windowsAbsolutePathRE.test(input)) ? path.win32 : path;

const toImportSpecifier = (sourceFile: string, resolvedPath: string) => {
  const pathApi = pathApiFor(sourceFile, resolvedPath);
  const relativePath = pathApi
    .relative(pathApi.dirname(sourceFile), resolvedPath)
    .split(pathApi.sep)
    .join(path.posix.sep);

  return relativePath[0] === '.' ? relativePath : `./${relativePath}`;
};

const COMPILED_TO_JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const toEsmOutputPath = (resolvedPath: string) => {
  const sourcePath = (findSourceEntry(resolvedPath) || resolvedPath).replace(
    /\\/g,
    '/',
  );
  const ext = path.extname(sourcePath);

  if (!ext) {
    return `${sourcePath}.js`;
  }
  if (!COMPILED_TO_JS_EXTENSIONS.has(ext)) {
    return sourcePath;
  }
  return `${sourcePath.slice(0, -ext.length)}.js`;
};

const resolveRelativeEsmSpecifier = (sourceFile: string, text: string) => {
  if (!text.startsWith('./') && !text.startsWith('../')) {
    return;
  }

  const pathApi = pathApiFor(sourceFile);
  return pathApi.resolve(pathApi.dirname(sourceFile), text);
};

const isRegExpKey = (str: string) => {
  return str.startsWith('^') || str.endsWith('$');
};

const resolveAliasPath = (baseUrl: string, filePath: string) => {
  if (filePath.startsWith('.') || filePath.startsWith('..')) {
    return path.resolve(baseUrl, filePath);
  }
  return filePath;
};

const createAliasMatcher = (baseUrl: string, alias: Record<string, string>) => {
  const aliasPairs = Object.keys(alias).reduce(
    (o, key) => {
      if (isRegExpKey(key)) {
        const regexp = new RegExp(key);
        const aliasPath = resolveAliasPath(baseUrl, alias[key]);
        o.push([regexp, aliasPath]);
      } else {
        const aliasPath = resolveAliasPath(baseUrl, alias[key]);
        o.push([key, aliasPath]);
      }
      return o;
    },
    [] as [string | RegExp, string][],
  );

  const cacheMap = new Map<string, string>();

  return (requestedModule: string) => {
    if (cacheMap.has(requestedModule)) {
      return cacheMap.get(requestedModule);
    }
    for (const [key, value] of aliasPairs) {
      if (key instanceof RegExp) {
        if (key.test(requestedModule)) {
          cacheMap.set(requestedModule, value);
          return value;
        }
      }
      if (requestedModule === key) {
        cacheMap.set(requestedModule, value);
        return value;
      }
    }
  };
};

export const createTsconfigPathsMatcher = (
  baseUrl: string,
  paths: Record<string, string[] | string>,
): MatchPath | undefined => {
  const tsPaths: Record<string, string[]> = {};
  const alias: Record<string, string> = {};

  Object.keys(paths).forEach(key => {
    if (Array.isArray(paths[key])) {
      tsPaths[key] = paths[key] as string[];
    } else {
      alias[key] = paths[key] as string;
    }
  });

  const matchAliasPath = createAliasMatcher(baseUrl, alias);
  const matchTsPath = createMatchPath(baseUrl, tsPaths, ['main']);

  return (requestedModule, readJSONSync, fileExists, extensions) => {
    const result = matchTsPath(
      requestedModule,
      readJSONSync,
      fileExists,
      extensions,
    );
    if (result) {
      return result;
    }
    return matchAliasPath(requestedModule);
  };
};

export function getNotAliasedPath(
  sourceFile: string,
  matcher: MatchPath,
  text: string,
  moduleType?: 'module' | 'commonjs',
) {
  let result = findMatchedSourcePath(matcher, text);

  if (!result && moduleType === 'module') {
    result = resolveRelativeEsmSpecifier(sourceFile, text);
  }

  if (!result) {
    return;
  }

  if (!isAbsolutePath(result)) {
    if (!result.startsWith('.') && !result.startsWith('..')) {
      try {
        const packagePath = require.resolve(result, {
          paths: [process.cwd(), ...module.paths],
        });
        if (packagePath) {
          return result;
        }
      } catch {}
    }
    try {
      const packagePath = require.resolve(text, {
        paths: [process.cwd(), ...module.paths],
      });
      if (packagePath) {
        return text;
      }
    } catch {}
  }

  if (moduleType === 'module') {
    result = toEsmOutputPath(result);
  }

  return toImportSpecifier(sourceFile, result) || './';
}
