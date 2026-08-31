import {
  createCloudflarePublicUrlEnv,
  createCloudflareWorkerName,
  createRemoteManifestEnv,
  remoteDependencyAlias,
  resolveRemoteRefs,
} from '../descriptors';
import type { WorkspaceApp } from '../types';
import { formatTsObjectLiteral } from './shared-config';

export function createModuleFederationRemoteUrlHelpers(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
  includeAppToolsImport = true,
): string {
  if (resolveRemoteRefs(app, remotes).length === 0) {
    return '';
  }

  const appToolsImport = includeAppToolsImport
    ? "import { getBuildConfigEnvironment } from '@modern-js/app-tools/config';\n\n"
    : '';

  return `${appToolsImport}const cloudflareDeployEnabled =
  getBuildConfigEnvironment('MODERNJS_DEPLOY') === 'cloudflare';
const cloudflareWorkersDevSubdomain =
  getBuildConfigEnvironment('ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN')?.trim();
const requireCloudflarePublicUrls =
  getBuildConfigEnvironment('ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS') === 'true';

const createRemoteManifestUrl = (options: {
  manifestEnv: string;
  mfName: string;
  port: number;
  publicUrlEnv: string;
  workerName: string;
}) => {
  const configuredManifest = getBuildConfigEnvironment(options.manifestEnv)?.trim();
  if (configuredManifest !== undefined && configuredManifest.length > 0) {
    return configuredManifest;
  }

  const configuredPublicUrl = getBuildConfigEnvironment(options.publicUrlEnv)?.trim();
  if (configuredPublicUrl !== undefined && configuredPublicUrl.length > 0) {
    return \`\${options.mfName}@\${configuredPublicUrl.replace(/\\/+$/u, '')}/mf-manifest.json\`;
  }

  if (
    cloudflareDeployEnabled &&
    cloudflareWorkersDevSubdomain !== undefined &&
    cloudflareWorkersDevSubdomain.length > 0
  ) {
    return \`\${options.mfName}@https://\${options.workerName}.\${cloudflareWorkersDevSubdomain}.workers.dev/mf-manifest.json\`;
  }

  if (cloudflareDeployEnabled && requireCloudflarePublicUrls) {
    throw new Error(
      \`Cloudflare deploy needs \${options.publicUrlEnv}, \${options.manifestEnv}, or ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN for remote \${options.mfName}.\`,
    );
  }

  return \`\${options.mfName}@http://localhost:\${options.port}/mf-manifest.json\`;
};

`;
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
