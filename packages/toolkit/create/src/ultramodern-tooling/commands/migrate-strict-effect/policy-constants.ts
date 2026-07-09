import path from 'node:path';
import {
  DRIZZLE_ORM_VERSION,
  EFFECT_VERSION,
  MODULE_FEDERATION_VERSION,
} from '../../../ultramodern-workspace/versions';
import { createPackageRoot } from '../context';

export const strictEffectPackageVersionPolicyExclusions = [
  `effect@${EFFECT_VERSION}`,
  `@effect/opentelemetry@${EFFECT_VERSION}`,
];

export const moduleFederationPackageVersionPolicyExclusions = [
  '@module-federation/*',
  '@module-federation/bridge-react',
  '@module-federation/bridge-react-webpack-plugin',
  '@module-federation/cli',
  '@module-federation/dts-plugin',
  '@module-federation/enhanced',
  '@module-federation/error-codes',
  '@module-federation/inject-external-runtime-core-plugin',
  '@module-federation/managers',
  '@module-federation/manifest',
  '@module-federation/modern-js-v3',
  '@module-federation/node',
  '@module-federation/rsbuild-plugin',
  '@module-federation/rspack',
  '@module-federation/runtime',
  '@module-federation/runtime-core',
  '@module-federation/runtime-tools',
  '@module-federation/sdk',
  '@module-federation/third-party-dts-extractor',
  '@module-federation/webpack-bundler-runtime',
] as const;

export const moduleFederationModernJsPatchPath = `patches/@module-federation__modern-js-v3@${MODULE_FEDERATION_VERSION}.patch`;

export const moduleFederationModernJsPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  moduleFederationModernJsPatchPath,
);

export const moduleFederationDtsPluginPatchPath = `patches/@module-federation__dts-plugin@${MODULE_FEDERATION_VERSION}.patch`;

export const moduleFederationDtsPluginPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  moduleFederationDtsPluginPatchPath,
);

export const moduleFederationBridgeReactPatchPath = `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`;

export const moduleFederationBridgeReactPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  moduleFederationBridgeReactPatchPath,
);

export const effectDeclarationPatchPath =
  'patches/effect-schema-error-type-id.patch';

export const effectDeclarationPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  effectDeclarationPatchPath,
);

export const drizzleOrmDeclarationPatchPath =
  'patches/drizzle-orm-ts7-strict-declarations.patch';

export const drizzleOrmDeclarationPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  drizzleOrmDeclarationPatchPath,
);
