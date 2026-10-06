import { createRequire } from 'node:module';
import type * as EffectContextModule from '@modern-js/bff-effect/context';
import type * as EffectEdgeModule from '@modern-js/bff-effect/effect-edge';

import type { BackendFederationRuntimeOptions } from './types';

type HostShared = NonNullable<BackendFederationRuntimeOptions['shared']>;

const fromAdapter = createRequire(import.meta.url);
const effectPackageJson = fromAdapter.resolve(
  '@modern-js/bff-effect/package.json',
);
const fromEffectPackage = createRequire(effectPackageJson);

let hostShared: HostShared | undefined;

/**
 * Shares the package-private Effect handler factory registry and the Effect
 * request storage with every backend container, so factories a remote creates
 * with defineEffectBff are recognized by this host's module resolver and its
 * endpoints read the context this host's dispatcher enters.
 *
 * Loaded on first call, not when this module loads: a CommonJS require() of
 * the Effect ES modules throws while a concurrent import() is still loading
 * them.
 */
export function effectBffHostShared(): HostShared {
  if (hostShared !== undefined) {
    return hostShared;
  }
  const {
    EFFECT_BFF_CONTEXT_STORAGE_SHARE,
    EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE,
  } = fromEffectPackage(
    '@modern-js/bff-effect/effect-edge',
  ) as typeof EffectEdgeModule;
  const { getEffectContextStorage } = fromEffectPackage(
    '@modern-js/bff-effect/context',
  ) as typeof EffectContextModule;
  const handlerFactoryRegistry: unknown = fromEffectPackage(
    `#effect-entry-shape-${'registry'}`,
  );
  const version = (fromAdapter(effectPackageJson) as { version: string })
    .version;
  hostShared = {
    [EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE]: {
      version,
      lib: () => handlerFactoryRegistry,
      shareConfig: { singleton: true, requiredVersion: false },
    },
    [EFFECT_BFF_CONTEXT_STORAGE_SHARE]: {
      version,
      lib: getEffectContextStorage,
      shareConfig: { singleton: true, requiredVersion: false },
    },
  };
  return hostShared;
}

/**
 * Adds the host shares to caller shares. Their names are reserved: a caller
 * replacement would make containers use a registry or a request storage this
 * host never consults.
 */
export function withEffectBffHostShared(
  shared: BackendFederationRuntimeOptions['shared'],
): HostShared {
  const host = effectBffHostShared();
  const reserved = Object.keys(host).find(name => shared && name in shared);
  if (reserved !== undefined) {
    throw new Error(
      `[BFF][Effect] Share ${reserved} is reserved for the Node host. Remove it from options.shared.`,
    );
  }
  return { ...shared, ...host };
}
