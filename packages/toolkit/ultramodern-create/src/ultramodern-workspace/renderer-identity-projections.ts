import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  assertConfigSourceSnapshotUnchanged,
  type ConfigSourceSnapshot,
  captureConfigSourceSnapshot,
} from '@modern-js/ultramodern-app-tools/config-evaluator';
import { writeFile, writeFileReplacing } from './fs-io';

/** Existing authored inputs retain the once-only preflight evaluation. */
export function captureExistingWorkspaceOverlayGuard(
  workspaceRoot: string,
  createdAppDirectory: string,
): () => void {
  if (
    !createdAppDirectory ||
    path.isAbsolute(createdAppDirectory) ||
    createdAppDirectory.split(/[\\/]+/u).includes('..')
  ) {
    throw new Error(`Unsafe new application directory: ${createdAppDirectory}`);
  }
  const createdAppRoot = path.resolve(workspaceRoot, createdAppDirectory);
  if (createdAppRoot === path.resolve(workspaceRoot)) {
    throw new Error(
      'A new application cannot own the entire workspace source.',
    );
  }
  const snapshot = captureConfigSourceSnapshot({
    sourceRoots: [workspaceRoot],
  });
  const outsideCreatedApp = (input: string) => {
    const relative = path.relative(createdAppRoot, input);
    return (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    );
  };
  const original = new Map(
    snapshot.states
      .filter(state => outsideCreatedApp(state.path))
      .map(state => [state.path, state]),
  );
  return () => {
    const updated = captureConfigSourceSnapshot({
      sourceRoots: snapshot.sourceRoots,
      extraInputs: snapshot.extraInputs,
    });
    const retained = updated.states.filter(state =>
      outsideCreatedApp(state.path),
    );
    const changed = retained.find(
      state => !isDeepStrictEqual(original.get(state.path), state),
    );
    if (
      changed ||
      retained.length !== original.size ||
      !isDeepStrictEqual(snapshot.coverage, updated.coverage)
    ) {
      throw new Error(
        `CodeSmith overlay changed existing authored source${changed ? `: ${path.relative(workspaceRoot, changed.path)}` : ''}. Edit original source before add so its config is evaluated once before staging.`,
      );
    }
  };
}

/** Replace validated identity projections without accepting other source edits. */
export function replaceRendererIdentityProjections(
  workspaceRoot: string,
  sourceSnapshot: ConfigSourceSnapshot,
  projections: ReadonlyMap<string, string>,
  deferredUiArtifactPaths: ReadonlySet<string> = new Set(),
): ConfigSourceSnapshot {
  assertConfigSourceSnapshotUnchanged(sourceSnapshot);
  const expected = new Map<string, string>();
  const created = new Set<string>();
  const originalStates = new Map(
    sourceSnapshot.states.map(state => [state.path, state]),
  );
  for (const [relativePath, content] of projections) {
    if (
      !relativePath ||
      path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]+/u).includes('..')
    ) {
      throw new Error(`Unsafe renderer identity projection: ${relativePath}`);
    }
    if (
      relativePath !== 'topology/reference-topology.json' &&
      relativePath !== 'topology/local-overlays/development.json' &&
      !relativePath.endsWith('/shared/ultramodern-build.json')
    ) {
      throw new Error(
        `Unsupported renderer identity projection: ${relativePath}`,
      );
    }
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    if (expected.has(absolutePath)) {
      throw new Error(
        `Duplicate renderer identity projection: ${relativePath}`,
      );
    }
    if (deferredUiArtifactPaths.has(relativePath)) {
      if (
        !relativePath.endsWith('/shared/ultramodern-build.json') ||
        originalStates.has(absolutePath) ||
        originalStates.get(path.dirname(absolutePath))?.kind !== 'directory'
      ) {
        throw new Error(
          `Deferred UI artifact requires an absent file in a captured directory: ${relativePath}`,
        );
      }
      created.add(absolutePath);
    } else if (originalStates.get(absolutePath)?.kind !== 'file') {
      throw new Error(
        `Renderer identity projection must be a captured regular file: ${relativePath}`,
      );
    }
    expected.set(
      absolutePath,
      createHash('sha256').update(content).digest('hex'),
    );
  }

  for (const relativePath of deferredUiArtifactPaths) {
    if (!projections.has(relativePath)) {
      throw new Error(
        `Deferred UI artifact has no resolved projection: ${relativePath}`,
      );
    }
  }
  for (const [relativePath, content] of projections) {
    const write = deferredUiArtifactPaths.has(relativePath)
      ? writeFile
      : writeFileReplacing;
    write(workspaceRoot, relativePath, content);
  }
  const updated = captureConfigSourceSnapshot({
    sourceRoots: sourceSnapshot.sourceRoots,
    extraInputs: sourceSnapshot.extraInputs,
  });
  for (const key of [
    'kind',
    'version',
    'sourceRoots',
    'extraInputs',
    'exclusions',
    'coverage',
  ] as const) {
    if (!isDeepStrictEqual(sourceSnapshot[key], updated[key])) {
      throw new Error(
        'Config source coverage changed during identity projection.',
      );
    }
  }
  if (sourceSnapshot.states.length + created.size !== updated.states.length) {
    throw new Error('Config source paths changed during identity projection.');
  }
  for (const state of updated.states) {
    const original = originalStates.get(state.path);
    const expectedHash = expected.get(state.path);
    if (expectedHash) {
      if (
        created.has(state.path) &&
        state.kind === 'file' &&
        state.sha256 === expectedHash
      ) {
        continue;
      }
      const {
        sha256: _oldHash,
        ctimeNs: _oldTime,
        ...oldMetadata
      } = original ?? {};
      const { sha256, ctimeNs: _newTime, ...newMetadata } = state;
      if (
        state.kind === 'file' &&
        sha256 === expectedHash &&
        isDeepStrictEqual(oldMetadata, newMetadata)
      ) {
        continue;
      }
    } else if (isDeepStrictEqual(original, state)) {
      continue;
    }
    throw new Error(
      `Config source changed during renderer identity projection: ${state.path}`,
    );
  }
  return updated;
}
