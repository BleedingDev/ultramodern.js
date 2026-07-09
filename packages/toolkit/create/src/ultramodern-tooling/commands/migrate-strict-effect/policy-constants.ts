import path from 'node:path';
import {
  DRIZZLE_ORM_VERSION,
  EFFECT_VERSION,
  MODULE_FEDERATION_VERSION,
  WRANGLER_VERSION,
} from '../../../ultramodern-workspace/versions';
import { createPackageRoot } from '../context';

export const strictEffectPackageVersionPolicyExclusions = [
  `effect@${EFFECT_VERSION}`,
  `@effect/opentelemetry@${EFFECT_VERSION}`,
];

export const moduleFederationPackageVersionPolicyExclusions = [
  '@module-federation/*',
  '@module-federation/bridge-react',
  `@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/bridge-react-webpack-plugin',
  `@module-federation/bridge-react-webpack-plugin@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/cli',
  `@module-federation/cli@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/dts-plugin',
  `@module-federation/dts-plugin@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/enhanced',
  `@module-federation/enhanced@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/error-codes',
  `@module-federation/error-codes@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/inject-external-runtime-core-plugin',
  `@module-federation/inject-external-runtime-core-plugin@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/managers',
  `@module-federation/managers@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/manifest',
  `@module-federation/manifest@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/modern-js-v3',
  `@module-federation/modern-js-v3@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/node',
  '@module-federation/node@2.7.46',
  '@module-federation/rsbuild-plugin',
  `@module-federation/rsbuild-plugin@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/rspack',
  `@module-federation/rspack@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/runtime',
  `@module-federation/runtime@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/runtime-core',
  `@module-federation/runtime-core@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/runtime-tools',
  `@module-federation/runtime-tools@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/sdk',
  `@module-federation/sdk@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/third-party-dts-extractor',
  `@module-federation/third-party-dts-extractor@${MODULE_FEDERATION_VERSION}`,
  '@module-federation/webpack-bundler-runtime',
  `@module-federation/webpack-bundler-runtime@${MODULE_FEDERATION_VERSION}`,
] as const;

export const transitivePackageVersionPolicyExclusions = [
  '@typescript/native-preview',
  '@typescript/native-preview@7.0.0-dev.20260707.2',
  'wrangler',
  `wrangler@${WRANGLER_VERSION}`,
  'miniflare',
  'miniflare@4.20260708.0',
  'workerd',
  'workerd@1.20260708.1',
  '@cloudflare/workers-types',
  '@cloudflare/workers-types@5.20260708.1',
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
