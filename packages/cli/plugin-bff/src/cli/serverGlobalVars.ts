import type { AppTools } from '@modern-js/app-tools';
import type { RsbuildTarget } from '@modern-js/builder';
import { applyOptionsChain, fs, upath as path } from '@modern-js/utils';
import { transform } from '@swc/core';

type SerializedGlobalVars = Record<string, string>;
type ServerGlobalVarsOptions = NonNullable<
  NonNullable<AppTools['config']>['source']
>['globalVars'];

const RELEASE_IDENTITY_GLOBAL_NAMES = [
  'ULTRAMODERN_BUILD_MARKER',
  'ULTRAMODERN_SOURCE_REVISION',
  'ULTRAMODERN_RELEASE_VERSION',
] as const;

const collectJavaScriptFiles = (directory: string): Promise<string[]> =>
  Promise.resolve()
    .then(() => fs.readdir(directory, { withFileTypes: true }))
    .then(entries =>
      Promise.all(
        entries.map(entry => {
          const absolutePath = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            return collectJavaScriptFiles(absolutePath);
          }
          return /\.(?:c|m)?js$/u.test(entry.name) ? [absolutePath] : [];
        }),
      ).then(nested => nested.flat()),
    );

export const serializeServerGlobalVars = (
  options: ServerGlobalVarsOptions,
): SerializedGlobalVars => {
  const globalVars = applyOptionsChain<
    Record<string, unknown>,
    { env: string; target: RsbuildTarget }
  >({}, options, {
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

export const transformServerGlobalVars = (
  outputDirectories: string[],
  globalVars: SerializedGlobalVars,
) =>
  Promise.resolve().then(() => {
    if (Object.keys(globalVars).length === 0) {
      return undefined;
    }

    return Promise.all(
      outputDirectories.map(directory =>
        fs
          .pathExists(directory)
          .then(directoryExists => (directoryExists ? directory : undefined)),
      ),
    )
      .then(existingDirectories => {
        const filesPromise = Promise.all(
          existingDirectories
            .filter((directory): directory is string => directory !== undefined)
            .map(collectJavaScriptFiles),
        ).then(files => files.flat());

        const releaseIdentityBanner = RELEASE_IDENTITY_GLOBAL_NAMES.every(
          name => Object.hasOwn(globalVars, name),
        )
          ? `${RELEASE_IDENTITY_GLOBAL_NAMES.map(name => `void ${globalVars[name]};`).join('')}\n`
          : '';

        return filesPromise.then(files =>
          Promise.all(
            files.map(filename =>
              fs.readFile(filename, 'utf8').then(source => {
                const sourceMapFilename = `${filename}.map`;
                return fs
                  .pathExists(sourceMapFilename)
                  .then(sourceMapExists => {
                    const inputSourceMapPromise: Promise<string | undefined> =
                      sourceMapExists
                        ? fs.readFile(sourceMapFilename, 'utf8')
                        : Promise.resolve(undefined);

                    return inputSourceMapPromise.then(inputSourceMap =>
                      transform(`${releaseIdentityBanner}${source}`, {
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
                      }).then(result =>
                        fs.writeFile(filename, result.code).then(() => {
                          if (
                            sourceMapExists &&
                            result.map !== undefined &&
                            result.map.length > 0
                          ) {
                            return fs.writeFile(sourceMapFilename, result.map);
                          }
                          return undefined;
                        }),
                      ),
                    );
                  });
              }),
            ),
          ),
        );
      })
      .then(() => undefined);
  });
