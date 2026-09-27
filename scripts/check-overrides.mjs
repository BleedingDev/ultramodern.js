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

// `parent>child`: the separator `>` directly follows a name or version and
// directly precedes a package name, unlike the `>`/`>=` of a range.
const PARENT_SEPARATOR = /(?<=[^\s<>=])>(?=[@a-z])/;

function parseSpec(spec) {
  const at = spec.indexOf('@', 1);
  return at === -1
    ? { name: spec, range: undefined }
    : { name: spec.slice(0, at), range: spec.slice(at + 1) };
}

export function parseOverrideKey(key) {
  const parts = key.split(PARENT_SEPARATOR);
  const target = parseSpec(parts.at(-1));
  return parts.length === 1
    ? { target }
    : { parent: parseSpec(parts[0]), target };
}

// `name@version(peer@x)` -> { name, version } without the peer suffix.
function parsePackageKey(key) {
  const { name, range } = parseSpec(key.replace(/\(.*$/, ''));
  return { name, version: range };
}

function inRange(version, range) {
  return (
    range === undefined ||
    semver.satisfies(version, range, { includePrerelease: true })
  );
}

// Whether `version` is what the override value asks for: the exact version,
// or inside the value's range. Non-semver values (`-`, `npm:`, `$ref`) pass.
function honours(version, value) {
  if (semver.valid(value)) return version === value;
  if (semver.validRange(value)) {
    return semver.satisfies(version, value, { includePrerelease: true });
  }
  return true;
}

/**
 * @param {string} lockfileText pnpm-lock.yaml contents
 * @param {Map<string, string>} importerNames workspace package name -> importer path
 * @returns {string[]} violations, one line each
 */
export function findOverrideViolations(lockfileText, importerNames) {
  const lockfile = parse(lockfileText);
  const resolved = new Map();
  for (const key of Object.keys(lockfile.packages ?? {})) {
    const { name, version } = parsePackageKey(key);
    if (!resolved.has(name)) resolved.set(name, new Set());
    resolved.get(name).add(version);
  }
  const snapshots = Object.entries(lockfile.snapshots ?? {}).map(
    ([key, snapshot]) => ({
      ...parsePackageKey(key),
      snapshot: snapshot ?? {},
    }),
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

    if (parent && importerNames.has(parent.name)) {
      violations.push(
        `'${key}': '${parent.name}' is a workspace package, so this overrides its own declared ${target.name}. ` +
          `Delete the override and set ${target.name} in ${importerNames.get(parent.name)}/package.json.`,
      );
      continue;
    }

    const targetVersions = resolved.get(target.name);
    if (!targetVersions) {
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
        if (child === undefined) continue;
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

    for (const version of targetVersions) {
      if (inRange(version, target.range) && !honours(version, value)) {
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
    const { name } = JSON.parse(
      readFileSync(path.join(root, importer, 'package.json'), 'utf8'),
    );
    if (name) names.set(name, importer);
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
