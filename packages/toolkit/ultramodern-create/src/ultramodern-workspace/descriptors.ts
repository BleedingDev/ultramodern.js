import { WORKSPACE_PACKAGE_VERSION } from '../ultramodern-package-source';
import {
  packageName,
  toCamelCase,
  toEnvSegment,
  toKebabCase,
  toPascalCase,
} from './naming';
import type {
  Ownership,
  VerticalApiProtocol,
  VerticalPreset,
  WorkspaceApi,
  WorkspaceApp,
} from './types';

export const ULTRAMODERN_CONFIG_PATH = '.modernjs/ultramodern.json';

export function distributedSsrExposes(app: WorkspaceApp) {
  return Object.keys(app.exposes ?? {})
    .filter(expose => expose !== './Route')
    .toSorted();
}

export function distributedSsrFragmentSlug(expose: string) {
  const slug = toKebabCase(expose.replace(/^\.\//u, ''));
  if (!slug) {
    throw new Error(`Invalid distributed SSR expose ${expose}.`);
  }
  return slug;
}

export function distributedSsrFragmentRoute(expose: string) {
  return `/{locale}/_mf/fragment/${distributedSsrFragmentSlug(expose)}`;
}

export const shellApp: WorkspaceApp = {
  id: 'shell-super-app',
  directory: 'apps/shell-super-app',
  packageSuffix: 'shell-super-app',
  displayName: 'Shell Super App',
  kind: 'shell',
  portEnv: 'SHELL_SUPER_APP_PORT',
  port: 3020,
  mfName: 'shellSuperApp',
  verticalRefs: [],
  ownership: {
    team: 'super-app-platform',
    slack: '#super-app-platform',
    pagerDuty: 'pd-super-app-platform',
    runbookRef: 'runbooks/wave2/shell-super-app.md',
    adrRef:
      'docs/super-app-rfc-adr/wave2/reference-topology.md#shell-super-app',
    blastRadius: {
      tier: 'tier-0-shell',
      references: [
        'docs/super-app-rfc-adr/wave2/blast-radius.md#shell',
        'docs/super-app-rfc-adr/wave2/rollback.md#shell-lkg',
      ],
    },
  },
};

export function createShellHost(
  remotes: WorkspaceApp[] = [],
  // The shell composes only UI-emitting remotes by default (G2a); an explicit
  // verticalRefs list (G28 multi-shell) overrides it verbatim.
  verticalRefs = remotes.filter(appEmitsBrowserUi).map(remote => remote.id),
): WorkspaceApp {
  return {
    ...shellApp,
    verticalRefs,
  };
}

export const sharedPackages = [
  {
    id: 'shared-contracts',
    directory: 'packages/shared-contracts',
    description: 'Generated route, ownership, and topology contracts.',
  },
  {
    id: 'shared-design-tokens',
    directory: 'packages/shared-design-tokens',
    description: 'Generated design tokens consumed by shell and verticals.',
  },
];

export function createNeutralOwnership(
  id: string,
  tier = 'tier-2-vertical',
): Ownership {
  return {
    team: 'super-app-platform',
    slack: '#super-app-platform',
    pagerDuty: 'pd-super-app-platform',
    runbookRef: `runbooks/verticals/${id}.md`,
    adrRef: `docs/super-app-rfc-adr/verticals.md#${id}`,
    blastRadius: {
      tier,
      references: [`docs/super-app-rfc-adr/blast-radius.md#${id}`],
    },
  };
}

export type CreateVerticalDescriptorOptions = {
  /** Generation preset (G2a). Defaults to `full-stack`. */
  preset?: VerticalPreset;
  /** API protocol (G7a). Defaults to `rest`. */
  apiProtocol?: VerticalApiProtocol;
  /** Generate a Horizontal Remote delivery unit (G2H) instead of a vertical. */
  horizontalRemote?: boolean;
};

export function createVerticalDescriptor(
  name: string,
  port: number,
  options: CreateVerticalDescriptorOptions = {},
): WorkspaceApp {
  const horizontalRemote = options.horizontalRemote ?? false;
  // A Horizontal Remote is a components-only delivery unit: it forces a UI-only
  // surface set (no API) regardless of any requested preset.
  const preset: VerticalPreset = horizontalRemote
    ? 'ui-only'
    : (options.preset ?? 'full-stack');
  const apiProtocol: VerticalApiProtocol = options.apiProtocol ?? 'rest';
  const emitsUi = preset !== 'api-only';
  const emitsApi = preset !== 'ui-only';

  const domain = toKebabCase(name);
  const id = domain;
  const displayPrefix = toPascalCase(domain).replace(
    /([a-z])([A-Z])/g,
    '$1 $2',
  );
  return {
    id,
    directory: `verticals/${domain}`,
    packageSuffix: domain,
    displayName: `${displayPrefix} Vertical`,
    kind: 'vertical',
    domain,
    portEnv: `VERTICAL_${toEnvSegment(domain)}_PORT`,
    port,
    mfName: `vertical${toPascalCase(domain)}`,
    ...(emitsUi
      ? {
          exposes: {
            './Route': './src/federation-entry.tsx',
            './Widget': `./src/components/${domain}-widget.tsx`,
          },
        }
      : {}),
    ...(emitsApi
      ? {
          api: {
            stem: domain,
            prefix: `/${domain}-api`,
            consumedBy: [shellApp.id, id],
            // Omit `protocol` for the legacy REST default so byte-identical
            // output is preserved; only `rpc` is recorded.
            ...(apiProtocol !== 'rest' ? { protocol: apiProtocol } : {}),
          },
        }
      : {}),
    // Omit `surfaceProfile` for `full-stack` so default descriptors are
    // byte-identical to the legacy shape.
    ...(preset !== 'full-stack' ? { surfaceProfile: preset } : {}),
    ...(horizontalRemote
      ? { deliveryUnitKind: 'horizontal-remote' as const }
      : {}),
    ownership: createNeutralOwnership(id),
  };
}

export function appHasApi(app: WorkspaceApp): app is WorkspaceApp & {
  api: WorkspaceApi;
} {
  return app.api !== undefined;
}

/**
 * Whether an app emits browser/UI artifacts (routes, page/layout, public-web
 * surfaces, Tailwind, browser Module Federation). True for the shell and for
 * `full-stack` / `ui-only` verticals; false only for an `api-only` (headless)
 * vertical (G2a).
 */
export function appEmitsBrowserUi(app: WorkspaceApp): boolean {
  return app.surfaceProfile !== 'api-only';
}

/** The API protocol for an app's API surface (G7a). Defaults to `rest`. */
export function resolveApiProtocol(app: WorkspaceApp): VerticalApiProtocol {
  return app.api?.protocol ?? 'rest';
}

export function resolveApiPrefix(target: { id: string; api?: WorkspaceApi }) {
  return target.api?.prefix ?? `/${toKebabCase(target.id)}-api`;
}

export function resolveApiStem(target: { id: string; api?: WorkspaceApi }) {
  return target.api?.stem ?? toKebabCase(target.id).replace(/-api$/, '');
}

export function verticalApiApps(remotes: WorkspaceApp[] = []) {
  return remotes.filter(appHasApi);
}

export function remoteDependencyAlias(remote: WorkspaceApp): string {
  return toCamelCase(remote.domain ?? remote.id.replace(/^remote-/, ''));
}

export function zephyrRemoteDependency(
  scope: string,
  remote: WorkspaceApp,
): string {
  return `${packageName(scope, remote.packageSuffix)}@workspace:*`;
}

export function resolveRemoteRefs(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): WorkspaceApp[] {
  const verticalRefs = app.verticalRefs ?? [];
  const remotesById = new Map(remotes.map(remote => [remote.id, remote]));

  return verticalRefs.map(remoteRef => {
    const remote = remotesById.get(remoteRef);

    if (remote === undefined) {
      const availableRemotes = remotes.map(remote => remote.id).join(', ');

      throw new Error(
        `Unknown remote vertical reference ${remoteRef} for ${app.id}. Available remotes: ${
          availableRemotes || 'none'
        }.`,
      );
    }

    return remote;
  });
}

export function createRemoteManifestEnv(remote: WorkspaceApp): string {
  return `VERTICAL_${toEnvSegment(remote.domain ?? remote.id)}_MF_MANIFEST`;
}

export function createBackendFederationManifestEnv(
  remote: WorkspaceApp,
): string {
  return `VERTICAL_${toEnvSegment(
    remote.domain ?? remote.id,
  )}_BACKEND_MF_MANIFEST`;
}

export function createBackendFederationName(app: WorkspaceApp): string {
  return `${app.mfName}Backend`;
}

export function createBackendFederationManifestUrl(app: WorkspaceApp): string {
  return `http://localhost:${app.port}/backend-mf-manifest.json`;
}

export function createBackendFederationContainerEntry(
  app: WorkspaceApp,
): string {
  return `http://localhost:${app.port}/backendRemoteEntry.cjs`;
}

export function createModuleFederationRemoteContracts(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
) {
  return resolveRemoteRefs(app, remotes).map(remote => ({
    id: remote.id,
    alias: remoteDependencyAlias(remote),
    name: remote.mfName,
    manifestEnv: createRemoteManifestEnv(remote),
    manifestUrl: `http://localhost:${remote.port}/mf-manifest.json`,
  }));
}

export function createCloudflareWorkerName(
  scope: string,
  app: WorkspaceApp,
): string {
  return toKebabCase(`${scope}-${app.packageSuffix}`).slice(0, 63);
}

export function createCloudflarePublicUrlEnv(app: WorkspaceApp): string {
  return `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`;
}

export function appI18nNamespace(app: WorkspaceApp): string {
  return app.kind === 'shell' ? 'shell' : (app.domain ?? app.id);
}
