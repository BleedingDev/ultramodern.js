import { createRequire } from 'node:module';
import { EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE } from '@modern-js/bff-effect/effect-edge';

import type { BackendFederationRuntimeOptions } from './types';

const fromAdapter = createRequire(import.meta.url);
const effectPackageJson = fromAdapter.resolve(
  '@modern-js/bff-effect/package.json',
);
const fromEffectPackage = createRequire(effectPackageJson);
const handlerFactoryRegistry: unknown = fromEffectPackage(
  `#effect-entry-shape-${'registry'}`,
);

/**
 * Shares the package-private Effect handler factory registry with every
 * backend container, so factories a remote creates with defineEffectBff are
 * recognized by this host's module resolver.
 */
export const effectBffHostShared: NonNullable<
  BackendFederationRuntimeOptions['shared']
> = {
  [EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE]: {
    version: (fromAdapter(effectPackageJson) as { version: string }).version,
    lib: () => handlerFactoryRegistry,
    shareConfig: { singleton: true, requiredVersion: false },
  },
};

/**
 * Adds the host registry share to caller shares. The share name is reserved:
 * a caller replacement would make containers register their factories in a
 * registry this host never consults.
 */
export function withEffectBffHostShared(
  shared: BackendFederationRuntimeOptions['shared'],
): NonNullable<BackendFederationRuntimeOptions['shared']> {
  if (shared && EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE in shared) {
    throw new Error(
      `[BFF][Effect] Share ${EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE} is reserved for the Node host handler factory registry. Remove it from options.shared.`,
    );
  }
  return { ...shared, ...effectBffHostShared };
}
