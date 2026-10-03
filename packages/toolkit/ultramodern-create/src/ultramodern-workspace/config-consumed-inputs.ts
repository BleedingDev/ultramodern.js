import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  type ConfigSourceSnapshot,
  type ConfigSourceState,
  captureConfigSourceSnapshot,
  type ObservedConfigSourceInputs,
} from '@modern-js/ultramodern-app-tools/config-evaluator';
import {
  type GeneratedConfigProjection,
  generatedConfigProjectionEvidence,
} from './config-generated-projections';

function inside(root: string, input: string): boolean {
  const relative = path.relative(root, input);
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function rootAliases(root: string): string[] {
  return [...new Set([path.resolve(root), fs.realpathSync.native(root)])];
}

function relativeInput(
  roots: readonly string[],
  input: string,
): string | undefined {
  const root = roots.find(candidate => inside(candidate, input));
  return root === undefined ? undefined : path.relative(root, input);
}

/** Unlike path.relative, retain traversal after an authored symlink ancestor. */
function unresolvedRelativeInput(roots: readonly string[], input: string) {
  for (const root of roots) {
    if (input === root) return '';
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (input.startsWith(prefix)) return input.slice(prefix.length);
  }
  return undefined;
}

/** Relocation changes inode/timestamps; authored bytes, targets and modes retain authority. */
function inputState(
  state: ConfigSourceState | undefined,
  roots: readonly string[],
) {
  if (!state || state.kind === 'missing') return { kind: 'missing' };
  return {
    kind: state.kind,
    mode: state.mode,
    resolvedPath:
      state.resolvedPath === undefined
        ? undefined
        : (relativeInput(roots, state.resolvedPath) ?? state.resolvedPath),
    ...(state.kind === 'file' ? { sha256: state.sha256 } : {}),
    ...(state.kind === 'symlink'
      ? {
          symlinkTarget:
            state.symlinkTarget !== undefined &&
            path.isAbsolute(state.symlinkTarget) &&
            state.resolvedPath !== undefined &&
            relativeInput(roots, state.resolvedPath) !== undefined
              ? {
                  kind: 'internal-absolute',
                  target: relativeInput(
                    roots,
                    state.resolvedPath ?? state.symlinkTarget,
                  ),
                }
              : state.symlinkTarget,
        }
      : {}),
  };
}

function workspaceStates(
  snapshot: ConfigSourceSnapshot,
  roots: readonly string[],
) {
  const states = new Map<string, ConfigSourceState>();
  for (const state of snapshot.states) {
    const relative = relativeInput(roots, state.path);
    if (relative !== undefined) states.set(relative, state);
  }
  return states;
}

/** Resolve through captured links, including links used by another link's target. */
function resolveCapturedInput(
  relative: string,
  states: ReadonlyMap<string, ConfigSourceState>,
  roots: readonly string[],
  exclusions: readonly string[],
  explicitInputs: ReadonlySet<string>,
  reject: () => never,
  absoluteInput?: string,
) {
  const inputs = new Set<string>();
  const excludedAncestors = new Set<string>();
  const capturedExplicitInputs = new Set<string>();
  const resolve = (
    base: string,
    segments: readonly string[],
    activeLinks: ReadonlySet<string>,
    absoluteTarget = false,
  ): string => {
    let current = base;
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (!current) {
          if (!absoluteTarget) reject();
          // The owning snapshot proved this absolute target ends inside the root.
          const outside = resolveAbsolute(
            path.dirname(roots[roots.length - 1]),
            segments.slice(index + 1),
            activeLinks,
          );
          const reentry = relativeInput(roots, outside);
          if (reentry === undefined) reject();
          return reentry;
        }
        const parent = path.dirname(current);
        current = parent === '.' ? '' : parent;
        continue;
      }
      const candidate = path.join(current, segment);
      inputs.add(candidate);
      const state = states.get(candidate);
      if (state && explicitInputs.has(candidate))
        capturedExplicitInputs.add(candidate);
      if (!state && exclusions.includes(segment))
        excludedAncestors.add(candidate);
      if (state?.kind !== 'symlink') {
        current = candidate;
        continue;
      }
      if (activeLinks.has(candidate) || state.symlinkTarget === undefined)
        reject();
      const absolute = path.isAbsolute(state.symlinkTarget);
      if (
        absolute &&
        (state.resolvedPath === undefined ||
          relativeInput(roots, state.resolvedPath) === undefined)
      )
        reject();
      const target = absolute
        ? unresolvedRelativeInput(roots, state.symlinkTarget)
        : state.symlinkTarget;
      const nextLinks = new Set([...activeLinks, candidate]);
      if (absolute && target === undefined) {
        const targetRoot = path.parse(state.symlinkTarget).root;
        const destination = resolveAbsolute(
          targetRoot,
          state.symlinkTarget.slice(targetRoot.length).split(path.sep),
          nextLinks,
        );
        const internal = relativeInput(roots, destination);
        if (internal === undefined) reject();
        current = internal;
      } else {
        if (target === undefined) reject();
        current = resolve(
          absolute ? '' : current,
          target.split(path.sep),
          nextLinks,
          absolute,
        );
      }
      if (
        state.resolvedPath === undefined ||
        relativeInput(roots, state.resolvedPath) !== current
      )
        reject();
    }
    return current;
  };
  function resolveAbsolute(
    base: string,
    segments: readonly string[],
    activeLinks: ReadonlySet<string>,
  ): string {
    let current = base;
    for (const segment of segments) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        current = path.dirname(current);
        continue;
      }
      const candidate = path.join(current, segment);
      const internal = unresolvedRelativeInput(roots, candidate);
      if (internal !== undefined) {
        current = path.join(
          roots[roots.length - 1],
          resolve('', internal.split(path.sep), activeLinks),
        );
        continue;
      }
      try {
        if (fs.lstatSync(candidate).isSymbolicLink()) {
          if (activeLinks.has(candidate)) reject();
          const target = fs.readlinkSync(candidate);
          const absolute = path.isAbsolute(target);
          const targetRoot = absolute ? path.parse(target).root : current;
          current = resolveAbsolute(
            targetRoot,
            (absolute ? target.slice(targetRoot.length) : target).split(
              path.sep,
            ),
            new Set([...activeLinks, candidate]),
          );
        } else {
          current = fs.realpathSync.native(candidate);
        }
      } catch {
        reject();
      }
    }
    return current;
  }
  let resolved: string;
  if (absoluteInput === undefined) {
    resolved = resolve('', relative.split(path.sep), new Set());
  } else {
    const inputRoot = path.parse(absoluteInput).root;
    const destination = resolveAbsolute(
      inputRoot,
      absoluteInput.slice(inputRoot.length).split(path.sep),
      new Set(),
    );
    const internal = relativeInput(roots, destination);
    if (internal === undefined) reject();
    resolved = internal;
  }
  for (const ancestor of excludedAncestors) {
    if (![...capturedExplicitInputs].some(input => inside(ancestor, input)))
      reject();
  }
  return { relative: resolved, inputs };
}

function explicitCaptureInputs(
  snapshot: ConfigSourceSnapshot,
  roots: readonly string[],
) {
  return new Set([
    ...snapshot.coverage.flatMap(boundary => {
      const relative = relativeInput(roots, boundary.path);
      return boundary.recursive || relative === undefined ? [] : [relative];
    }),
    ...snapshot.extraInputs.flatMap(input => {
      const relative = relativeInput(roots, input);
      return relative === undefined ? [] : [relative];
    }),
  ]);
}

function isCapturedInput(
  snapshot: ConfigSourceSnapshot,
  roots: readonly string[],
  input: string,
) {
  return snapshot.coverage.some(boundary => {
    const relative = relativeInput(roots, boundary.path);
    return (
      relative !== undefined &&
      (boundary.recursive ? inside(relative, input) : relative === input)
    );
  });
}

function assertPackageMetadataEvidence(
  inputs: ObservedConfigSourceInputs,
): void {
  const invalid = (): never => {
    throw new Error('Invalid consumed package-metadata evidence.');
  };
  if (
    !inputs ||
    inputs.kind !== 'observed-config-source-inputs' ||
    inputs.version !== 1 ||
    !Array.isArray(inputs.observations) ||
    !Object.hasOwn(inputs, 'packageMetadata') ||
    !Array.isArray(inputs.packageMetadata) ||
    Object.hasOwn(inputs, 'packageNames')
  )
    invalid();
  if (
    inputs.observations.some(
      observation =>
        observation.operation === 'existence' &&
        path.basename(observation.path) !== 'package.json',
    )
  )
    invalid();
  const lexical = new Map<string, Set<string>>();
  const canonical = new Map<string, Map<string, string>>();
  for (const evidence of inputs.packageMetadata) {
    if (
      !evidence ||
      typeof evidence !== 'object' ||
      Array.isArray(evidence) ||
      Object.keys(evidence).length !== 4 ||
      !['path', 'canonicalPath', 'field', 'value'].every(key =>
        Object.hasOwn(evidence, key),
      ) ||
      typeof evidence.path !== 'string' ||
      !path.isAbsolute(evidence.path) ||
      evidence.path.includes('\0') ||
      typeof evidence.canonicalPath !== 'string' ||
      !path.isAbsolute(evidence.canonicalPath) ||
      path.normalize(evidence.canonicalPath) !== evidence.canonicalPath ||
      evidence.canonicalPath.includes('\0') ||
      (evidence.field !== 'name' && evidence.field !== 'type') ||
      typeof evidence.value !== 'string' ||
      evidence.value.length === 0 ||
      (evidence.field === 'name' && evidence.value.trim().length === 0) ||
      lexical.get(evidence.path)?.has(evidence.field) ||
      (canonical.get(evidence.canonicalPath)?.has(evidence.field) &&
        canonical.get(evidence.canonicalPath)?.get(evidence.field) !==
          evidence.value)
    )
      invalid();
    const lexicalFields = lexical.get(evidence.path) ?? new Set<string>();
    lexicalFields.add(evidence.field);
    lexical.set(evidence.path, lexicalFields);
    const canonicalFields =
      canonical.get(evidence.canonicalPath) ?? new Map<string, string>();
    canonicalFields.set(evidence.field, evidence.value);
    canonical.set(evidence.canonicalPath, canonicalFields);
  }
}

function packageMetadataValue(manifest: unknown, field: 'name' | 'type') {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    return undefined;
  return field === 'name'
    ? 'name' in manifest
      ? manifest.name
      : undefined
    : ('type' in manifest ? manifest.type : undefined) || 'commonjs';
}

/** Check only actual observed inputs; the bounded snapshot is their unchanged baseline. */
export function assertConsumedConfigInputsUnchanged(options: {
  workspaceRoot: string;
  stagedWorkspaceRoot: string;
  captures: readonly {
    sourceSnapshot: ConfigSourceSnapshot;
    consumedSourceInputs: ObservedConfigSourceInputs;
  }[];
  generatedProjections?: readonly GeneratedConfigProjection[];
}): void {
  if (!options.captures.length) return;
  for (const capture of options.captures)
    assertPackageMetadataEvidence(capture.consumedSourceInputs);
  const originalRoots = rootAliases(options.workspaceRoot);
  const stagedRoots = rootAliases(options.stagedWorkspaceRoot);
  const current = captureConfigSourceSnapshot({
    sourceRoots: [options.stagedWorkspaceRoot],
    extraInputs: options.captures.flatMap(capture =>
      capture.sourceSnapshot.extraInputs.flatMap(input => {
        const relative = relativeInput(originalRoots, input);
        return relative === undefined
          ? []
          : [path.join(options.stagedWorkspaceRoot, relative)];
      }),
    ),
  });
  if (
    current.coverage.some(
      boundary => relativeInput(stagedRoots, boundary.path) === undefined,
    )
  ) {
    throw new Error(
      'A staged explicit config input escaped the workspace source coverage.',
    );
  }
  const currentStates = workspaceStates(current, stagedRoots);
  for (const capture of options.captures) {
    const originalStates = workspaceStates(
      capture.sourceSnapshot,
      originalRoots,
    );
    const projections = options.generatedProjections
      ?.map(generatedConfigProjectionEvidence)
      .filter(candidate => {
        if (
          originalStates.get(candidate.configRelativePath)?.sha256 !==
          candidate.originalConfigSha256
        )
          return false;
        let configConsumed = false;
        for (const observation of capture.consumedSourceInputs.observations) {
          const relative = relativeInput(
            originalRoots,
            observation.canonicalPath,
          );
          if (
            relative === candidate.configRelativePath &&
            (observation.operation === 'content' ||
              observation.operation === 'module')
          )
            configConsumed = true;
          if (
            relative === undefined ||
            !['content', 'module'].includes(observation.operation) ||
            !/\.[cm]?[jt]sx?$/u.test(relative)
          )
            continue;
          if (
            candidate.canonicalScriptInputs.get(relative) !==
            originalStates.get(relative)?.sha256
          ) {
            const original = originalStates.get(relative);
            if (
              !candidate.preservedScriptInputs.has(relative) ||
              original?.sha256 !==
                candidate.preservedScriptInputs.get(relative) ||
              !isDeepStrictEqual(
                inputState(original, originalRoots),
                inputState(currentStates.get(relative), stagedRoots),
              )
            )
              return false;
          }
        }
        return configConsumed;
      });
    const isProjectedInput = (relative: string) => {
      const original = originalStates.get(relative);
      const updated = currentStates.get(relative);
      const originalHash = original?.sha256;
      const projectedHash = updated?.sha256;
      return (
        original?.kind === 'file' &&
        updated?.kind === 'file' &&
        projectedHash !== undefined &&
        projections?.some(candidate => {
          const evidence = candidate.artifacts.get(relative);
          return (
            evidence !== undefined &&
            originalHash === evidence.originalSha256 &&
            evidence.projectedSha256.has(projectedHash)
          );
        }) === true
      );
    };
    const reject = (input: string, detail = ''): never => {
      throw new Error(
        `Generated workspace projection changed a source input consumed by modern.config: ${input}.${detail ? ` ${detail}` : ''} Membership-dependent configuration updates are unsupported in this operation; edit original source before add or sync so its callback is evaluated once against authoritative inputs.`,
      );
    };
    for (const evidence of capture.consumedSourceInputs.packageMetadata) {
      const lexicalRelative = unresolvedRelativeInput(
        originalRoots,
        evidence.path,
      );
      const canonicalRelative =
        relativeInput(originalRoots, evidence.canonicalPath) ??
        reject(evidence.path, 'The consumed package manifest path changed.');
      if (
        evidence.canonicalPath !==
        path.join(originalRoots[originalRoots.length - 1], canonicalRelative)
      )
        reject(
          evidence.path,
          'The consumed package manifest coverage changed.',
        );
      const captured = resolveCapturedInput(
        lexicalRelative ?? canonicalRelative,
        originalStates,
        originalRoots,
        capture.sourceSnapshot.exclusions,
        explicitCaptureInputs(capture.sourceSnapshot, originalRoots),
        () =>
          reject(
            evidence.path,
            'The original consumed package manifest could not be resolved.',
          ),
        lexicalRelative === undefined ? evidence.path : undefined,
      );
      if (
        captured.relative !== canonicalRelative ||
        !isCapturedInput(
          capture.sourceSnapshot,
          originalRoots,
          captured.relative,
        )
      )
        reject(
          evidence.path,
          'The consumed package manifest location changed.',
        );
      const staged = resolveCapturedInput(
        lexicalRelative === undefined ? captured.relative : lexicalRelative,
        currentStates,
        stagedRoots,
        current.exclusions,
        explicitCaptureInputs(current, stagedRoots),
        () =>
          reject(
            evidence.path,
            'The staged consumed package manifest could not be resolved.',
          ),
      );
      if (
        captured.relative !== staged.relative ||
        originalStates.get(captured.relative)?.kind !== 'file' ||
        currentStates.get(staged.relative)?.kind !== 'file'
      )
        reject(
          evidence.path,
          'The consumed package manifest file identity changed.',
        );
      for (const input of new Set([...captured.inputs, ...staged.inputs])) {
        const comparable = (
          state: ConfigSourceState | undefined,
          roots: readonly string[],
        ) =>
          inputState(
            input === captured.relative && state?.kind === 'file'
              ? { ...state, sha256: undefined }
              : state,
            roots,
          );
        if (
          !isDeepStrictEqual(
            comparable(originalStates.get(input), originalRoots),
            comparable(currentStates.get(input), stagedRoots),
          )
        )
          reject(
            evidence.path,
            `The consumed package manifest metadata changed at ${input}.`,
          );
      }
      for (const [filename, location] of [
        [evidence.canonicalPath, 'original'],
        [path.join(options.stagedWorkspaceRoot, staged.relative), 'staged'],
      ]) {
        let manifest: unknown;
        try {
          manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
        } catch {
          reject(
            evidence.path,
            `The ${location} consumed package manifest is unreadable or invalid JSON.`,
          );
        }
        if (packageMetadataValue(manifest, evidence.field) !== evidence.value)
          reject(
            evidence.path,
            `The ${location} consumed package ${evidence.field} changed.`,
          );
      }
    }
    for (const observation of capture.consumedSourceInputs.observations) {
      for (const input of new Set([
        observation.path,
        observation.canonicalPath,
      ])) {
        const lexicalRelative = unresolvedRelativeInput(originalRoots, input);
        const relative =
          lexicalRelative ??
          relativeInput(originalRoots, observation.canonicalPath);
        // Inputs outside this workspace retain the owning evaluator's original guard.
        if (relative === undefined) continue;
        const captured = resolveCapturedInput(
          relative,
          originalStates,
          originalRoots,
          capture.sourceSnapshot.exclusions,
          explicitCaptureInputs(capture.sourceSnapshot, originalRoots),
          () => reject(input),
          lexicalRelative === undefined ? input : undefined,
        );
        if (
          !isCapturedInput(
            capture.sourceSnapshot,
            originalRoots,
            captured.relative,
          )
        )
          reject(input);
        const staged = resolveCapturedInput(
          lexicalRelative === undefined ? captured.relative : relative,
          currentStates,
          stagedRoots,
          current.exclusions,
          explicitCaptureInputs(current, stagedRoots),
          () => reject(input),
        );
        if (captured.relative !== staged.relative) reject(input);
        const consumedState = (
          state: ConfigSourceState | undefined,
          roots: readonly string[],
          consumed: string,
        ) =>
          inputState(
            (((observation.operation === 'existence' ||
              observation.operation === 'entry-kind') &&
              consumed === captured.relative) ||
              isProjectedInput(consumed)) &&
              state?.kind === 'file'
              ? { ...state, sha256: undefined }
              : state,
            roots,
          );
        for (const consumed of new Set([
          ...captured.inputs,
          ...staged.inputs,
        ])) {
          if (
            !isDeepStrictEqual(
              consumedState(
                originalStates.get(consumed),
                originalRoots,
                consumed,
              ),
              consumedState(currentStates.get(consumed), stagedRoots, consumed),
            )
          )
            reject(
              input,
              `The consumed ${observation.operation} input changed at ${consumed}.`,
            );
        }
        const original = originalStates.get(captured.relative);
        const lexicalOriginal = originalStates.get(relative);
        const existedOriginally =
          original?.kind !== undefined && original.kind !== 'missing';
        const lexicalExistedOriginally =
          lexicalOriginal?.kind !== undefined &&
          lexicalOriginal.kind !== 'missing';
        if (
          observation.existed &&
          !existedOriginally &&
          !lexicalExistedOriginally
        )
          reject(input);
        const updated = currentStates.get(staged.relative);
        if (
          !isDeepStrictEqual(
            consumedState(original, originalRoots, captured.relative),
            consumedState(updated, stagedRoots, staged.relative),
          )
        )
          reject(input);
        if (
          observation.operation !== 'directory' &&
          !(
            observation.operation === 'metadata' &&
            original?.kind === 'directory'
          )
        )
          continue;
        const descendants = (
          states: ReadonlyMap<string, ConfigSourceState>,
          roots: readonly string[],
          directory: string,
        ) =>
          [...states]
            .filter(
              ([candidate]) =>
                directory === '' ||
                candidate.startsWith(`${directory}${path.sep}`),
            )
            .map(([candidate, state]) => [
              candidate,
              consumedState(state, roots, candidate),
            ])
            .sort(([left], [right]) =>
              String(left).localeCompare(String(right)),
            );
        if (
          !isDeepStrictEqual(
            descendants(originalStates, originalRoots, captured.relative),
            descendants(currentStates, stagedRoots, staged.relative),
          )
        )
          reject(input);
      }
    }
  }
}
