import fs from 'node:fs';
import path from 'node:path';

import {
  DRIZZLE_ORM_VERSION,
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  MODULE_FEDERATION_VERSION,
} from '../../../ultramodern-workspace/versions';
import { workspaceUsesDependency } from './dependency-usage';
import type { MigrationIo } from './io';
import {
  ensureYamlListItem,
  ensureYamlMapEntry,
  ensureYamlScalarMapEntry,
  removeYamlMapEntry,
  replaceYamlLine,
} from './pnpm-yaml';
import {
  drizzleOrmDeclarationPatchPath,
  effectDeclarationPatchPath,
  moduleFederationBridgeReactPatchPath,
  moduleFederationDtsPluginPatchPath,
  moduleFederationModernJsPatchPath,
  moduleFederationPackageVersionPolicyExclusions,
  strictEffectPackageVersionPolicyExclusions,
} from './policy-constants';

export { ensureGeneratedDeclarationPatches } from './declaration-patches';
export { workspaceUsesDependency } from './dependency-usage';

export function updateGeneratedPnpmWorkspacePolicy(io: MigrationIo) {
  const workspaceFile = path.join(io.workspaceRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspaceFile)) {
    return false;
  }

  let source = fs.readFileSync(workspaceFile, 'utf-8');
  let changed = false;
  const usesDrizzleOrm = workspaceUsesDependency(
    io.workspaceRoot,
    'drizzle-orm',
  );

  const replacements: Array<[RegExp, string]> = [
    [
      /^ {4}'@effect\/vitest>effect': .+$/mu,
      `    '@effect/vitest>effect': '${EFFECT_VERSION}'`,
    ],
  ];

  for (const [pattern, replacement] of replacements) {
    const result = replaceYamlLine(source, pattern, replacement);
    source = result.source;
    changed = result.changed || changed;
  }

  for (const [entryKey, version] of [
    [`'@effect/opentelemetry'`, EFFECT_VERSION],
    [`'@effect/vitest'`, EFFECT_VITEST_VERSION],
    ['effect', EFFECT_VERSION],
  ]) {
    const result = ensureYamlScalarMapEntry(
      source,
      'overrides',
      entryKey,
      version,
    );
    source = result.source;
    changed = result.changed || changed;
  }

  const parcelWatcherBuildPolicy = ensureYamlScalarMapEntry(
    source,
    'allowBuilds',
    "'@parcel/watcher'",
    'true',
  );
  source = parcelWatcherBuildPolicy.source;
  changed = parcelWatcherBuildPolicy.changed || changed;

  for (const item of strictEffectPackageVersionPolicyExclusions) {
    const packageName = item.slice(0, item.lastIndexOf('@'));
    const escapedPackageName = packageName.replace(
      /[.*+?^${}()|[\]\\]/gu,
      '\\$&',
    );
    const currentVersion = replaceYamlLine(
      source,
      new RegExp(`^ {2}- '${escapedPackageName}@[^']+'$`, 'gmu'),
      `  - '${item}'`,
    );
    source = currentVersion.source;
    changed = currentVersion.changed || changed;

    for (const policyKey of [
      'minimumReleaseAgeExclude',
      'trustPolicyExclude',
    ]) {
      const policyExclude = ensureYamlListItem(source, policyKey, item);
      source = policyExclude.source;
      changed = policyExclude.changed || changed;
    }
  }

  for (const item of moduleFederationPackageVersionPolicyExclusions) {
    const policyExclude = ensureYamlListItem(
      source,
      'minimumReleaseAgeExclude',
      item,
    );
    source = policyExclude.source;
    changed = policyExclude.changed || changed;
  }

  const effectPatch = ensureYamlMapEntry(
    source,
    'patchedDependencies',
    `effect@${EFFECT_VERSION}`,
    effectDeclarationPatchPath,
  );
  source = effectPatch.source;
  changed = effectPatch.changed || changed;

  const moduleFederationModernJsPatch = ensureYamlMapEntry(
    source,
    'patchedDependencies',
    `@module-federation/modern-js-v3@${MODULE_FEDERATION_VERSION}`,
    moduleFederationModernJsPatchPath,
  );
  source = moduleFederationModernJsPatch.source;
  changed = moduleFederationModernJsPatch.changed || changed;

  const moduleFederationDtsPluginPatch = ensureYamlMapEntry(
    source,
    'patchedDependencies',
    `@module-federation/dts-plugin@${MODULE_FEDERATION_VERSION}`,
    moduleFederationDtsPluginPatchPath,
  );
  source = moduleFederationDtsPluginPatch.source;
  changed = moduleFederationDtsPluginPatch.changed || changed;

  const moduleFederationBridgeReactPatch = ensureYamlMapEntry(
    source,
    'patchedDependencies',
    `@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}`,
    moduleFederationBridgeReactPatchPath,
  );
  source = moduleFederationBridgeReactPatch.source;
  changed = moduleFederationBridgeReactPatch.changed || changed;

  const drizzleOrmPatch = usesDrizzleOrm
    ? ensureYamlMapEntry(
        source,
        'patchedDependencies',
        `drizzle-orm@${DRIZZLE_ORM_VERSION}`,
        drizzleOrmDeclarationPatchPath,
      )
    : removeYamlMapEntry(source, `drizzle-orm@${DRIZZLE_ORM_VERSION}`);
  source = drizzleOrmPatch.source;
  changed = drizzleOrmPatch.changed || changed;

  if (changed) {
    io.write(workspaceFile, source);
  }

  return changed;
}
