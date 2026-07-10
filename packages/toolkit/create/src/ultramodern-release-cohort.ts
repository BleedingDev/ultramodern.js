import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedUltramodernPackageSource } from './ultramodern-package-source';
import { createPackageRoot, writeFile } from './ultramodern-workspace/fs-io';

export const RELEASE_COHORT_PROJECTION_PATH = '.modernjs/release-cohort.json';
const RELEASE_COHORT_PROJECTION_SCHEMA =
  'bleedingdev.ultramodern.release-cohort';
const RELEASE_COHORT_PROJECTION_SCHEMA_VERSION = 1;

type ReleaseCohortPackage = {
  sourceName: string;
  targetName: string;
  version: string;
};

export type UltramodernReleaseCohort = {
  aliases: Record<string, string>;
  packages: ReleaseCohortPackage[];
  release: { tag: string; version: string };
  schema: string;
  schemaVersion: number;
  source: { commit: string; repository: string };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
) {
  assert(isRecord(value), `${label} must be a JSON object.`);
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  assert(
    JSON.stringify(actualKeys) === JSON.stringify(expected),
    `${label} has unknown or missing fields: expected ${expected.join(', ')}; found ${actualKeys.join(', ')}.`,
  );
}

function assertNonEmptyString(
  value: unknown,
  label: string,
): asserts value is string {
  assert(
    typeof value === 'string' && value.length > 0 && value.trim() === value,
    `${label} must be a non-empty trimmed string.`,
  );
}

function sourcePackageSuffix(sourceName: string) {
  assert(
    sourceName.startsWith('@modern-js/') && sourceName.lastIndexOf('/') > 0,
    `Release cohort sourceName must be an @modern-js package: ${sourceName}.`,
  );
  return sourceName.slice(sourceName.lastIndexOf('/') + 1);
}

function targetAliasProfile(sourceName: string, targetName: string) {
  const match = /^@([^/]+)\/([^/]+)$/u.exec(targetName);
  assert(match, `Release cohort targetName is invalid: ${targetName}.`);
  const [, aliasScope, targetPackageName] = match;
  const suffix = sourcePackageSuffix(sourceName);
  assert(
    targetPackageName.endsWith(suffix),
    `Release cohort alias ${sourceName} -> ${targetName} does not preserve the source package suffix.`,
  );
  return {
    aliasPackageNamePrefix: targetPackageName.slice(
      0,
      targetPackageName.length - suffix.length,
    ),
    aliasScope,
  };
}

export function parseUltramodernReleaseCohort(value: unknown) {
  assertExactKeys(
    value,
    ['aliases', 'packages', 'release', 'schema', 'schemaVersion', 'source'],
    'Release cohort projection',
  );
  const cohort = value as UltramodernReleaseCohort;
  assert(
    cohort.schema === RELEASE_COHORT_PROJECTION_SCHEMA &&
      cohort.schemaVersion === RELEASE_COHORT_PROJECTION_SCHEMA_VERSION,
    `Unknown release cohort projection schema ${String(cohort.schema)}@${String(cohort.schemaVersion)}.`,
  );
  assertExactKeys(
    cohort.source,
    ['commit', 'repository'],
    'Release cohort source',
  );
  assertNonEmptyString(cohort.source.commit, 'Release cohort source.commit');
  assertNonEmptyString(
    cohort.source.repository,
    'Release cohort source.repository',
  );
  assertExactKeys(cohort.release, ['tag', 'version'], 'Release cohort release');
  assertNonEmptyString(cohort.release.tag, 'Release cohort release.tag');
  assertNonEmptyString(
    cohort.release.version,
    'Release cohort release.version',
  );
  assert(isRecord(cohort.aliases), 'Release cohort aliases must be an object.');
  assert(
    Array.isArray(cohort.packages),
    'Release cohort packages must be an array.',
  );

  const aliasNames = Object.keys(cohort.aliases).sort();
  assert(aliasNames.length > 0, 'Release cohort aliases must not be empty.');
  const packageSourceNames: string[] = [];
  const packageTargetNames = new Set<string>();
  for (const [index, item] of cohort.packages.entries()) {
    assertExactKeys(
      item,
      ['sourceName', 'targetName', 'version'],
      `Release cohort packages[${index}]`,
    );
    assertNonEmptyString(
      item.sourceName,
      `Release cohort packages[${index}].sourceName`,
    );
    assertNonEmptyString(
      item.targetName,
      `Release cohort packages[${index}].targetName`,
    );
    assertNonEmptyString(
      item.version,
      `Release cohort packages[${index}].version`,
    );
    sourcePackageSuffix(item.sourceName);
    assert(
      cohort.aliases[item.sourceName] === item.targetName,
      `Release cohort packages[${index}] targetName does not match aliases for ${item.sourceName}.`,
    );
    assert(
      item.version === cohort.release.version,
      `Release cohort packages[${index}] version does not match release.version.`,
    );
    packageSourceNames.push(item.sourceName);
    assert(
      !packageTargetNames.has(item.targetName),
      `Release cohort packages contains duplicate targetName ${item.targetName}.`,
    );
    packageTargetNames.add(item.targetName);
  }
  assert(
    JSON.stringify(packageSourceNames) === JSON.stringify(aliasNames),
    'Release cohort packages must exactly match aliases in source-name order.',
  );
  return cohort;
}

function readCohortFile(filePath: string) {
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  assert(
    stat?.isFile() && !stat.isSymbolicLink(),
    `Authenticated release cohort projection is missing or unsafe: ${filePath}.`,
  );
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Authenticated release cohort projection is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    );
  }
  return parseUltramodernReleaseCohort(value);
}

export function readCreateReleaseCohort() {
  return readCohortFile(
    path.join(
      createPackageRoot,
      'template-workspace',
      RELEASE_COHORT_PROJECTION_PATH,
    ),
  );
}

export function hasCreateReleaseCohort() {
  return fs.existsSync(
    path.join(
      createPackageRoot,
      'template-workspace',
      RELEASE_COHORT_PROJECTION_PATH,
    ),
  );
}

export function isCreatePackageSourceCheckout() {
  return fs.existsSync(path.join(createPackageRoot, 'src'));
}

export function readWorkspaceReleaseCohort(workspaceRoot: string) {
  return readCohortFile(
    path.join(workspaceRoot, RELEASE_COHORT_PROJECTION_PATH),
  );
}

export function copyCreateReleaseCohort(workspaceRoot: string) {
  const sourcePath = path.join(
    createPackageRoot,
    'template-workspace',
    RELEASE_COHORT_PROJECTION_PATH,
  );
  const cohort = readCohortFile(sourcePath);
  writeFile(
    workspaceRoot,
    RELEASE_COHORT_PROJECTION_PATH,
    fs.readFileSync(sourcePath, 'utf8'),
  );
  return cohort;
}

export function assertReleaseCohortPackageSource(
  cohort: UltramodernReleaseCohort,
  packageSource: ResolvedUltramodernPackageSource,
) {
  if (packageSource.strategy !== 'install') {
    return;
  }
  assert(
    packageSource.modernPackageVersion === cohort.release.version,
    `Package source release ${packageSource.modernPackageVersion} does not match authenticated release cohort ${cohort.release.version}.`,
  );
  let expectedProfile: ReturnType<typeof targetAliasProfile> | undefined;
  for (const item of cohort.packages) {
    const profile = targetAliasProfile(item.sourceName, item.targetName);
    expectedProfile ??= profile;
    assert(
      profile.aliasScope === expectedProfile.aliasScope &&
        profile.aliasPackageNamePrefix ===
          expectedProfile.aliasPackageNamePrefix,
      'Authenticated release cohort aliases cannot be represented by one package-source profile.',
    );
  }
  assert(
    packageSource.aliasScope?.replace(/^@/u, '') ===
      expectedProfile?.aliasScope &&
      (packageSource.aliasPackageNamePrefix ?? '') ===
        expectedProfile?.aliasPackageNamePrefix,
    'Package source aliases rebind the authenticated release cohort.',
  );
  return cohort;
}

export function releaseCohortSelectors(cohort: UltramodernReleaseCohort) {
  return cohort.packages
    .map(item => `${item.targetName}@${item.version}`)
    .sort();
}
