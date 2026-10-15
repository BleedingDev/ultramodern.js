import type { SerializedServerGlobalVars } from '@modern-js/plugin-bff-extensions/server-global-vars';
import { fs, upath as path } from '@modern-js/utils';

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

export const transformServerGlobalVars = (
  outputDirectories: string[],
  globalVars: SerializedServerGlobalVars,
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
          ? // String statements, so a following "use strict" stays in the prologue.
            `${RELEASE_IDENTITY_GLOBAL_NAMES.map(name => `${globalVars[name]};`).join('')}\n`
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

                    return inputSourceMapPromise.then(async inputSourceMap => {
                      const { transform } = await import('@swc/core');
                      return transform(`${releaseIdentityBanner}${source}`, {
                        filename,
                        inputSourceMap,
                        sourceMaps: sourceMapExists,
                        jsc: {
                          parser: {
                            syntax: 'ecmascript',
                          },
                          preserveAllComments: true,
                          target: 'es2024',
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
                      );
                    });
                  });
              }),
            ),
          ),
        );
      })
      .then(() => undefined);
  });
