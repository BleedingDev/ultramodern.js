import {
  createCloudflarePublicUrlEnv,
  createCloudflareWorkerName,
  createRemoteManifestEnv,
  remoteDependencyAlias,
  resolveRemoteRefs,
} from '../descriptors';
import type { WorkspaceApp } from '../types';

export function createModuleFederationRemoteUrlHelpers(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
  includeAppToolsImport = true,
): string {
  if (resolveRemoteRefs(app, remotes).length === 0) {
    return '';
  }

  return includeAppToolsImport
    ? "import { createRemoteManifestUrl } from '@modern-js/app-tools-extensions/config';\n\n"
    : '';
}

export function createModuleFederationRemotesConfig(
  scope: string,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): string {
  const remoteEntries = resolveRemoteRefs(app, remotes)
    .toSorted((left, right) =>
      remoteDependencyAlias(left).localeCompare(remoteDependencyAlias(right)),
    )
    .map(remote => {
      const key = remoteDependencyAlias(remote);
      return `    ${key}: createRemoteManifestUrl({
      manifestEnv: '${createRemoteManifestEnv(remote)}',
      mfName: '${remote.mfName}',
      port: ${remote.port},
      publicUrlEnv: '${createCloudflarePublicUrlEnv(remote)}',
      workerName: '${createCloudflareWorkerName(scope, remote)}',
    }),`;
    })
    .join('\n');

  if (!remoteEntries) {
    return '';
  }

  return `  remotes: {
${remoteEntries}
  },
`;
}
