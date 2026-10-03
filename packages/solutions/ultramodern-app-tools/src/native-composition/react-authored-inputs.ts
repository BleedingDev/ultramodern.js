import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { resolvePublicDirPaths } from '@modern-js/server-core';
import {
  type ConfigSourceSnapshot,
  captureConfigSourceSnapshot,
  resolveConfigSourcePhysicalPath,
} from './config-evaluator/source-snapshot';
import type { NativeInfrastructureOptions } from './native-infrastructure';

type BuildContext = Parameters<
  NonNullable<NativeInfrastructureOptions['resolveBuildIdentities']>
>[0];

/** Catalog lookup is authority even when the config itself never read YAML. */
export function reactWorkspaceCatalogInputs(
  appDirectory: string,
  snapshot: ConfigSourceSnapshot | undefined,
): readonly string[] {
  if (!snapshot) {
    for (let directory = path.resolve(appDirectory); ; ) {
      if (fs.existsSync(path.join(directory, 'pnpm-workspace.yaml')))
        throw new Error(
          'React workspace catalog requires the original configuration source snapshot',
        );
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    return [];
  }
  const original = new Map(snapshot.states.map(state => [state.path, state]));
  const app = path.resolve(appDirectory);
  const capturedPhysicalPath = (filename: string): string => {
    const direct = original.get(filename)?.resolvedPath;
    if (direct) return direct;
    const ancestor = snapshot.states
      .filter(
        state =>
          state.kind === 'symlink' &&
          state.resolvedPath &&
          filename.startsWith(`${state.path}${path.sep}`),
      )
      .sort((a, b) => b.path.length - a.path.length)[0];
    return ancestor?.resolvedPath
      ? path.join(ancestor.resolvedPath, path.relative(ancestor.path, filename))
      : filename;
  };
  const originalState = (filename: string) =>
    original.get(filename) ?? original.get(capturedPhysicalPath(filename));
  const candidates = new Set<string>();
  if (!originalState(app))
    throw new Error(
      `React workspace catalog has no original app capture: ${app}`,
    );
  for (const start of new Set([app, capturedPhysicalPath(app)])) {
    let directory = start;
    for (;;) {
      const parentState = originalState(directory);
      if (!parentState || !['directory', 'symlink'].includes(parentState.kind))
        break;
      const file = path.join(directory, 'pnpm-workspace.yaml');
      candidates.add(file);
      const state = originalState(file);
      if (state && state.kind !== 'missing') {
        if (state.kind !== 'file' && state.kind !== 'symlink')
          throw new Error(
            `Invalid captured React workspace declaration: ${file}`,
          );
        break;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  const paths = [...candidates].sort();
  // Do not bless an existing declaration outside the original captured ancestry.
  for (let directory = app; ; ) {
    const file = path.join(directory, 'pnpm-workspace.yaml');
    if (fs.existsSync(file)) {
      if (!candidates.has(file))
        throw new Error(`React workspace catalog was not captured: ${file}`);
      break;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const current = captureConfigSourceSnapshot({
    sourceRoots: [],
    extraInputs: paths,
  });
  for (const state of current.states) {
    const captured = originalState(state.path);
    const previous = captured ? { ...captured, path: state.path } : undefined;
    const parent = originalState(path.dirname(state.path));
    const absent =
      !previous &&
      candidates.has(state.path) &&
      parent &&
      (parent.kind === 'directory' || parent.kind === 'symlink')
        ? {
            path: state.path,
            kind: 'missing',
            resolvedPath: path.join(
              parent.resolvedPath ?? parent.path,
              path.basename(state.path),
            ),
          }
        : undefined;
    if (!isDeepStrictEqual(state, previous ?? absent))
      throw new Error(`React workspace catalog inputs changed: ${state.path}`);
  }
  return paths;
}

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
        ...reactWorkspaceCatalogInputs(
          context.appDirectory,
          context.configurationSourceSnapshot,
        ),
        ...(context.inputFiles ?? []).filter(
          filename => !filename.split(path.sep).includes('node_modules'),
        ),
      ]),
    ]
      .map(filename => path.resolve(context.appDirectory, filename))
      .sort(),
  );
}
