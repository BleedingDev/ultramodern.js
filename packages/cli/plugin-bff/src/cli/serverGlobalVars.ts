import { applyOptionsChain, fs } from '@modern-js/utils';
import { transform } from '@swc/core';
import path from 'path';

type SerializedGlobalVars = Record<string, string>;

const RELEASE_IDENTITY_GLOBAL_NAMES = [
  'ULTRAMODERN_BUILD_MARKER',
  'ULTRAMODERN_SOURCE_REVISION',
  'ULTRAMODERN_RELEASE_VERSION',
] as const;

const collectJavaScriptFiles = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async entry => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectJavaScriptFiles(absolutePath);
      }
      return /\.(?:c|m)?js$/u.test(entry.name) ? [absolutePath] : [];
    }),
  );
  return nested.flat();
};

export const serializeServerGlobalVars = (
  options: unknown,
): SerializedGlobalVars => {
  const globalVars = applyOptionsChain<Record<string, unknown>>({}, options, {
    env: 'server',
    target: 'node',
  });

  return Object.fromEntries(
    Object.entries(globalVars).map(([key, value]) => {
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(value);
      } catch (error) {
        throw new Error(
          `source.globalVars["${key}"] cannot be serialized exactly for BFF compilation.`,
          { cause: error },
        );
      }
      if (serialized === undefined) {
        throw new Error(
          `source.globalVars["${key}"] cannot be serialized exactly for BFF compilation.`,
        );
      }
      return [key, serialized];
    }),
  );
};

export const transformServerGlobalVars = async (
  outputDirectories: string[],
  globalVars: SerializedGlobalVars,
) => {
  if (Object.keys(globalVars).length === 0) {
    return;
  }

  const existingDirectories = (
    await Promise.all(
      outputDirectories.map(async directory =>
        (await fs.pathExists(directory)) ? directory : undefined,
      ),
    )
  ).filter((directory): directory is string => Boolean(directory));
  const files = (
    await Promise.all(existingDirectories.map(collectJavaScriptFiles))
  ).flat();
  const releaseIdentityBanner = RELEASE_IDENTITY_GLOBAL_NAMES.every(name =>
    Object.hasOwn(globalVars, name),
  )
    ? `${RELEASE_IDENTITY_GLOBAL_NAMES.map(name => `void ${globalVars[name]};`).join('')}\n`
    : '';
  await Promise.all(
    files.map(async filename => {
      const source = await fs.readFile(filename, 'utf8');
      const sourceMapFilename = `${filename}.map`;
      const sourceMapExists = await fs.pathExists(sourceMapFilename);
      const inputSourceMap = sourceMapExists
        ? await fs.readFile(sourceMapFilename, 'utf8')
        : undefined;
      const result = await transform(`${releaseIdentityBanner}${source}`, {
        filename,
        inputSourceMap,
        sourceMaps: sourceMapExists,
        jsc: {
          parser: {
            syntax: 'ecmascript',
          },
          preserveAllComments: true,
          target: 'es2022',
          transform: {
            optimizer: {
              globals: {
                vars: globalVars,
              },
            },
          },
        },
      });

      await fs.writeFile(filename, result.code);
      if (sourceMapExists && result.map) {
        await fs.writeFile(sourceMapFilename, result.map);
      }
    }),
  );
};
