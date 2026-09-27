#!/usr/bin/env node
// Fails when a pnpm override in the workspace lockfile is dead or wrong.
//
// pnpm applies overrides silently: a key whose target no longer resolves, a
// key with an empty version selector, or a parent selector that names a
// workspace package all install fine and just do nothing (or quietly replace
// that package's own declared version). This check reads pnpm-lock.yaml and
// reports:
//   - a key with an empty version selector (`name@`), which pnpm never matches;
//   - a parent selector naming a workspace importer, which overrides that
//     package's own package.json instead of a third-party dependent;
//   - a key whose target (or parent) resolves nowhere in the lockfile;
//   - a resolution that still sits inside a range the override should close.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import semver from 'semver';
import { parse } from 'yaml';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

// `parent>child`: pnpm's parsePkgAndParentSelector treats a `>` as the
// separator unless a space, `|` or `@` precedes it, as in a range.
const PARENT_SEPARATOR = /[^ |@]>/;

function parseSpec(spec) {
  const at = spec.indexOf('@', 1);
  return at === -1
    ? { name: spec, range: undefined }
    : { name: spec.slice(0, at), range: spec.slice(at + 1) };
}

export function parseOverrideKey(key) {
  const at = key.search(PARENT_SEPARATOR);
  return at === -1
    ? { target: parseSpec(key) }
    : {
        parent: parseSpec(key.slice(0, at + 1)),
        target: parseSpec(key.slice(at + 2)),
      };
}

// `name@version(peer@x)` -> { name, version } without the peer suffix.
function parsePackageKey(key) {
  const { name, range } = parseSpec(key.replace(/\(.*$/, ''));
  return { name, version: range };
}

// Selector match with pnpm's default semver semantics: a prerelease only
// matches a range that names a prerelease of the same version.
function inRange(version, range) {
  return range === undefined || semver.satisfies(version, range);
}

// Whether `version` is what the override value asks for: the exact version,
// or inside the value's range. An `npm:bar@x` value needs the edge version
// `bar@<x>`. Other values (`$ref`, `link:`) pass.
function honours(version, value) {
  if (value.startsWith('npm:')) {
    const wanted = parseSpec(value.slice(4));
    const actual = parseSpec(version);
    return (
      actual.name === wanted.name &&
      actual.range !== undefined &&
      (wanted.range === undefined || honours(actual.range, wanted.range))
    );
  }
  if (semver.valid(value)) return version === value;
  if (semver.validRange(value)) {
    return semver.satisfies(version, value);
  }
  return true;
}

function childEdge(snapshot, name) {
  return (
    (snapshot.dependencies ?? {})[name] ??
    (snapshot.optionalDependencies ?? {})[name]
  );
}

function findRemovalViolations(key, parent, target, snapshots, importers) {
  const scope = parent
    ? snapshots.filter(
        entry =>
          entry.name === parent.name && inRange(entry.version, parent.range),
      )
    : [...importers, ...snapshots];
  if (parent && scope.length === 0) {
    return [
      `'${key}': nothing in the lockfile resolves ${parent.name}${parent.range ? `@${parent.range}` : ''}. Delete the override.`,
    ];
  }
  const kept = scope.filter(entry => {
    const child = childEdge(entry.snapshot, target.name);
    return (
      child !== undefined &&
      inRange(parsePackageKey(`${target.name}@${child}`).version, target.range)
    );
  });
  return kept.map(
    entry =>
      `'${key}': ${entry.version ? `${entry.name}@${entry.version}` : entry.name} still depends on ${target.name}, which this override removes. ` +
      'Run pnpm install so the lockfile picks up the override.',
  );
}

/**
 * @param {string} lockfileText pnpm-lock.yaml contents
 * @param {Map<string, {path: string, version?: string}>} importerNames
 *   workspace package name -> importer path and manifest version
 * @returns {string[]} violations, one line each
 */
export function findOverrideViolations(lockfileText, importerNames) {
  const lockfile = parse(lockfileText);
  const snapshots = Object.entries(lockfile.snapshots ?? {}).map(
    ([key, snapshot]) => ({
      ...parsePackageKey(key),
      snapshot: snapshot ?? {},
    }),
  );

  // Workspace projects as edge holders: `version` is undefined, `name` is the
  // importer path, and every dependency field counts as an edge.
  const importers = Object.entries(lockfile.importers ?? {}).map(
    ([importer, manifest]) => {
      const dependencies = {};
      for (const field of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
      ]) {
        for (const [name, entry] of Object.entries(manifest?.[field] ?? {})) {
          dependencies[name] = String(entry.version);
        }
      }
      return { name: importer, version: undefined, snapshot: { dependencies } };
    },
  );
  // Every resolved package is reached through a named edge; an `npm:` alias
  // override's target exists only as such an edge name.
  const edgeNames = new Set(
    [...importers, ...snapshots].flatMap(({ snapshot }) => [
      ...Object.keys(snapshot.dependencies ?? {}),
      ...Object.keys(snapshot.optionalDependencies ?? {}),
    ]),
  );

  // pnpm picks a matching parent override before a generic one, so a generic
  // override does not judge edges that a parent override for the same target
  // already owns.
  const parentOverrides = Object.keys(lockfile.overrides ?? {})
    .map(parseOverrideKey)
    .filter(({ parent }) => parent);
  const ownedByParentOverride = (entry, targetName) =>
    parentOverrides.some(
      ({ parent, target }) =>
        target.name === targetName &&
        entry.name === parent.name &&
        entry.version !== undefined &&
        inRange(entry.version, parent.range),
    );

  const violations = [];
  for (const [key, rawValue] of Object.entries(lockfile.overrides ?? {})) {
    const value = String(rawValue);
    const { parent, target } = parseOverrideKey(key);

    const empty = [parent, target].find(spec => spec?.range === '');
    if (empty) {
      violations.push(
        `'${key}': '${empty.name}@' has an empty version selector, so pnpm applies it to nothing. ` +
          `Write '${empty.name}@<range>' for the versions it must replace, or drop the '@'.`,
      );
      continue;
    }

    // pnpm matches a parent by name and version, so a versioned selector
    // that excludes the workspace package only targets registry copies.
    const workspaceParent = parent && importerNames.get(parent.name);
    if (
      workspaceParent &&
      (parent.range === undefined ||
        (workspaceParent.version !== undefined &&
          inRange(workspaceParent.version, parent.range)))
    ) {
      violations.push(
        `'${key}': '${parent.name}' is a workspace package, so this overrides its own declared ${target.name}. ` +
          `Delete the override and set ${target.name} in ${workspaceParent.path}/package.json.`,
      );
      continue;
    }

    // `-` removes the dependency: honoured means the edge is gone.
    if (value === '-') {
      violations.push(
        ...findRemovalViolations(key, parent, target, snapshots, importers),
      );
      continue;
    }

    if (!edgeNames.has(target.name)) {
      violations.push(
        `'${key}': nothing in the lockfile resolves ${target.name}. Delete the override.`,
      );
      continue;
    }

    if (parent) {
      const parents = snapshots.filter(
        entry =>
          entry.name === parent.name && inRange(entry.version, parent.range),
      );
      if (parents.length === 0) {
        violations.push(
          `'${key}': nothing in the lockfile resolves ${parent.name}${parent.range ? `@${parent.range}` : ''}. Delete the override.`,
        );
        continue;
      }
      let edges = 0;
      for (const entry of parents) {
        const deps = {
          ...entry.snapshot.dependencies,
          ...entry.snapshot.optionalDependencies,
        };
        const child = deps[target.name];
        if (child === undefined) {
          // pnpm also rewrites peer ranges; an unresolved or optional peer
          // leaves no snapshot edge, only the package's peerDependencies.
          const peers =
            lockfile.packages?.[`${entry.name}@${entry.version}`]
              ?.peerDependencies ?? {};
          if (target.name in peers) edges += 1;
          continue;
        }
        edges += 1;
        const { version } = parsePackageKey(`${target.name}@${child}`);
        if (inRange(version, target.range) && !honours(version, value)) {
          violations.push(
            `'${key}': ${entry.name}@${entry.version} still resolves ${target.name}@${version}, not ${value}. ` +
              'Run pnpm install so the lockfile picks up the override.',
          );
        }
      }
      if (edges === 0) {
        violations.push(
          `'${key}': no ${parent.name}${parent.range ? `@${parent.range}` : ''} in the lockfile depends on ${target.name}. Delete the override.`,
        );
      }
      continue;
    }

    const judged = new Set();
    for (const entry of [...importers, ...snapshots]) {
      const edge = childEdge(entry.snapshot, target.name);
      if (edge === undefined || ownedByParentOverride(entry, target.name)) {
        continue;
      }
      judged.add(String(edge).replace(/\(.*$/, ''));
    }
    for (const version of judged) {
      const matches = semver.valid(version)
        ? inRange(version, target.range)
        : value.startsWith('npm:');
      if (matches && !honours(version, value)) {
        violations.push(
          `'${key}': the lockfile still resolves ${target.name}@${version}, which this override should replace with ${value}. ` +
            'Run pnpm install, or fix the selector if pnpm does not match it.',
        );
      }
    }
  }
  return violations;
}

export function readImporterNames(lockfileText, root = repoRoot) {
  const names = new Map();
  for (const importer of Object.keys(parse(lockfileText).importers ?? {})) {
    const { name, version } = JSON.parse(
      readFileSync(path.join(root, importer, 'package.json'), 'utf8'),
    );
    if (name) names.set(name, { path: importer, version });
  }
  return names;
}

function main() {
  const lockfileText = readFileSync(
    path.join(repoRoot, 'pnpm-lock.yaml'),
    'utf8',
  );
  const violations = findOverrideViolations(
    lockfileText,
    readImporterNames(lockfileText),
  );
  if (violations.length > 0) {
    console.error(
      `check-overrides: ${violations.length} dead or wrong override(s) in pnpm-workspace.yaml:\n` +
        violations.map(line => `  - ${line}`).join('\n'),
    );
    process.exit(1);
  }
  console.log('check-overrides: every override is live and honoured.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
