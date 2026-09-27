import {
  type BrowserManifestAddressOptions,
  resolveBrowserManifestAddress,
} from '@modern-js/surface-resolution';
import { resolveDeployTarget } from '../deploy-output/target';
import { getBuildConfigEnvironment } from './build-environment';

/** Adapt build environment leases and MF's name@URL syntax to discovery policy. */
export function createRemoteManifestUrl(
  options: BrowserManifestAddressOptions,
): string {
  const env: Record<string, string | undefined> = {
    ...Object.fromEntries(
      [
        options.manifestEnv,
        options.publicUrlEnv,
        'ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN',
      ].map(name => [name, getBuildConfigEnvironment(name)]),
    ),
    MODERNJS_DEPLOY: resolveDeployTarget().target,
  };
  const address = resolveBrowserManifestAddress(
    env,
    options,
    getBuildConfigEnvironment('NODE_ENV') ?? 'production',
  );
  if (!address.ok)
    throw new Error(`Remote ${options.mfName}: ${address.reason}`);
  return (
    env[options.manifestEnv]?.trim() ||
    `${options.mfName}@${address.manifestUrl}`
  );
}
