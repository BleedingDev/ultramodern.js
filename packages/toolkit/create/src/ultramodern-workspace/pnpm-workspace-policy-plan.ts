import {
  DRIZZLE_ORM_VERSION,
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  MODULE_FEDERATION_VERSION,
} from './versions';

export const strictEffectPackageVersionPolicyExclusions = [
  `effect@${EFFECT_VERSION}`,
  `@effect/opentelemetry@${EFFECT_VERSION}`,
];

export const moduleFederationModernJsPatchPath = `patches/@module-federation__modern-js-v3@${MODULE_FEDERATION_VERSION}.patch`;
export const moduleFederationBridgeReactPatchPath = `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`;
export const effectDeclarationPatchPath =
  'patches/effect-schema-error-type-id.patch';
export const drizzleOrmDeclarationPatchPath =
  'patches/drizzle-orm-ts7-strict-declarations.patch';

export type PnpmWorkspaceYamlAction =
  | {
      kind: 'replace-line';
      pattern: RegExp;
      replacement: string;
    }
  | {
      kind: 'ensure-scalar-map-entry';
      key: string;
      entryKey: string;
      value: string;
    }
  | {
      kind: 'ensure-list-item';
      key: string;
      item: string;
    }
  | {
      kind: 'ensure-map-entry';
      key: string;
      entryKey: string;
      value: string;
    }
  | {
      kind: 'remove-map-entry';
      entryKey: string;
    };

export type GeneratedDeclarationPatchAction = {
  kind: 'ensure' | 'remove-if-unchanged';
  relativePatchPath: string;
};

export type PnpmWorkspacePolicyPlan = {
  yamlActions: PnpmWorkspaceYamlAction[];
  declarationPatchActions: GeneratedDeclarationPatchAction[];
  requiresInstallOnChange: boolean;
};

export function createPnpmWorkspacePolicyPlan(options: {
  usesDrizzleOrm: boolean;
}): PnpmWorkspacePolicyPlan {
  return {
    yamlActions: [
      {
        kind: 'replace-line',
        pattern: /^ {4}'@effect\/vitest>effect': .+$/mu,
        replacement: `    '@effect/vitest>effect': '${EFFECT_VERSION}'`,
      },
      {
        kind: 'ensure-scalar-map-entry',
        key: 'overrides',
        entryKey: "'@effect/opentelemetry'",
        value: EFFECT_VERSION,
      },
      {
        kind: 'ensure-scalar-map-entry',
        key: 'overrides',
        entryKey: "'@effect/vitest'",
        value: EFFECT_VITEST_VERSION,
      },
      {
        kind: 'ensure-scalar-map-entry',
        key: 'overrides',
        entryKey: 'effect',
        value: EFFECT_VERSION,
      },
      {
        kind: 'ensure-scalar-map-entry',
        key: 'allowBuilds',
        entryKey: "'@parcel/watcher'",
        value: 'true',
      },
      ...strictEffectPackageVersionPolicyExclusions.flatMap(item =>
        createStrictEffectPackageVersionPolicyActions(item),
      ),
      {
        kind: 'ensure-map-entry',
        key: 'patchedDependencies',
        entryKey: `effect@${EFFECT_VERSION}`,
        value: effectDeclarationPatchPath,
      },
      {
        kind: 'ensure-map-entry',
        key: 'patchedDependencies',
        entryKey: `@module-federation/modern-js-v3@${MODULE_FEDERATION_VERSION}`,
        value: moduleFederationModernJsPatchPath,
      },
      {
        kind: 'ensure-map-entry',
        key: 'patchedDependencies',
        entryKey: `@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}`,
        value: moduleFederationBridgeReactPatchPath,
      },
      options.usesDrizzleOrm
        ? {
            kind: 'ensure-map-entry',
            key: 'patchedDependencies',
            entryKey: `drizzle-orm@${DRIZZLE_ORM_VERSION}`,
            value: drizzleOrmDeclarationPatchPath,
          }
        : {
            kind: 'remove-map-entry',
            entryKey: `drizzle-orm@${DRIZZLE_ORM_VERSION}`,
          },
    ],
    declarationPatchActions: [
      {
        kind: 'ensure',
        relativePatchPath: moduleFederationModernJsPatchPath,
      },
      {
        kind: 'ensure',
        relativePatchPath: moduleFederationBridgeReactPatchPath,
      },
      {
        kind: 'ensure',
        relativePatchPath: effectDeclarationPatchPath,
      },
      {
        kind: options.usesDrizzleOrm ? 'ensure' : 'remove-if-unchanged',
        relativePatchPath: drizzleOrmDeclarationPatchPath,
      },
    ],
    requiresInstallOnChange: true,
  };
}

function createStrictEffectPackageVersionPolicyActions(
  item: string,
): PnpmWorkspaceYamlAction[] {
  const packageName = item.slice(0, item.lastIndexOf('@'));
  const escapedPackageName = packageName.replace(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&',
  );

  return [
    {
      kind: 'replace-line',
      pattern: new RegExp(`^ {2}- '${escapedPackageName}@[^']+'$`, 'gmu'),
      replacement: `  - '${item}'`,
    },
    {
      kind: 'ensure-list-item',
      key: 'minimumReleaseAgeExclude',
      item,
    },
    {
      kind: 'ensure-list-item',
      key: 'trustPolicyExclude',
      item,
    },
  ];
}
