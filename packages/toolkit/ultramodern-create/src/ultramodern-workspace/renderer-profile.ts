import {
  registeredRenderers,
  resolveCandidateRendererProfile,
} from '@modern-js/ultramodern-app-tools';
import { resolveRendererGenerationAdapter } from './renderer-generations';
import type {
  ApplicationRenderer,
  RendererGenerationProfile,
  WorkspaceApp,
  WorkspaceRenderer,
} from './types';

export function isApplicationRenderer(
  value: unknown,
): value is ApplicationRenderer {
  return registeredRenderers.some(renderer => renderer === value);
}

export function resolveWorkspaceRenderer(app: WorkspaceApp): WorkspaceRenderer {
  if (app.surfaceProfile === 'api-only') {
    if (
      app.rendererIdentity ||
      app.rendererIdentities ||
      app.rendererProfile ||
      app.routerBindings ||
      app.rendererGenerationProfile ||
      app.rendererCapabilities
    ) {
      throw new Error(
        `Headless unit ${app.id} cannot carry a UI renderer identity.`,
      );
    }
    return 'none';
  }
  if (!isApplicationRenderer(app.renderer)) {
    throw new Error(
      `Application ${app.id} requires a renderer resolved from modern.config.`,
    );
  }
  return app.renderer;
}

/** Metadata-only selection. It never imports a renderer runtime or compiler. */
export function getRendererGenerationProfile(
  renderer: ApplicationRenderer,
): RendererGenerationProfile {
  if (!isApplicationRenderer(renderer)) {
    throw new Error(
      `Unsupported renderer ${String(renderer)}. Expected ${registeredRenderers.join(', ')}.`,
    );
  }
  const selected = resolveCandidateRendererProfile(renderer);
  const adapter = resolveRendererGenerationAdapter(renderer);
  const generation = adapter.createProfile(selected);
  if (
    selected.renderer !== renderer ||
    generation.renderer !== renderer ||
    generation.profile.renderer !== renderer
  ) {
    throw new Error(
      `Renderer ${renderer} generation profile has a different identity.`,
    );
  }
  return generation;
}

export function resolveAppGenerationProfile(
  app: WorkspaceApp,
): RendererGenerationProfile | undefined {
  const renderer = resolveWorkspaceRenderer(app);
  if (renderer === 'none') return undefined;
  const profile = getRendererGenerationProfile(renderer);
  const existing = app.rendererProfile;
  const selected = profile.profile;
  if (
    existing &&
    (existing.renderer !== selected.renderer ||
      existing.protocolVersion !== selected.protocolVersion ||
      existing.compiler.name !== selected.compiler.name ||
      existing.compiler.version !== selected.compiler.version ||
      existing.hydration.name !== selected.hydration.name ||
      existing.hydration.version !== selected.hydration.version ||
      existing.router.name !== selected.router.name ||
      existing.router.version !== selected.router.version ||
      existing.router.coreName !== selected.router.coreName ||
      existing.router.coreVersion !== selected.router.coreVersion)
  ) {
    throw new Error(
      `Application ${app.id} renderer profile disagrees with the selected compiler/runtime/router tuple.`,
    );
  }
  return profile;
}

export function appSupportsFederation(app: WorkspaceApp): boolean {
  return resolveAppGenerationProfile(app)?.capabilities.federation ?? false;
}
