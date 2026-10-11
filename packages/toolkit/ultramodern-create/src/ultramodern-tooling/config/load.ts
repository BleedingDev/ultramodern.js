import path from 'node:path';
import { reconcileWorkspaceRendererIdentities } from '../../ultramodern-workspace/renderer-identity';
import { appSupportsFederation } from '../../ultramodern-workspace/renderer-profile';
import { readJsonObject } from './json';
import {
  normalizeWorkspaceInputs,
  type UltramodernWorkspaceInputs,
} from './normalize';

export function readUltramodernConfig(workspaceRoot = process.cwd()) {
  return readUltramodernWorkspaceInputs(workspaceRoot).config;
}

export function readUltramodernWorkspaceInputs(
  workspaceRoot = process.cwd(),
  inputs: Partial<UltramodernWorkspaceInputs> = {},
) {
  return normalizeWorkspaceInputs(workspaceRoot, {
    topology:
      inputs.topology ??
      readJsonObject(
        path.join(workspaceRoot, 'topology/reference-topology.json'),
      ),
    overlay:
      inputs.overlay ??
      readJsonObject(
        path.join(workspaceRoot, 'topology/local-overlays/development.json'),
      ),
  });
}

/** Resolve application selection after the pure membership/path checks. */
export async function readResolvedUltramodernWorkspaceInputs(
  workspaceRoot = process.cwd(),
  inputs: Partial<UltramodernWorkspaceInputs> = {},
  options: Parameters<typeof reconcileWorkspaceRendererIdentities>[3] = {},
) {
  const workspace = readUltramodernWorkspaceInputs(workspaceRoot, inputs);
  const apps = await reconcileWorkspaceRendererIdentities(
    workspaceRoot,
    workspace.config.workspace.packageScope,
    workspace.apps,
    options,
  );
  return {
    ...workspace,
    apps,
    primaryShell: apps[0],
    verticals: apps.filter(app => app.kind === 'vertical'),
    additionalShells: apps.filter(
      (app, index) => index > 0 && app.kind === 'shell',
    ),
    config: {
      ...workspace.config,
      topology: {
        apps: workspace.config.topology.apps.map((entry, index) => {
          const { moduleFederation, ...projection } = entry;
          const app = apps[index];
          return {
            ...projection,
            deliveryUnit: app.deliveryUnit,
            renderer: app.renderer,
            rendererIdentity: app.rendererIdentity,
            rendererIdentities: app.rendererIdentities,
            rendererProfile: app.rendererProfile,
            routerBindings: app.routerBindings,
            rendererCapabilities: app.rendererCapabilities,
            ...(appSupportsFederation(app) ? { moduleFederation } : {}),
          };
        }),
      },
    },
  };
}
