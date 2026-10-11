import { createBuildMarker } from './delivery-unit';
import {
  getRendererGenerationProfile,
  resolveWorkspaceRenderer,
} from './renderer-profile';
import type {
  ApplicationRenderer,
  WorkspaceApp,
  WorkspaceRendererIdentity,
} from './types';

/** Stamp one entry using its resolved profile and router binding. */
export function createRendererEntryIdentity(
  scope: string,
  app: WorkspaceApp,
  renderer: ApplicationRenderer,
  entryName: string,
  version: string,
): WorkspaceRendererIdentity {
  const identity: WorkspaceRendererIdentity = {
    renderer,
    appId: app.id,
    entryName,
    protocolVersion: 1,
    buildId: '',
  };
  return {
    ...identity,
    buildId: createBuildMarker(
      scope,
      { ...app, rendererIdentity: identity },
      version,
    ),
  };
}

/** Identity for a new source template. Existing applications use config loading. */
export function initializeGeneratedRendererIdentity(
  scope: string,
  app: WorkspaceApp,
  version = '0.1.0',
): WorkspaceApp {
  const renderer = resolveWorkspaceRenderer(app);
  if (renderer === 'none') return { ...app, renderer };
  const generation = getRendererGenerationProfile(renderer);
  const initialized: WorkspaceApp = {
    ...app,
    renderer,
    rendererProfile: generation.profile,
    rendererGenerationProfile: generation,
    rendererCapabilities: { ...generation.capabilities },
  };
  const identity = createRendererEntryIdentity(
    scope,
    initialized,
    renderer,
    renderer === 'react' ? 'index' : 'main',
    version,
  );
  initialized.rendererIdentity = identity;
  initialized.rendererIdentities = {
    [identity.entryName]: identity,
  };
  initialized.deliveryUnit = {
    ...app.deliveryUnit,
    version,
    buildMarker: identity.buildId,
  };
  return initialized;
}
