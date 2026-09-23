import { ULTRAMODERN_WORKSPACE_MODERN_PACKAGES } from '../ultramodern-package-source';
import {
  appEmitsBrowserUi,
  appHasApi,
  createShellHost,
  sharedPackages,
} from './descriptors';
import { packageName } from './naming';
import type { WorkspaceApp } from './types';

/** Inputs needed by lightweight validation; authored files remain authoritative. */
export function createWorkspaceValidationContract(
  scope: string,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
  additionalShells: WorkspaceApp[] = [],
  primaryShell: WorkspaceApp = createShellHost(remotes),
) {
  const apps = [primaryShell, ...additionalShells, ...remotes];
  return {
    packageScope: scope,
    tailwindEnabled: enableTailwind,
    modernPackages: [...ULTRAMODERN_WORKSPACE_MODERN_PACKAGES],
    apps: apps.map(app => ({
      id: app.id,
      kind: app.kind,
      path: app.directory,
      packageName: packageName(scope, app.packageSuffix),
      emitsApi: appHasApi(app),
      emitsUi: appEmitsBrowserUi(app),
      exposes: app.exposes ?? {},
      verticalRefs: app.verticalRefs ?? [],
    })),
    sharedPackages: sharedPackages.map(pkg => ({
      id: pkg.id,
      path: pkg.directory,
      packageName: packageName(scope, pkg.id),
    })),
    structuralShellPolicy: {
      schemaVersion: 1,
      shells: apps
        .filter(app => app.kind === 'shell')
        .map(app => ({
          id: app.id,
          packageDir: app.directory,
          srcDir: `${app.directory}/src`,
        })),
      forbiddenPathClasses: [
        {
          id: 'shell-api-surface',
          path: 'api',
          diagnostic: 'A thin Shell must not own an API surface.',
        },
        {
          id: 'shell-server-surface',
          path: 'server',
          diagnostic: 'A thin Shell must not own a server surface.',
        },
        {
          id: 'shell-backend-federation',
          path: 'backend-federation.config.ts',
          diagnostic: 'A thin Shell must not own backend federation.',
        },
      ],
    },
    federatedCompositionPolicy: {
      schemaVersion: 1,
      hosts: apps
        .filter(app => (app.verticalRefs?.length ?? 0) > 0)
        .map(app => ({
          id: app.id,
          srcDir: `${app.directory}/src`,
          remotes: (app.verticalRefs ?? []).map(id => {
            const remote = remotes.find(candidate => candidate.id === id);
            if (!remote)
              throw new Error(
                `Unknown remote vertical reference ${id} for ${app.id}.`,
              );
            return {
              id,
              directory: remote.directory,
              packageName: packageName(scope, remote.packageSuffix),
            };
          }),
        })),
    },
  };
}
