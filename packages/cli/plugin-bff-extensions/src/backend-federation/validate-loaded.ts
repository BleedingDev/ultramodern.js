import type { BackendFederationExpectedIdentity } from './identity';
import {
  formatBackendFederationIdentityIssues,
  validateExpectedBackendFederationIdentity,
} from './identity';
import type { BackendFederatedEffectApiModule } from './types';
import { isRecord } from './utils';

export function validateLoadedBackendFederatedEffectApi(
  loaded: unknown,
  options: {
    allowMissingIdentityMetadata?: boolean;
    expected?: BackendFederationExpectedIdentity;
    remoteName: string;
    remoteRequest: string;
  },
): BackendFederatedEffectApiModule {
  if (!isRecord(loaded)) {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${options.remoteRequest} must load an object module.`,
    );
  }

  const backendContract = loaded.backendFederationContract;
  if (
    !isRecord(backendContract) ||
    backendContract.strictEffectApproach !== true
  ) {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${options.remoteRequest} must expose strict Effect metadata (strictEffectApproach: true).`,
    );
  }

  if (backendContract.runtimeFramework !== 'effect') {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${options.remoteRequest} must expose strict Effect metadata (runtimeFramework: "effect").`,
    );
  }

  if (
    typeof backendContract.name === 'string' &&
    backendContract.name !== options.remoteName
  ) {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${options.remoteRequest} metadata name mismatch: expected ${options.remoteName}, received ${backendContract.name}.`,
    );
  }

  if (!('runtime' in loaded)) {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${options.remoteRequest} must expose runtime.`,
    );
  }

  if (options.expected !== undefined) {
    const issues = validateExpectedBackendFederationIdentity(
      loaded,
      options.expected,
      {
        allowMissingIdentityMetadata:
          options.allowMissingIdentityMetadata === true,
      },
    );
    if (issues.length > 0) {
      throw new Error(
        `[BFF][Effect] Backend federation expose ${options.remoteRequest} delivery-unit identity mismatch: ${formatBackendFederationIdentityIssues(issues)}.`,
      );
    }
  }

  return loaded as BackendFederatedEffectApiModule;
}
