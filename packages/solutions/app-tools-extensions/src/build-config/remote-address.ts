import {
  type BrowserManifestAddressOptions,
  resolveBrowserManifestAddress,
} from '@modern-js/surface-resolution';
import { getBuildConfigEnvironment } from './build-environment';

/** Adapt build environment leases and MF's name@URL syntax to discovery policy. */
export function createRemoteManifestUrl(
  options: BrowserManifestAddressOptions,
): string {
  const env = Object.fromEntries(
    [
      options.manifestEnv,
      options.publicUrlEnv,
      'MODERNJS_DEPLOY',
      'ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN',
      'ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS',
    ].map(name => [name, getBuildConfigEnvironment(name)]),
  );
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
