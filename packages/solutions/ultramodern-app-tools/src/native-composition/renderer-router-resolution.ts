import {
  immutableRendererRouterBindings,
  type RendererRouterBindings,
  validateRendererRouterBindings,
} from '@modern-js/backend-federation-contracts';
import type { Renderer } from '@modern-js/renderer-core';
import type { Entrypoint } from '@modern-js/types/cli/base';
import type { RendererProfileMetadata } from './renderer-installed-profile';
import { resolveRendererProfile } from './renderer-profile';

/** Describe the actual owning entry hooks; runtime provider choice stays native. */
export async function resolveEntrypointRouterBindings(
  renderer: Renderer,
  entrypoints: readonly Entrypoint[],
  pluginNames: readonly string[],
  metadata?: RendererProfileMetadata,
): Promise<RendererRouterBindings> {
  if (renderer === 'react')
    return (await import('./react-router-bindings')).resolveReactRouterBindings(
      { entrypoints, pluginNames },
    );
  const owner = `@modern-js/renderer-${renderer}-infrastructure`;
  if (!pluginNames.includes(owner))
    throw new Error(`The ${renderer} entry router owner is not registered`);
  const provider = {
    ...(metadata?.profile ?? resolveRendererProfile(renderer)).router,
    framework: renderer,
  };
  const bindings: RendererRouterBindings = Object.fromEntries(
    entrypoints.map(entry => [
      entry.entryName,
      {
        owner,
        evidence: 'owned-default' as const,
        defaultProvider: provider,
        providers: [provider] as const,
      },
    ]),
  );
  const validation = validateRendererRouterBindings(
    bindings,
    entrypoints.map(entry => entry.entryName),
    'routerBindings',
    renderer,
  );
  if (!validation.ok)
    throw new Error(
      `Invalid owning router bindings: ${JSON.stringify(validation.errors)}`,
    );
  return immutableRendererRouterBindings(bindings);
}
