import { findMatchedSourcePath, findSourceEntry } from '@modern-js/utils';
import type { MatchPath } from '@modern-js/utils/tsconfig-paths';
import { createMatchPath } from '@modern-js/utils/tsconfig-paths';
import * as os from 'os';
import path, { dirname, posix } from 'path';

// Convert a resolved source path into the specifier that native ESM output
// should reference at runtime, which is always the emitted `.js` file.
const toEsmOutputPath = (resolvedPath: string) => {
  const sourcePath = findSourceEntry(resolvedPath) || resolvedPath;
  const ext = path.extname(sourcePath);

  return ext ? `${sourcePath.slice(0, -ext.length)}.js` : `${sourcePath}.js`;
};

const resolveRelativeEsmSpecifier = (sourceFile: string, text: string) => {
  if (!text.startsWith('./') && !text.startsWith('../')) {
    return;
  }

  const importerDir = dirname(sourceFile);
  return path.resolve(importerDir, text);
};

const isRegExpKey = (str: string) => {
  return str.startsWith('^') || str.endsWith('$');
};

const resolveAliasPath = (baseUrl: string, filePath: string) => {
  // exclude absolute path and alias
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
  // Resolve aliases and tsconfig paths using the same `.js` -> `.ts` fallback
  // rules as the runtime loaders.
  let result = findMatchedSourcePath(matcher, text);

  // For native ESM, unresolved relative imports like `../service/user` must be
  // resolved to a source path before we convert them to the emitted `.js` specifier.
  if (!result && moduleType === 'module') {
    // This branch is only for relative specifiers. Bare package imports should
    // stay untouched when they are not matched by alias rules.
    result = resolveRelativeEsmSpecifier(sourceFile, text);
  }

  if (!result) {
    return;
  }

  if (os.platform() === 'win32') {
    result = result.replace(/\\/g, '/');
  }

  if (!path.isAbsolute(result)) {
    // If an alias resolves to another bare specifier, prefer leaving it as a
    // package import when Node can resolve that package.
    if (!result.startsWith('.') && !result.startsWith('..')) {
      try {
        // Installed packages (node modules) should take precedence over root files with the same name.
        // Ref: https://github.com/nestjs/nest-cli/issues/838
        const packagePath = require.resolve(result, {
          paths: [process.cwd(), ...module.paths],
        });
        if (packagePath) {
          return result;
        }
      } catch {}
    }
    try {
      // Likewise, if the original specifier already resolves as a package,
      // keep the original text instead of forcing a relative filesystem path.
      // Installed packages (node modules) should take precedence over root files with the same name.
      // Ref: https://github.com/nestjs/nest-cli/issues/838
      const packagePath = require.resolve(text, {
        paths: [process.cwd(), ...module.paths],
      });
      if (packagePath) {
        return text;
      }
    } catch {}
  }

  if (moduleType === 'module') {
    // Native ESM output must reference the emitted file extension that Node
    // will load at runtime, typically `.js`.
    result = toEsmOutputPath(result);
  }

  // Emit a relative specifier from the current source file to the resolved target.
  const resolvedPath = posix.relative(dirname(sourceFile), result) || './';
  return resolvedPath[0] === '.' ? resolvedPath : `./${resolvedPath}`;
}
