import { createBuildMarker } from './delivery-unit';
import {
  getRendererGenerationProfile,
  resolveWorkspaceRenderer,
} from './renderer-profile';
import type { WorkspaceApp } from './types';

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
    rendererIdentity: {
      renderer,
      appId: app.id,
      entryName: renderer === 'react' ? 'index' : 'main',
      protocolVersion: 1,
      buildId: '',
    },
  };
  const buildId = createBuildMarker(scope, initialized, version);
  initialized.rendererIdentity!.buildId = buildId;
  initialized.rendererIdentities = {
    [initialized.rendererIdentity!.entryName]: initialized.rendererIdentity!,
  };
  initialized.deliveryUnit = {
    ...app.deliveryUnit,
    version,
    buildMarker: buildId,
  };
  return initialized;
}
