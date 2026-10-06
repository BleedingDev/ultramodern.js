import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_SOURCE_SNAPSHOT_EXCLUSIONS = Object.freeze([
  '.git',
  '.nx',
  '.output',
  '.tmp',
  'coverage',
  'dist',
  'node_modules',
] as const);

export type ConfigSourceState = {
  path: string;
  kind: 'missing' | 'directory' | 'file' | 'symlink';
  mode?: number;
  sha256?: string;
  symlinkTarget?: string;
  resolvedPath?: string;
  dev?: string;
  ino?: string;
  ctimeNs?: string;
};

type ConfigSourceCoverage = { path: string; recursive: boolean };

export type ConfigSourceSnapshot = {
  kind: 'bounded-config-source-snapshot';
  version: 1;
  sourceRoots: readonly string[];
  extraInputs: readonly string[];
  exclusions: readonly string[];
  coverage: readonly ConfigSourceCoverage[];
  states: readonly ConfigSourceState[];
  digest: string;
};

type CaptureOptions = {
  sourceRoots: readonly string[];
  extraInputs?: readonly string[];
};

const exclusions = new Set<string>(CONFIG_SOURCE_SNAPSHOT_EXCLUSIONS);
const compare = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

function missing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

function absolutePaths(inputs: readonly string[]): string[] {
  return [
    ...new Set(
      inputs.map(input => {
        if (!path.isAbsolute(input)) {
          throw new Error(
            `Config source snapshot requires an absolute path: ${input}`,
          );
        }
        const normalized = path.normalize(input);
        if (normalized !== input) {
          const rawLinks = new Set<string>();
          const normalizedLinks = new Set<string>();
          physicalPath(input, new Set(), link => {
            rawLinks.add(link);
          });
          physicalPath(normalized, new Set(), link => {
            normalizedLinks.add(link);
          });
          if (
            physicalPath(normalized) !== physicalPath(input) ||
            [...rawLinks].some(link => !normalizedLinks.has(link))
          ) {
            throw new Error(
              `Config source snapshot cannot normalize a path across symlink ancestors: ${input}`,
            );
          }
        }
        return normalized;
      }),
    ),
  ].sort(compare);
}

// Resolve existing ancestors too, so a missing input cannot hide an escaping link.
function physicalPath(
  input: string,
  activeLinks = new Set<string>(),
  observeLink?: (link: string, stat: fs.BigIntStats, target: string) => void,
): string {
  if (observeLink) {
    let current = path.parse(input).root;
    for (const segment of input.split(path.sep)) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        current = path.dirname(current);
        continue;
      }
      const next = path.join(current, segment);
      let stat: fs.BigIntStats | undefined;
      try {
        stat = fs.lstatSync(next, { bigint: true });
      } catch (error) {
        if (!missing(error)) throw error;
      }
      if (stat?.isSymbolicLink()) {
        if (activeLinks.has(next))
          throw new Error(`Config source snapshot symlink cycle: ${input}`);
        const target = fs.readlinkSync(next);
        observeLink(next, stat, target);
        activeLinks.add(next);
        try {
          const referenced = path.isAbsolute(target)
            ? target
            : `${current}${path.sep}${target}`;
          current = physicalPath(referenced, activeLinks, observeLink);
        } finally {
          activeLinks.delete(next);
        }
      } else {
        current = next;
      }
    }
    return current;
  }
  try {
    return fs.realpathSync.native(input);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ELOOP') {
      throw new Error(`Config source snapshot symlink cycle: ${input}`);
    }
    if (!missing(error)) {
      throw error;
    }
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(input);
    } catch (statError) {
      if (!missing(statError)) {
        throw statError;
      }
    }
    if (stat?.isSymbolicLink()) {
      if (activeLinks.has(input)) {
        throw new Error(`Config source snapshot symlink cycle: ${input}`);
      }
      activeLinks.add(input);
      try {
        const target = fs.readlinkSync(input);
        let current = path.isAbsolute(target)
          ? path.parse(target).root
          : physicalPath(path.dirname(input), activeLinks);
        // Resolve each segment before '..': normalizing first changes filesystem
        // semantics when an earlier segment is itself a directory symlink.
        for (const segment of target.split(path.sep)) {
          if (!segment || segment === '.') continue;
          current =
            segment === '..'
              ? path.dirname(current)
              : physicalPath(path.join(current, segment), activeLinks);
        }
        return current;
      } finally {
        activeLinks.delete(input);
      }
    }
    const parent = path.dirname(input);
    if (parent === input) {
      throw error;
    }
    return path.join(physicalPath(parent, activeLinks), path.basename(input));
  }
}

/** Internal observation uses the same existing/missing symlink resolution rules. */
export function resolveConfigSourcePhysicalPath(input: string): string {
  return physicalPath(input);
}

/** Pure coverage lookup; filesystem resolution and mutation checks stay live. */
export function createConfigSourceCoverageMatcher(
  coverage: readonly ConfigSourceCoverage[],
  paths: typeof path = path,
): (input: string) => boolean {
  const normalize = (input: string) => {
    const resolved = paths.resolve(input);
    return paths.sep === '\\' ? resolved.toLowerCase() : resolved;
  };
  const exact = new Set<string>();
  const recursive = new Set<string>();
  for (const boundary of coverage) {
    const key = normalize(boundary.path);
    exact.add(key);
    if (boundary.recursive) recursive.add(key);
  }
  return input => {
    let current = normalize(input);
    if (exact.has(current)) return true;
    for (;;) {
      const parent = normalize(paths.dirname(current));
      if (parent === current) return false;
      if (recursive.has(parent)) return true;
      current = parent;
    }
  };
}

type SymlinkTraversalSnapshot = Pick<
  ConfigSourceSnapshot,
  'coverage' | 'sourceRoots' | 'extraInputs'
> & { states?: readonly ConfigSourceState[] };

function assertSymlinkTraversal(
  snapshot: SymlinkTraversalSnapshot,
  input: string,
  observeLink:
    | ((link: string, stat: fs.BigIntStats, target: string) => void)
    | undefined,
  isCovered: (input: string) => boolean,
): void {
  physicalPath(input, new Set(), (link, stat, target) => {
    // A declared root/input also owns its lexical ancestor chain. Those links
    // are recorded separately, without expanding coverage to their siblings.
    //
    // Ownership is decided by actually resolving each declared root/input's
    // own ancestor chain (the same incremental resolution `input` itself just
    // went through) and checking whether it passes through this exact link.
    // Comparing raw path strings instead breaks as soon as an earlier
    // ancestor symlink (for example macOS's /var -> /private/var, which sits
    // above every default TMPDIR path) has already been resolved into
    // `link`'s prefix while the declared name is still fully lexical: the two
    // strings then share no prefix even though `link` genuinely sits on the
    // declared name's path. That mismatch misclassified ordinary installed
    // dependencies (e.g. a pnpm/workspace symlink under node_modules) as an
    // unbounded escape whenever the project itself lived under a symlinked
    // ancestor directory.
    if (!isCovered(link)) {
      const declared = [...snapshot.sourceRoots, ...snapshot.extraInputs];
      const ownsLink = (name: string): boolean => {
        if (name === link) return true;
        let owned = false;
        physicalPath(name, new Set(), candidate => {
          if (candidate === link) owned = true;
        });
        return owned;
      };
      if (!declared.some(ownsLink)) {
        throw new Error(
          `Config source snapshot unbounded symlink intermediate: ${link}`,
        );
      }
    }
    if (snapshot.states) {
      const baseline = snapshot.states.find(state => state.path === link);
      if (baseline?.kind !== 'symlink') {
        throw new Error(
          `Config source snapshot uncaptured symlink intermediate: ${link}; add this link to extraInputs`,
        );
      }
      if (
        baseline.symlinkTarget !== target ||
        baseline.dev !== stat.dev.toString() ||
        baseline.ino !== stat.ino.toString() ||
        baseline.ctimeNs !== stat.ctimeNs.toString()
      ) {
        throw new Error(`Config source changed during observation: ${link}`);
      }
    }
    observeLink?.(link, stat, target);
  });
}

/** Validate every traversed link, including links hidden by a final realpath. */
export function assertConfigSourceSymlinkTraversal(
  snapshot: SymlinkTraversalSnapshot,
  input: string,
  observeLink?: (link: string, stat: fs.BigIntStats, target: string) => void,
): void {
  let isCovered: ((input: string) => boolean) | undefined;
  assertSymlinkTraversal(snapshot, input, observeLink, link => {
    isCovered ??= createConfigSourceCoverageMatcher(snapshot.coverage);
    return isCovered(link);
  });
}

function createCoverage(options: CaptureOptions): ConfigSourceCoverage[] {
  const entries = [
    ...options.sourceRoots.map(input => ({
      path: physicalPath(input),
      recursive: true,
    })),
    ...(options.extraInputs ?? []).map(input => {
      let recursive = false;
      try {
        recursive = fs.statSync(input).isDirectory();
      } catch (error) {
        if (!missing(error)) {
          throw error;
        }
      }
      return { path: physicalPath(input), recursive };
    }),
  ];
  const byPath = new Map<string, ConfigSourceCoverage>();
  for (const entry of entries) {
    byPath.set(entry.path, {
      path: entry.path,
      recursive: entry.recursive || byPath.get(entry.path)?.recursive === true,
    });
  }
  return [...byPath.values()].sort((left, right) =>
    compare(left.path, right.path),
  );
}

function snapshotDigest(
  snapshot: Omit<ConfigSourceSnapshot, 'digest'>,
): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function capture(
  options: CaptureOptions,
  coverage: readonly ConfigSourceCoverage[],
): ConfigSourceSnapshot {
  const isCovered = createConfigSourceCoverageMatcher(coverage);
  const sourceRoots = absolutePaths(options.sourceRoots);
  const extraInputs = absolutePaths(options.extraInputs ?? []);
  const states = new Map<string, ConfigSourceState>();
  const activeDirectories = new Set<string>();
  const workspaceRoots = [
    ...new Set([
      ...sourceRoots,
      ...sourceRoots.map(input => physicalPath(input)),
    ]),
  ];
  const workspaceGroups = ['apps', 'verticals', 'packages'];
  const physicalWorkspaceGroups = new Set(
    workspaceRoots.flatMap(root =>
      workspaceGroups.map(group => physicalPath(path.join(root, group))),
    ),
  );

  function isAuthoredWorkspacePackage(input: string): boolean {
    if (!['dist', 'coverage'].includes(path.basename(input))) return false;
    if (physicalWorkspaceGroups.has(path.dirname(input))) return true;
    return workspaceRoots.some(root => {
      const segments = path.relative(root, input).split(path.sep);
      // Match the workspace transaction's authored package exception. Outputs
      // within these packages still follow the ordinary directory exclusions.
      return (
        segments.length === 2 &&
        workspaceGroups.includes(segments[0]) &&
        ['dist', 'coverage'].includes(segments[1])
      );
    });
  }

  function walk(input: string, explicit = false): void {
    assertSymlinkTraversal(
      { coverage, sourceRoots, extraInputs },
      input,
      (link, stat, target) => {
        const state: ConfigSourceState = {
          path: link,
          kind: 'symlink',
          mode: Number(stat.mode),
          symlinkTarget: target,
          resolvedPath: physicalPath(link),
          dev: stat.dev.toString(),
          ino: stat.ino.toString(),
          ctimeNs: stat.ctimeNs.toString(),
        };
        const previous = states.get(link);
        if (previous && JSON.stringify(previous) !== JSON.stringify(state)) {
          throw new Error(
            `Config source changed during snapshot capture: ${link}`,
          );
        }
        states.set(link, state);
      },
      isCovered,
    );
    const physical = physicalPath(input);
    if (!isCovered(physical)) {
      throw new Error(
        `Config source snapshot symlink escapes captured coverage: ${input} -> ${physical}`,
      );
    }
    let stat: fs.BigIntStats;
    try {
      stat = fs.lstatSync(input, { bigint: true });
    } catch (error) {
      if (!missing(error)) {
        throw error;
      }
      states.set(input, {
        path: input,
        kind: 'missing',
        resolvedPath: physical,
      });
      return;
    }
    if (stat.isSymbolicLink()) {
      const symlinkTarget = fs.readlinkSync(input);
      states.set(input, {
        path: input,
        kind: 'symlink',
        mode: Number(stat.mode),
        symlinkTarget,
        resolvedPath: physical,
        dev: stat.dev.toString(),
        ino: stat.ino.toString(),
        ctimeNs: stat.ctimeNs.toString(),
      });
      let referenced = input;
      const referencesExcludedDirectory = path
        .relative(input, physical)
        .split(path.sep)
        .some(part => {
          referenced = path.resolve(referenced, part);
          if (!exclusions.has(part) || isAuthoredWorkspacePackage(referenced))
            return false;
          try {
            return fs.statSync(referenced).isDirectory();
          } catch (error) {
            if (!missing(error)) throw error;
            return false;
          }
        });
      if (!explicit && referencesExcludedDirectory) {
        throw new Error(
          `Config source snapshot symlink targets an excluded directory: ${input} -> ${physical}`,
        );
      }
      walk(physical, explicit);
      const after = fs.lstatSync(input, { bigint: true });
      if (
        fs.readlinkSync(input) !== symlinkTarget ||
        after.dev !== stat.dev ||
        after.ino !== stat.ino ||
        after.mode !== stat.mode ||
        after.ctimeNs !== stat.ctimeNs
      ) {
        throw new Error(
          `Config source changed during snapshot capture: ${input}`,
        );
      }
      return;
    }
    if (stat.isDirectory()) {
      if (activeDirectories.has(physical)) {
        throw new Error(
          `Config source snapshot symlink cycle: ${input} -> ${physical}`,
        );
      }
      states.set(input, {
        path: input,
        kind: 'directory',
        mode: Number(stat.mode),
        resolvedPath: physical,
      });
      activeDirectories.add(physical);
      try {
        const names = fs.readdirSync(input).sort(compare);
        for (const name of names) {
          const child = path.join(input, name);
          if (exclusions.has(name) && !isAuthoredWorkspacePackage(child)) {
            const childStat = fs.lstatSync(child);
            if (
              childStat.isDirectory() ||
              childStat.isSymbolicLink() ||
              name === '.git'
            ) {
              continue;
            }
          }
          walk(child);
        }
        if (
          JSON.stringify(names) !==
          JSON.stringify(fs.readdirSync(input).sort(compare))
        ) {
          throw new Error(
            `Config source changed during snapshot capture: ${input}`,
          );
        }
        const after = fs.lstatSync(input, { bigint: true });
        if (
          after.dev !== stat.dev ||
          after.ino !== stat.ino ||
          after.mode !== stat.mode
        ) {
          throw new Error(
            `Config source changed during snapshot capture: ${input}`,
          );
        }
      } finally {
        activeDirectories.delete(physical);
      }
    } else if (stat.isFile()) {
      const descriptor = fs.openSync(
        input,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      try {
        const before = fs.fstatSync(descriptor, { bigint: true });
        const sha256 = createHash('sha256')
          .update(fs.readFileSync(descriptor))
          .digest('hex');
        const after = fs.fstatSync(descriptor, { bigint: true });
        const named = fs.lstatSync(input, { bigint: true });
        if (
          before.dev !== stat.dev ||
          before.ino !== stat.ino ||
          before.ctimeNs !== stat.ctimeNs ||
          named.dev !== before.dev ||
          named.ino !== before.ino ||
          named.mode !== before.mode ||
          named.ctimeNs !== before.ctimeNs ||
          before.mode !== after.mode ||
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs
        ) {
          throw new Error(
            `Config source changed during snapshot capture: ${input}`,
          );
        }
        states.set(input, {
          path: input,
          kind: 'file',
          mode: Number(before.mode),
          sha256,
          resolvedPath: physical,
          dev: before.dev.toString(),
          ino: before.ino.toString(),
          ctimeNs: before.ctimeNs.toString(),
        });
      } finally {
        fs.closeSync(descriptor);
      }
    } else {
      throw new Error(
        `Config source snapshot does not support this filesystem entry: ${input}`,
      );
    }
    if (physicalPath(input) !== physical) {
      throw new Error(
        `Config source changed during snapshot capture: ${input}`,
      );
    }
  }

  for (const input of absolutePaths([...sourceRoots, ...extraInputs])) {
    walk(input, true);
  }
  for (const state of states.values()) {
    if (state.kind !== 'symlink') continue;
    const after = fs.lstatSync(state.path, { bigint: true });
    if (
      fs.readlinkSync(state.path) !== state.symlinkTarget ||
      after.dev.toString() !== state.dev ||
      after.ino.toString() !== state.ino ||
      after.ctimeNs.toString() !== state.ctimeNs
    ) {
      throw new Error(
        `Config source changed during snapshot capture: ${state.path}`,
      );
    }
  }
  const snapshot: Omit<ConfigSourceSnapshot, 'digest'> = {
    kind: 'bounded-config-source-snapshot',
    version: 1,
    sourceRoots,
    extraInputs,
    exclusions: [...CONFIG_SOURCE_SNAPSHOT_EXCLUSIONS],
    coverage: [...coverage],
    states: [...states.values()].sort((left, right) =>
      compare(left.path, right.path),
    ),
  };
  return { ...snapshot, digest: snapshotDigest(snapshot) };
}

/** A bounded filesystem source snapshot; this is not an imported-module inventory. */
export function captureConfigSourceSnapshot(
  options: CaptureOptions,
): ConfigSourceSnapshot {
  const normalized = {
    sourceRoots: absolutePaths(options.sourceRoots),
    extraInputs: absolutePaths(options.extraInputs ?? []),
  };
  return capture(normalized, createCoverage(normalized));
}

export function assertConfigSourceSnapshotUnchanged(
  snapshot: ConfigSourceSnapshot,
): void {
  const { digest, ...contents } = snapshot;
  if (
    snapshot.kind !== 'bounded-config-source-snapshot' ||
    snapshot.version !== 1 ||
    JSON.stringify(snapshot.exclusions) !==
      JSON.stringify(CONFIG_SOURCE_SNAPSHOT_EXCLUSIONS) ||
    digest !== snapshotDigest(contents)
  ) {
    throw new Error('Invalid config source snapshot');
  }
  const current = capture(snapshot, snapshot.coverage);
  if (current.digest !== snapshot.digest) {
    const previous = new Map(
      snapshot.states.map(state => [state.path, JSON.stringify(state)]),
    );
    const next = new Map(
      current.states.map(state => [state.path, JSON.stringify(state)]),
    );
    const changed = [...new Set([...previous.keys(), ...next.keys()])]
      .filter(input => previous.get(input) !== next.get(input))
      .sort(compare);
    throw new Error(
      `Config source snapshot changed: ${changed.join(', ') || 'coverage'}`,
    );
  }
}
