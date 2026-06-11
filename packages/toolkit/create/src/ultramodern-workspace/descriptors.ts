import { WORKSPACE_PACKAGE_VERSION } from '../ultramodern-package-source';
import {
  packageName,
  toCamelCase,
  toEnvSegment,
  toKebabCase,
  toPascalCase,
} from './naming';
import type { Ownership, WorkspaceApp, WorkspaceEffectApi } from './types';

export const GENERATED_CONTRACT_PATH =
  '.modernjs/ultramodern-generated-contract.json';

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

export function createShellHost(remotes: WorkspaceApp[] = []): WorkspaceApp {
  return {
    ...shellApp,
    verticalRefs: remotes.map(remote => remote.id),
  };
}

export const sharedPackages = [
  {
    id: 'shared-contracts',
    directory: 'packages/shared-contracts',
    description: 'Route, ownership, and topology contract placeholders.',
  },
  {
    id: 'shared-design-tokens',
    directory: 'packages/shared-design-tokens',
    description: 'Design token placeholders consumed by shell and verticals.',
  },
  {
    id: 'shared-effect-api',
    directory: 'packages/shared-effect-api',
    description: 'Shared Effect API type placeholders for vertical clients.',
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

export function createVerticalDescriptor(
  name: string,
  port: number,
): WorkspaceApp {
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
    exposes: {
      './Route': './src/federation-entry.tsx',
      './Widget': `./src/components/${domain}-widget.tsx`,
    },
    effectApi: {
      stem: domain,
      prefix: `/${domain}-api`,
      consumedBy: [shellApp.id, id],
    },
    ownership: createNeutralOwnership(id),
  };
}

export function appHasEffectApi(app: WorkspaceApp): app is WorkspaceApp & {
  effectApi: WorkspaceEffectApi;
} {
  return app.effectApi !== undefined;
}

export function effectApiPrefix(target: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return target.effectApi?.prefix ?? `/${toKebabCase(target.id)}-api`;
}

export function effectApiStem(target: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return target.effectApi?.stem ?? toKebabCase(target.id).replace(/-api$/, '');
}

export function verticalEffectApps(remotes: WorkspaceApp[] = []) {
  return remotes.filter(appHasEffectApi);
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

  return verticalRefs
    .map(remoteRef => remotes.find(remote => remote.id === remoteRef))
    .filter((remote): remote is WorkspaceApp => remote !== undefined);
}

export function createRemoteManifestEnv(remote: WorkspaceApp): string {
  return `VERTICAL_${toEnvSegment(remote.domain ?? remote.id)}_MF_MANIFEST`;
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
