import { createRequire } from 'node:module';
import type * as EffectContextModule from '@modern-js/bff-effect/context';
import {
  EFFECT_BFF_CONTEXT_STORAGE_SHARE,
  EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE,
} from '@modern-js/bff-effect/effect-edge';

import type { BackendFederationRuntimeOptions } from './types';

const fromAdapter = createRequire(import.meta.url);
const effectPackageJson = fromAdapter.resolve(
  '@modern-js/bff-effect/package.json',
);
const fromEffectPackage = createRequire(effectPackageJson);
const handlerFactoryRegistry: unknown = fromEffectPackage(
  `#effect-entry-shape-${'registry'}`,
);

const effectVersion = (fromAdapter(effectPackageJson) as { version: string })
  .version;

/**
 * Shares the package-private Effect handler factory registry and the Effect
 * request storage with every backend container, so factories a remote creates
 * with defineEffectBff are recognized by this host's module resolver and its
 * endpoints read the context this host's dispatcher enters.
 */
export const effectBffHostShared: NonNullable<
  BackendFederationRuntimeOptions['shared']
> = {
  [EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE]: {
    version: effectVersion,
    lib: () => handlerFactoryRegistry,
    shareConfig: { singleton: true, requiredVersion: false },
  },
  [EFFECT_BFF_CONTEXT_STORAGE_SHARE]: {
    version: effectVersion,
    // Required on first use, not at load: the host may still be importing the
    // Effect entries, and require() of an ES module that is mid-load throws.
    lib: () =>
      (
        fromEffectPackage(
          '@modern-js/bff-effect/context',
        ) as typeof EffectContextModule
      ).getEffectContextStorage(),
    shareConfig: { singleton: true, requiredVersion: false },
  },
};

/**
 * Adds the host shares to caller shares. Their names are reserved: a caller
 * replacement would make containers use a registry or a request storage this
 * host never consults.
 */
export function withEffectBffHostShared(
  shared: BackendFederationRuntimeOptions['shared'],
): NonNullable<BackendFederationRuntimeOptions['shared']> {
  const reserved = Object.keys(effectBffHostShared).find(
    name => shared && name in shared,
  );
  if (reserved !== undefined) {
    throw new Error(
      `[BFF][Effect] Share ${reserved} is reserved for the Node host. Remove it from options.shared.`,
    );
  }
  return { ...shared, ...effectBffHostShared };
}
