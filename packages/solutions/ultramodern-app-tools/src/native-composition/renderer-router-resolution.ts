import {
  immutableRendererRouterBindings,
  type RendererRouterBindings,
  validateRendererRouterBindings,
} from '@modern-js/backend-federation-contracts';
import type { Renderer } from '@modern-js/renderer-core';
import type { Entrypoint } from '@modern-js/types/cli/base';
import { isEntryMetadataRead } from './config-read-context';
import type { RendererProfileMetadata } from './renderer-installed-profile';
import {
  resolveCandidateRendererProfile,
  resolveRendererProfile,
  resolveRendererRouterFrameworks,
} from './renderer-profile';
import { nativeInfrastructurePluginName } from './renderer-registration';

/** Describe the actual owning entry hooks; runtime provider choice stays native. */
export async function resolveEntrypointRouterBindings(
  renderer: Renderer,
  entrypoints: readonly Entrypoint[],
  pluginNames: readonly string[],
  metadata?: RendererProfileMetadata,
  appDirectory?: string,
): Promise<RendererRouterBindings> {
  if (renderer === 'react')
    return (
      await import('../renderers/react/router-bindings')
    ).resolveReactRouterBindings({ entrypoints, pluginNames, appDirectory });
  const owner = nativeInfrastructurePluginName(renderer);
  if (!pluginNames.includes(owner))
    throw new Error(`The ${renderer} entry router owner is not registered`);
  const routerFrameworks = resolveRendererRouterFrameworks(renderer);
  const provider = {
    ...(
      metadata?.profile ??
      (isEntryMetadataRead()
        ? resolveCandidateRendererProfile(renderer)
        : resolveRendererProfile(renderer))
    ).router,
    framework: routerFrameworks[0],
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
    routerFrameworks,
  );
  if (!validation.ok)
    throw new Error(
      `Invalid owning router bindings: ${JSON.stringify(validation.errors)}`,
    );
  return immutableRendererRouterBindings(bindings);
}
