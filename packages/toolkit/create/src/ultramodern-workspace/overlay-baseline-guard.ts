import fs from 'node:fs';
import path from 'node:path';
import { yaml } from '@modern-js/utils';
import type { JsonValue } from './types';
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

const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

type DependencyEntry = {
  section: string;
  name: string;
  value: string;
};

type PolicyEntry = {
  path: string;
  dependency: string;
  value: string;
};

function readPackageJson(
  workspaceRoot: string,
  packageJsonRelativePath: string,
): Record<string, JsonValue> {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, packageJsonRelativePath), 'utf-8'),
  );
  return isRecord(parsed) ? parsed : {};
}

function dependencyEntries(
  parsed: Record<string, JsonValue>,
): DependencyEntry[] {
  const entries: DependencyEntry[] = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const group = parsed[section];
    if (!isRecord(group)) continue;
    for (const [name, value] of Object.entries(group)) {
      if (typeof value === 'string') {
        entries.push({ section, name, value });
      }
    }
  }
  return entries;
}

function baselineDependencyFromKey(key: string): string | undefined {
  const candidate = key.trim().split('>').at(-1) ?? '';
  return Object.keys(BASELINE_DEPENDENCY_PINS).find(
    dependency =>
      candidate === dependency || candidate.startsWith(`${dependency}@`),
  );
}

function collectPolicyEntries(
  value: JsonValue,
  prefix: string,
  entries: PolicyEntry[],
): void {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix === '' ? key : `${prefix}.${key}`;
    const dependency = baselineDependencyFromKey(key);
    if (dependency !== undefined && typeof child === 'string') {
      entries.push({ path: childPath, dependency, value: child });
    }
    if (isRecord(child)) {
      collectPolicyEntries(child, childPath, entries);
    }
  }
}

function policyRoots(
  parsed: Record<string, JsonValue>,
): Array<[string, JsonValue | undefined]> {
  const pnpm = isRecord(parsed.pnpm) ? parsed.pnpm : undefined;
  return [
    ['overrides', parsed.overrides],
    ['resolutions', parsed.resolutions],
    ['pnpm.overrides', pnpm?.overrides],
    ['catalog', parsed.catalog],
    ['catalogs', parsed.catalogs],
    ['pnpm.catalog', pnpm?.catalog],
    ['pnpm.catalogs', pnpm?.catalogs],
  ];
}

function baselinePolicyEntries(
  parsed: Record<string, JsonValue>,
): PolicyEntry[] {
  const entries: PolicyEntry[] = [];
  for (const [prefix, value] of policyRoots(parsed)) {
    if (value !== undefined) {
      collectPolicyEntries(value, prefix, entries);
    }
  }
  return entries;
}

function readPnpmWorkspaceYaml(
  workspaceRoot: string,
): Record<string, JsonValue> {
  try {
    const parsed: unknown = yaml.load(
      fs.readFileSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf-8'),
    );
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function collectCatalogValues(
  parsed: Record<string, JsonValue>,
): Map<string, string> {
  const values = new Map<string, string>();
  const collect = (value: JsonValue, prefix: string) => {
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = prefix === '' ? key : `${prefix}.${key}`;
      if (typeof child === 'string') {
        values.set(key, child);
        values.set(childPath, child);
      } else {
        collect(child, childPath);
      }
    }
  };
  for (const [prefix, value] of policyRoots(parsed).filter(([prefix]) =>
    /catalog/u.test(prefix),
  )) {
    collect(value ?? {}, prefix);
  }
  return values;
}

function resolveCatalogReference(
  value: string,
  catalogValues: Map<string, string>,
): string {
  if (!value.startsWith('catalog:')) return value;
  return catalogValues.get(value.slice('catalog:'.length)) ?? value;
}

function parseNpmAlias(
  value: string,
): { name: string; range: string | undefined } | undefined {
  if (!value.startsWith('npm:')) return undefined;
  const target = value.slice('npm:'.length);
  const separator = target.startsWith('@')
    ? target.indexOf('@', 1)
    : target.indexOf('@');
  if (separator === -1) return { name: target, range: undefined };
  return {
    name: target.slice(0, separator),
    range: target.slice(separator + 1),
  };
}

function baselineSpecMatches(value: string, dependency: string): boolean {
  const expected = BASELINE_DEPENDENCY_PINS[dependency];
  if (value === expected) return true;
  const alias = parseNpmAlias(value);
  return alias?.name === dependency && alias.range === expected;
}

function baselinePinsFromParsed(
  parsed: Record<string, JsonValue>,
): Record<string, string> {
  const pins: Record<string, string> = {};

  for (const section of DEPENDENCY_SECTIONS) {
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

function readBaselinePins(
  workspaceRoot: string,
  packageJsonRelativePath: string,
): Record<string, string> {
  return baselinePinsFromParsed(
    readPackageJson(workspaceRoot, packageJsonRelativePath),
  );
}

/**
 * Snapshot of the baseline-relevant workspace state taken BEFORE an overlay
 * runs. Compared against the post-overlay state to prove non-relaxation.
 */
export type OverlayBaselineSnapshot = {
  baselinePinsByManifest: Record<string, Record<string, string>>;
  baselinePolicyPinsByManifest?: Record<string, Record<string, string>>;
  baselineWorkspacePolicyPins?: Record<string, string>;
  shellPackageDirectories: string[];
  shellFiles: Set<string>;
};

export function captureOverlayBaselineSnapshot(
  workspaceRoot: string,
  shellPackageDirectories: string[],
): OverlayBaselineSnapshot {
  const baselinePinsByManifest: Record<string, Record<string, string>> = {};
  const baselinePolicyPinsByManifest: Record<
    string,
    Record<string, string>
  > = {};
  for (const manifest of walkFiles(workspaceRoot, isPackageManifest)) {
    const parsed = readPackageJson(workspaceRoot, manifest);
    baselinePinsByManifest[manifest] = readBaselinePins(
      workspaceRoot,
      manifest,
    );
    baselinePolicyPinsByManifest[manifest] = Object.fromEntries(
      baselinePolicyEntries(parsed).map(entry => [entry.path, entry.value]),
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

  return {
    baselinePinsByManifest,
    baselinePolicyPinsByManifest,
    baselineWorkspacePolicyPins: Object.fromEntries(
      baselinePolicyEntries(readPnpmWorkspaceYaml(workspaceRoot)).map(entry => [
        entry.path,
        entry.value,
      ]),
    ),
    shellPackageDirectories,
    shellFiles,
  };
}

function collectPolicyViolations(
  parsed: Record<string, JsonValue>,
  beforePolicyPins: Record<string, string>,
  displayPath: string,
): OverlayBaselineViolation[] {
  const violations: OverlayBaselineViolation[] = [];
  const currentPolicyEntries = baselinePolicyEntries(parsed);
  const currentPolicyPins = Object.fromEntries(
    currentPolicyEntries.map(entry => [entry.path, entry.value]),
  );

  for (const [policyPath, previous] of Object.entries(beforePolicyPins)) {
    if (Object.hasOwn(currentPolicyPins, policyPath)) continue;
    const dependency =
      baselineDependencyFromKey(policyPath.split('.').at(-1) ?? '') ??
      policyPath.split('.').at(-1) ??
      policyPath;
    const expected = BASELINE_DEPENDENCY_PINS[dependency];
    if (expected === undefined) continue;
    violations.push({
      kind: 'baseline-version-relaxation',
      path: `${displayPath}#${policyPath}`,
      detail: `overlay removed baseline policy "${policyPath}" from "${previous}"; Platform Baseline pin is "${expected}"`,
    });
  }

  const catalogValues = collectCatalogValues(parsed);
  for (const entry of currentPolicyEntries) {
    const resolvedVersion = resolveCatalogReference(entry.value, catalogValues);
    const expected = BASELINE_DEPENDENCY_PINS[entry.dependency];
    if (baselineSpecMatches(resolvedVersion, entry.dependency)) continue;
    violations.push({
      kind: 'baseline-version-relaxation',
      path: `${displayPath}#${entry.path}`,
      detail: `overlay policy "${entry.path}" pins baseline dependency "${entry.dependency}" at "${entry.value}"; Platform Baseline pin is "${expected}"`,
    });
  }

  return violations;
}

function collectVersionViolations(
  workspaceRoot: string,
  snapshot: OverlayBaselineSnapshot,
): OverlayBaselineViolation[] {
  const violations: OverlayBaselineViolation[] = [];

  const manifests = new Set([
    ...walkFiles(workspaceRoot, isPackageManifest),
    ...Object.keys(snapshot.baselinePinsByManifest),
  ]);

  for (const manifest of manifests) {
    let parsed: Record<string, JsonValue>;
    try {
      parsed = readPackageJson(workspaceRoot, manifest);
    } catch {
      parsed = {};
    }
    const pins = baselinePinsFromParsed(parsed);
    const before = snapshot.baselinePinsByManifest[manifest] ?? {};

    for (const key of Object.keys(before)) {
      if (Object.hasOwn(pins, key)) continue;
      const separator = key.indexOf('.');
      const section = key.slice(0, separator);
      const dependency = key.slice(separator + 1);
      const expected = BASELINE_DEPENDENCY_PINS[dependency];
      violations.push({
        kind: 'baseline-version-relaxation',
        path: manifest,
        detail: `overlay removed baseline dependency "${dependency}" from ${section}; Platform Baseline pin is "${expected}"`,
      });
    }

    const catalogValues = collectCatalogValues(parsed);
    for (const [key, version] of Object.entries(pins)) {
      const dependency = key.slice(key.indexOf('.') + 1);
      const expected = BASELINE_DEPENDENCY_PINS[dependency];
      const previous = before[key];
      const resolvedVersion = resolveCatalogReference(version, catalogValues);
      const matches = baselineSpecMatches(resolvedVersion, dependency);
      if (previous === undefined && !matches) {
        violations.push({
          kind: 'baseline-version-relaxation',
          path: manifest,
          detail: `overlay added baseline dependency "${dependency}" at "${version}"; Platform Baseline pin is "${expected}"`,
        });
      } else if (previous !== undefined && version !== previous && !matches) {
        violations.push({
          kind: 'baseline-version-relaxation',
          path: manifest,
          detail: `overlay changed baseline dependency "${dependency}" from "${previous}" to "${version}"; Platform Baseline pin is "${expected}"`,
        });
      }
    }

    for (const entry of dependencyEntries(parsed)) {
      const alias = parseNpmAlias(entry.value);
      if (alias === undefined) continue;
      const expected = BASELINE_DEPENDENCY_PINS[alias.name];
      if (expected === undefined || alias.range === expected) continue;
      violations.push({
        kind: 'baseline-version-relaxation',
        path: manifest,
        detail: `overlay alias "${entry.name}" resolves to baseline dependency "${alias.name}" at "${entry.value}"; Platform Baseline pin is "${expected}"`,
      });
    }

    violations.push(
      ...collectPolicyViolations(
        parsed,
        snapshot.baselinePolicyPinsByManifest?.[manifest] ?? {},
        manifest,
      ),
    );
  }

  violations.push(
    ...collectPolicyViolations(
      readPnpmWorkspaceYaml(workspaceRoot),
      snapshot.baselineWorkspacePolicyPins ?? {},
      'pnpm-workspace.yaml',
    ),
  );

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
