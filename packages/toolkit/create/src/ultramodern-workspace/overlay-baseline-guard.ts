import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from './types';
import {
  EFFECT_VERSION,
  REACT_DOM_VERSION,
  REACT_VERSION,
  TAILWIND_VERSION,
  TANSTACK_ROUTER_CORE_VERSION,
  TANSTACK_ROUTER_VERSION,
} from './versions';

/**
 * Platform Baseline producer pins (G21 / CONTEXT.md "Platform Baseline").
 * A Platform Overlay (overlays.ts) may only *narrow* choices — it must never
 * relax the baseline. The concrete, structurally-checkable meaning of "must not
 * relax" is: an overlay's output must not change the pinned version of any
 * baseline dependency (React, TanStack Router, Effect, Tailwind) in any
 * generated package manifest, and must not (re)introduce a package that pins a
 * baseline dependency to a version other than the platform pin.
 *
 * These names match the specifiers emitted into generated `package.json`
 * manifests. `@tanstack/react-router` and `@tanstack/router-core` are the two
 * router producers; `tailwindcss` is the Tailwind producer; `effect` is the
 * Effect producer; `react`/`react-dom` are the React producers.
 */
export const BASELINE_DEPENDENCY_PINS: Readonly<Record<string, string>> =
  Object.freeze({
    react: REACT_VERSION,
    'react-dom': REACT_DOM_VERSION,
    '@tanstack/react-router': TANSTACK_ROUTER_VERSION,
    '@tanstack/router-core': TANSTACK_ROUTER_CORE_VERSION,
    effect: EFFECT_VERSION,
    tailwindcss: TAILWIND_VERSION,
  });

/**
 * Forbidden artifact classes an overlay may not (re)introduce into a thin Shell
 * (G21). A Platform Overlay narrows freedom; it may not smuggle a forbidden
 * structural artifact back into a shell. These relative path segments are
 * checked against files an overlay newly creates under a shell package, and are
 * intentionally aligned with the structural thin-shell gate (G30a): a shell
 * never owns an `api/` or `server/` surface or backend-federation artifacts.
 */
const FORBIDDEN_SHELL_ARTIFACT_SEGMENTS = [
  'api',
  'server',
  'backend-federation.config.ts',
] as const;

const IGNORED_WALK_DIRECTORIES = new Set([
  '.git',
  '.nx',
  '.output',
  'coverage',
  'dist',
  'dist-cloudflare',
  'node_modules',
]);

export type OverlayBaselineViolation = {
  kind: 'baseline-version-relaxation' | 'forbidden-shell-artifact';
  path: string;
  detail: string;
};

/**
 * Typed error raised BEFORE an overlaid workspace is accepted when a CodeSmith
 * overlay relaxes the Platform Baseline (G21). Carries the exact violations so
 * callers can surface which baseline pin or forbidden artifact the overlay
 * changed.
 */
export class OverlayBaselineRelaxationError extends Error {
  readonly code = 'ULTRAMODERN_OVERLAY_BASELINE_RELAXATION';
  readonly generator: string;
  readonly violations: OverlayBaselineViolation[];

  constructor(generator: string, violations: OverlayBaselineViolation[]) {
    super(
      [
        `UltraModern CodeSmith overlay relaxed the Platform Baseline: ${generator}`,
        ...violations.map(
          violation => `  - ${violation.path}: ${violation.detail}`,
        ),
      ].join('\n'),
    );
    this.name = 'OverlayBaselineRelaxationError';
    this.generator = generator;
    this.violations = violations;
  }
}

function walkFiles(root: string, predicate: (relativePath: string) => boolean) {
  const matches: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_WALK_DIRECTORIES.has(entry.name)) {
          queue.push(absolute);
        }
        continue;
      }
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (predicate(relative)) {
        matches.push(relative);
      }
    }
  }

  return matches.sort();
}

function isPackageManifest(relativePath: string): boolean {
  return (
    relativePath === 'package.json' || relativePath.endsWith('/package.json')
  );
}

function readBaselinePins(
  workspaceRoot: string,
  packageJsonRelativePath: string,
): Record<string, string> {
  const raw = fs.readFileSync(
    path.join(workspaceRoot, packageJsonRelativePath),
    'utf-8',
  );
  const parsed: unknown = JSON.parse(raw);
  const pins: Record<string, string> = {};
  if (!isRecord(parsed)) {
    return pins;
  }

  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const group = parsed[section];
    if (!isRecord(group)) {
      continue;
    }
    for (const dependency of Object.keys(BASELINE_DEPENDENCY_PINS)) {
      const value = group[dependency];
      if (typeof value === 'string') {
        pins[`${section}.${dependency}`] = value;
      }
    }
  }

  return pins;
}

/**
 * Snapshot of the baseline-relevant workspace state taken BEFORE an overlay
 * runs. Compared against the post-overlay state to prove non-relaxation.
 */
export type OverlayBaselineSnapshot = {
  baselinePinsByManifest: Record<string, Record<string, string>>;
  shellPackageDirectories: string[];
  shellFiles: Set<string>;
};

export function captureOverlayBaselineSnapshot(
  workspaceRoot: string,
  shellPackageDirectories: string[],
): OverlayBaselineSnapshot {
  const baselinePinsByManifest: Record<string, Record<string, string>> = {};
  for (const manifest of walkFiles(workspaceRoot, isPackageManifest)) {
    baselinePinsByManifest[manifest] = readBaselinePins(
      workspaceRoot,
      manifest,
    );
  }

  const shellFiles = new Set<string>();
  for (const shellDir of shellPackageDirectories) {
    const absolute = path.join(workspaceRoot, shellDir);
    if (!fs.existsSync(absolute)) {
      continue;
    }
    for (const file of walkFiles(absolute, () => true)) {
      shellFiles.add(`${shellDir}/${file}`);
    }
  }

  return { baselinePinsByManifest, shellPackageDirectories, shellFiles };
}

function collectVersionViolations(
  workspaceRoot: string,
  snapshot: OverlayBaselineSnapshot,
): OverlayBaselineViolation[] {
  const violations: OverlayBaselineViolation[] = [];

  for (const manifest of walkFiles(workspaceRoot, isPackageManifest)) {
    let pins: Record<string, string>;
    try {
      pins = readBaselinePins(workspaceRoot, manifest);
    } catch {
      continue;
    }
    const before = snapshot.baselinePinsByManifest[manifest] ?? {};
    for (const [key, version] of Object.entries(pins)) {
      const dependency = key.slice(key.indexOf('.') + 1);
      const expected = BASELINE_DEPENDENCY_PINS[dependency];
      const previous = before[key];
      // An overlay relaxes the baseline when it (a) changes an existing
      // baseline pin away from what the framework wrote, or (b) newly adds a
      // baseline dependency at a version other than the platform pin.
      if (previous === undefined) {
        if (version !== expected) {
          violations.push({
            kind: 'baseline-version-relaxation',
            path: manifest,
            detail: `overlay added baseline dependency "${dependency}" at "${version}"; Platform Baseline pin is "${expected}"`,
          });
        }
        continue;
      }
      if (version !== previous) {
        violations.push({
          kind: 'baseline-version-relaxation',
          path: manifest,
          detail: `overlay changed baseline dependency "${dependency}" from "${previous}" to "${version}"; Platform Baseline pin is "${expected}"`,
        });
      }
    }
  }

  return violations;
}

function collectForbiddenShellArtifactViolations(
  workspaceRoot: string,
  snapshot: OverlayBaselineSnapshot,
): OverlayBaselineViolation[] {
  const violations: OverlayBaselineViolation[] = [];

  for (const shellDir of snapshot.shellPackageDirectories) {
    const absolute = path.join(workspaceRoot, shellDir);
    if (!fs.existsSync(absolute)) {
      continue;
    }
    for (const file of walkFiles(absolute, () => true)) {
      const relative = `${shellDir}/${file}`;
      if (snapshot.shellFiles.has(relative)) {
        continue;
      }
      const segments = file.split('/');
      const forbidden = FORBIDDEN_SHELL_ARTIFACT_SEGMENTS.find(
        segment => segments.includes(segment) || file === segment,
      );
      if (forbidden) {
        violations.push({
          kind: 'forbidden-shell-artifact',
          path: relative,
          detail: `overlay introduced a forbidden thin-shell artifact class "${forbidden}" into shell package ${shellDir}`,
        });
      }
    }
  }

  return violations;
}

/**
 * Validate that an applied CodeSmith overlay did not relax the Platform
 * Baseline (G21). Compares the post-overlay workspace against the pre-overlay
 * {@link OverlayBaselineSnapshot}; throws {@link OverlayBaselineRelaxationError}
 * when the overlay changed a baseline pin or reintroduced a forbidden thin-shell
 * artifact. Pure read + throw: it never writes, so a relaxing overlay fails
 * before its output is accepted by the generator.
 */
export function assertOverlayPreservedBaseline(options: {
  workspaceRoot: string;
  generator: string;
  snapshot: OverlayBaselineSnapshot;
}) {
  const violations = [
    ...collectVersionViolations(options.workspaceRoot, options.snapshot),
    ...collectForbiddenShellArtifactViolations(
      options.workspaceRoot,
      options.snapshot,
    ),
  ];

  if (violations.length > 0) {
    throw new OverlayBaselineRelaxationError(options.generator, violations);
  }
}
