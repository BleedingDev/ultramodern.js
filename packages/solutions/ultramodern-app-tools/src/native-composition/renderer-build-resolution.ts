import { resolveTopologyDeliveryUnit } from '@modern-js/app-tools-extensions/cloudflare/delivery-unit';
import { resolveRendererBuildIdentities } from '@modern-js/app-tools-extensions/renderer-build-identity';
import type { Renderer } from '@modern-js/renderer-core';
import type { NativeInfrastructureOptions } from './native-infrastructure';
import {
  resolveRendererProfileMetadata,
  resolveRendererRouterFrameworks,
} from './renderer-profile';
import { resolveEntrypointRouterBindings } from './renderer-router-resolution';

/** Resolve the renderer identities of one build from its config and installs. */
export function createRendererBuildIdentityResolver(
  renderer: Renderer,
): NonNullable<NativeInfrastructureOptions['resolveBuildIdentities']> {
  return async context => {
    const metadata = resolveRendererProfileMetadata(renderer);
    const routerBindings = await resolveEntrypointRouterBindings(
      renderer,
      context.entrypoints,
      context.pluginNames ?? [],
      metadata,
    );
    const delivery = await resolveTopologyDeliveryUnit(context.appDirectory);
    if (delivery && !delivery.surfaces.ui)
      throw new Error(
        'A renderer UI build requires the authoritative UI delivery surface app identity',
      );
    return resolveRendererBuildIdentities({
      projectRoot: context.appDirectory,
      renderer,
      profile: metadata.profile,
      routerBindings,
      routerFrameworks: resolveRendererRouterFrameworks(renderer),
      entryNames: context.entrypoints.map(entrypoint => entrypoint.entryName),
      mode:
        context.mode ??
        (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
      ...(delivery
        ? {
            appId: delivery.surfaces.ui!.rendererIdentity.appId,
            sourceRevision: delivery.sourceRevision,
          }
        : { appId: context.packageName || undefined }),
    });
  };
}
