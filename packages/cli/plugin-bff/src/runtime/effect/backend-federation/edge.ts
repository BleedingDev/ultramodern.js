import type { BackendFederationExpectedIdentity } from './identity';
import { loadBackendFederatedEffectApi as loadUniversalBackendFederatedEffectApi } from './load';
import type {
  BackendFederatedEffectApiModule,
  BackendFederationIdentityLoadOptions,
  BackendFederationLoadOptions,
} from './types';

type EdgeBackendFederationLoadOptions = Omit<
  BackendFederationLoadOptions,
  'entryPolicy' | 'runtime'
> & {
  entryPolicy?: never;
  runtime?: never;
};

type EdgeBackendFederationIdentityLoadOptions = Omit<
  BackendFederationIdentityLoadOptions,
  'entryPolicy' | 'runtime'
> & {
  entryPolicy?: never;
  runtime?: never;
};

const isStaticBindingEntry = (entry: string) =>
  /^(?:binding|service|static):/u.test(entry);

export function loadBackendFederatedEffectApi(
  options: EdgeBackendFederationIdentityLoadOptions,
): Promise<BackendFederatedEffectApiModule>;
/** @deprecated Pass `expected` delivery-unit identity. */
export function loadBackendFederatedEffectApi(
  options: EdgeBackendFederationLoadOptions,
): Promise<BackendFederatedEffectApiModule>;
export function loadBackendFederatedEffectApi(
  options: EdgeBackendFederationLoadOptions & {
    expected?: BackendFederationExpectedIdentity;
    allowMissingIdentityMetadata?: boolean;
  },
): Promise<BackendFederatedEffectApiModule> {
  if (
    (options as BackendFederationLoadOptions).runtime !== undefined ||
    (options as BackendFederationLoadOptions).entryPolicy !== undefined
  ) {
    return Promise.reject(
      new Error(
        '[BFF][Effect] Edge backend federation does not execute custom runtimes or entry evaluators. Register a static or service-binding entry provider.',
      ),
    );
  }
  const remotes = [
    ...(options.remotes ?? []),
    ...(options.remote ? [options.remote] : []),
  ];
  const unsupportedRemote = remotes.find(
    remote => !isStaticBindingEntry(remote.entry),
  );
  if (unsupportedRemote !== undefined) {
    return Promise.reject(
      new Error(
        `[BFF][Effect] Edge backend federation remote ${unsupportedRemote.name} must use static or service-binding entries.`,
      ),
    );
  }
  return loadUniversalBackendFederatedEffectApi(options);
}
