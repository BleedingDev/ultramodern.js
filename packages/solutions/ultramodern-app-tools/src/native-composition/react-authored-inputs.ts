import path from 'node:path';
import { resolvePublicDirPaths } from '@modern-js/server-core';
import { resolveConfigSourcePhysicalPath } from './config-evaluator/source-snapshot';
import type { NativeInfrastructureOptions } from './native-infrastructure';

type BuildContext = Parameters<
  NonNullable<NativeInfrastructureOptions['resolveBuildIdentities']>
>[0];

/** Actual configuration reads whose original capture proves a regular file. */
export function reactObservedInputFiles(
  context: BuildContext,
): readonly string[] {
  const capturedFiles = new Set(
    context.configurationSourceSnapshot?.states
      .filter(state => state.kind === 'file')
      .flatMap(state => [state.path, state.resolvedPath ?? state.path]),
  );
  return [
    ...new Set(
      [
        ...(context.consumedSourceInputs?.observations ?? []),
        ...(context.consumedSourceInputs?.packageMetadata ?? []),
      ]
        .flatMap(input => [input.path, input.canonicalPath])
        .filter(filename => capturedFiles.has(filename)),
    ),
  ];
}

/** Source namespaces explicitly declared by the selected application's entry owner. */
export function reactAuthoredSourceNamespaces(context: BuildContext): {
  entries: Set<string>;
  directories: Set<string>;
} {
  const entries = new Set(
    context.entrypoints.map(entry =>
      path.resolve(context.appDirectory, entry.entry),
    ),
  );
  const directories = new Set<string>();
  const source = context.config.source;
  if (typeof source.entriesDir === 'string')
    directories.add(path.resolve(context.appDirectory, source.entriesDir));
  for (const entry of context.entrypoints) {
    const directory = entry.absoluteEntryDir
      ? path.resolve(entry.absoluteEntryDir)
      : path.dirname(path.resolve(context.appDirectory, entry.entry));
    if (directory !== path.resolve(context.appDirectory))
      directories.add(directory);
  }
  if (source.alias && typeof source.alias === 'object')
    for (const target of Object.values(source.alias).flatMap(value =>
      Array.isArray(value) ? value : [value],
    ))
      if (
        typeof target === 'string' &&
        (path.isAbsolute(target) || target.startsWith('.'))
      )
        directories.add(path.resolve(context.appDirectory, target));
  const configDirectory = path.resolve(
    context.appDirectory,
    source.configDir || './config',
  );
  directories.add(path.join(configDirectory, 'public'));
  directories.add(path.join(configDirectory, 'upload'));
  for (const directory of resolvePublicDirPaths(
    context.config.server.publicDir,
    context.appDirectory,
  ))
    directories.add(directory);
  return { entries, directories };
}

export function reactInputGitPathspecs(
  root: string,
  inputPaths: readonly string[],
): readonly string[] {
  const pathspecs = [
    ...new Set(
      inputPaths
        .flatMap(filename => [
          filename,
          path.join(
            resolveConfigSourcePhysicalPath(path.dirname(filename)),
            path.basename(filename),
          ),
          resolveConfigSourcePhysicalPath(filename),
        ])
        .map(filename => path.relative(root, filename))
        .filter(
          relative =>
            relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative),
        )
        .map(
          relative => `:(literal)${relative.split(path.sep).join('/') || '.'}`,
        ),
    ),
  ];
  if (!pathspecs.length)
    throw new Error('React authored capture has no valid scoped Git inputs');
  return pathspecs;
}

/** The app plus actual consumed files and explicitly declared shared namespaces. */
export function reactAuthoredInputPaths(
  context: BuildContext,
): readonly string[] {
  const { entries, directories } = reactAuthoredSourceNamespaces(context);
  return Object.freeze(
    [
      ...new Set([
        context.appDirectory,
        ...entries,
        ...directories,
        ...reactObservedInputFiles(context),
        ...(context.inputFiles ?? []).filter(
          filename => !filename.split(path.sep).includes('node_modules'),
        ),
      ]),
    ]
      .map(filename => path.resolve(context.appDirectory, filename))
      .sort(),
  );
}
