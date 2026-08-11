import { BACKEND_FEDERATION_EFFECT_EXPOSE } from '@modern-js/utils/universal';
import * as Effect from 'effect/Effect';
import * as Logger from 'effect/Logger';

import {
  type BackendFederationExpectedIdentity,
  formatBackendFederationIdentityIssues,
  validateExpectedBackendFederationIdentity,
} from './identity';
import { createBackendFederationRuntime } from './runtime';
import type {
  BackendFederatedEffectApiModule,
  BackendFederationIdentityLoadOptions,
  BackendFederationLoadOptions,
} from './types';
import { isRecord, normalizeExpose } from './utils';

const LEGACY_LOAD_WARNING =
  '[BFF][Effect] loadBackendFederatedEffectApi was called without an expected delivery-unit identity (expected.unitId + expected.buildMarker). Identity-less public backend loads are deprecated (ADR-0019/MV-G23) and will be rejected in a future major.';
const legacyWarningLogger = Logger.withLeveledConsole(Logger.formatLogFmt);

function warnLegacyLoad() {
  Effect.runSync(
    Effect.provideService(
      Effect.logWarning(LEGACY_LOAD_WARNING),
      Logger.CurrentLoggers,
      new Set([legacyWarningLogger]),
    ),
  );
}

/**
 * Load a federated Effect API with mandatory delivery-unit identity
 * validation (MV-G23): the loaded expose's compatibility metadata must match
 * `expected.unitId` + `expected.buildMarker`.
 */
export function loadBackendFederatedEffectApi(
  options: BackendFederationIdentityLoadOptions,
): Promise<BackendFederatedEffectApiModule>;
/**
 * @deprecated Pass `expected` (delivery-unit `unitId` + `buildMarker`).
 * Loads without an expected identity cannot be validated against a resolved
 * delivery-unit record and emit a runtime warning.
 */
export function loadBackendFederatedEffectApi(
  options: BackendFederationLoadOptions,
): Promise<BackendFederatedEffectApiModule>;
export function loadBackendFederatedEffectApi(
  options: BackendFederationLoadOptions & {
    expected?: BackendFederationExpectedIdentity;
    allowMissingIdentityMetadata?: boolean;
  },
): Promise<BackendFederatedEffectApiModule> {
  const remoteName = options.remote?.name ?? options.remoteName;
  if (remoteName === undefined || remoteName.length === 0) {
    return Promise.reject(
      new Error('[BFF][Effect] Missing backend federation remote name.'),
    );
  }

  if (options.expected === undefined) {
    warnLegacyLoad();
  }

  const runtime = options.runtime ?? createBackendFederationRuntime(options);
  const expose =
    options.expose ??
    options.remote?.expose ??
    BACKEND_FEDERATION_EFFECT_EXPOSE;
  const remoteRequest = `${remoteName}/${normalizeExpose(expose)}`;
  return runtime.loadRemote(remoteRequest).then(loaded => {
    if (!isRecord(loaded)) {
      throw new Error(
        `[BFF][Effect] Backend federation expose ${remoteRequest} must load an object module.`,
      );
    }

    const backendContract = loaded.backendFederationContract;
    if (
      !isRecord(backendContract) ||
      backendContract.strictEffectApproach !== true
    ) {
      throw new Error(
        `[BFF][Effect] Backend federation expose ${remoteRequest} must expose strict Effect metadata (strictEffectApproach: true).`,
      );
    }

    if (backendContract.runtimeFramework !== 'effect') {
      throw new Error(
        `[BFF][Effect] Backend federation expose ${remoteRequest} must expose strict Effect metadata (runtimeFramework: "effect").`,
      );
    }

    if (
      typeof backendContract.name === 'string' &&
      backendContract.name !== remoteName
    ) {
      throw new Error(
        `[BFF][Effect] Backend federation expose ${remoteRequest} metadata name mismatch: expected ${remoteName}, received ${backendContract.name}.`,
      );
    }

    if (!('runtime' in loaded)) {
      throw new Error(
        `[BFF][Effect] Backend federation expose ${remoteRequest} must expose api and runtime.`,
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
          `[BFF][Effect] Backend federation expose ${remoteRequest} delivery-unit identity mismatch: ${formatBackendFederationIdentityIssues(issues)}.`,
        );
      }
    }

    return loaded;
  });
}
