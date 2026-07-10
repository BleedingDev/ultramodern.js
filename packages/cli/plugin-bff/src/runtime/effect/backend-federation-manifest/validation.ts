// @effect-diagnostics asyncFunction:off extendsNativeError:off globalTimers:off newPromise:off strictBooleanExpressions:off

import {
  formatBackendFederationValidationErrors,
  validateBackendFederationManifest as validateBackendFederationManifestContract,
} from '@modern-js/utils/universal';
import {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
  type BackendFederatedEffectApiModule,
  type BackendFederationRemote,
} from '../backend-federation';
import {
  assertConsistentValue,
  assertManifestAdapter,
  assertVersionValue,
  BackendFederationManifestAdapterError,
} from './errors';
import {
  backendFederationMetadata,
  manifestDeliveryUnit,
  recordField,
  stringValue,
  versionBoundaryMetadata,
} from './metadata';
import type {
  BackendFederationManifest,
  BackendFederationVersionBoundaryExpectation,
} from './types';

function resolveExpectedBuildMarker(
  expected: BackendFederationVersionBoundaryExpectation,
) {
  if (
    expected.buildVersion !== undefined &&
    expected.buildMarker !== undefined &&
    expected.buildVersion !== expected.buildMarker
  ) {
    throw new BackendFederationManifestAdapterError(
      'version_mismatch',
      `[BFF][Effect] Backend federation expected buildVersion/buildMarker mismatch: buildVersion ${expected.buildVersion}, buildMarker ${expected.buildMarker}.`,
      undefined,
      {
        label: 'expected.buildVersion/buildMarker',
        expected: expected.buildVersion,
        received: expected.buildMarker,
      },
    );
  }

  // Intentionally no fallback to `buildVersion` here: this is only used to
  // compare against manifest `deliveryUnit.buildMarker`, which is a
  // separate, additive field. Callers that only pass `buildVersion` (the
  // pre-ADR-0019 expectation shape) must not be forced to also match a
  // delivery-unit build marker on the manifest.
  return expected.buildMarker;
}

export function validateBackendFederationManifest(
  manifest: BackendFederationManifest,
  expected: BackendFederationVersionBoundaryExpectation = {},
) {
  const expectedBuildMarker = resolveExpectedBuildMarker(expected);
  const backendFederation = backendFederationMetadata(manifest);
  assertManifestAdapter(
    backendFederation,
    'manifest_invalid',
    '[BFF][Effect] Backend federation manifest must declare backendFederation metadata.',
  );
  const manifestShape = validateBackendFederationManifestContract(manifest, {
    expectedContractVersion: false,
    expectedNodeAdapterVersion: false,
    validateDeliveryUnit: false,
  });
  assertManifestAdapter(
    manifestShape.ok,
    'manifest_invalid',
    `[BFF][Effect] Backend federation manifest schema invalid: ${formatBackendFederationValidationErrors(
      manifestShape.errors,
    )}.`,
  );

  assertManifestAdapter(
    backendFederation.runtimeFramework === 'effect',
    'strict_effect_required',
    '[BFF][Effect] Backend federation manifest must declare runtimeFramework: "effect".',
  );
  assertManifestAdapter(
    backendFederation.strictEffectApproach === true,
    'strict_effect_required',
    '[BFF][Effect] Backend federation manifest must declare strictEffectApproach: true.',
  );

  assertVersionValue(
    stringValue(backendFederation.contractVersion),
    expected.contractVersion ?? BACKEND_FEDERATION_CONTRACT_VERSION,
    'manifest contractVersion',
  );
  assertVersionValue(
    stringValue(backendFederation.nodeAdapterVersion),
    expected.nodeAdapterVersion ?? BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
    'manifest nodeAdapterVersion',
  );

  const boundary = versionBoundaryMetadata(manifest);
  assertVersionValue(
    stringValue(backendFederation.name) ??
      stringValue(manifest.name) ??
      stringValue(manifest.id),
    expected.remoteName,
    'manifest remoteName',
  );
  assertVersionValue(
    stringValue(boundary?.packageName),
    expected.packageName,
    'versionBoundary.packageName',
  );
  assertVersionValue(
    stringValue(boundary?.version),
    expected.version,
    'versionBoundary.version',
  );
  assertVersionValue(
    stringValue(boundary?.buildVersion),
    expected.buildVersion,
    'versionBoundary.buildVersion',
  );
  assertConsistentValue(
    stringValue(manifest.version),
    stringValue(boundary?.version),
    'manifest versionBoundary.version',
  );
  assertConsistentValue(
    stringValue(manifest.buildVersion),
    stringValue(boundary?.buildVersion),
    'manifest versionBoundary.buildVersion',
  );

  const deliveryUnit = manifestDeliveryUnit(backendFederation, boundary);
  assertConsistentValue(
    stringValue(deliveryUnit.boundary?.buildMarker),
    stringValue(boundary?.buildVersion),
    'versionBoundary.deliveryUnit.buildMarker vs versionBoundary.buildVersion',
  );
  assertConsistentValue(
    stringValue(deliveryUnit.top?.unitId),
    stringValue(deliveryUnit.boundary?.unitId),
    'backendFederation.deliveryUnit.unitId vs versionBoundary.deliveryUnit.unitId',
  );

  const manifestUnitId =
    stringValue(deliveryUnit.boundary?.unitId) ??
    stringValue(deliveryUnit.top?.unitId);
  assertVersionValue(manifestUnitId, expected.unitId, 'deliveryUnit.unitId');
  assertVersionValue(
    stringValue(deliveryUnit.boundary?.buildMarker),
    expectedBuildMarker,
    'deliveryUnit.buildMarker',
  );
}

export function validateLoadedBackendFederationContract(
  loaded: BackendFederatedEffectApiModule,
  manifest: BackendFederationManifest,
  remote: BackendFederationRemote,
) {
  const loadedContract = loaded.backendFederationContract;
  const backendFederation = backendFederationMetadata(manifest);
  const boundary = versionBoundaryMetadata(manifest);
  const compatibility = recordField(loadedContract, 'compatibility');

  assertManifestAdapter(
    compatibility,
    'version_mismatch',
    `[BFF][Effect] Backend federation expose ${remote.name}/${remote.expose?.replace(
      /^\.\//u,
      '',
    )} must declare compatibility metadata.`,
  );
  assertVersionValue(
    stringValue(loadedContract?.role),
    'microvertical-server',
    'expose role',
  );
  assertVersionValue(
    stringValue(loadedContract?.name),
    remote.name,
    'expose name',
  );
  assertVersionValue(
    stringValue(compatibility.contractVersion),
    stringValue(backendFederation?.contractVersion),
    'expose contractVersion',
  );
  assertVersionValue(
    stringValue(compatibility.nodeAdapterVersion),
    stringValue(backendFederation?.nodeAdapterVersion),
    'expose nodeAdapterVersion',
  );
  assertVersionValue(
    stringValue(compatibility.packageName),
    stringValue(boundary?.packageName),
    'expose packageName',
  );
  assertVersionValue(
    stringValue(compatibility.build),
    stringValue(boundary?.buildVersion),
    'expose buildVersion',
  );

  const deliveryUnit = manifestDeliveryUnit(backendFederation, boundary);
  const manifestUnitId =
    stringValue(deliveryUnit.boundary?.unitId) ??
    stringValue(deliveryUnit.top?.unitId);
  const manifestBuildMarker = stringValue(deliveryUnit.boundary?.buildMarker);

  // Only enforced when both sides declare the field: absence on either side
  // is a legacy manifest/expose and must stay backward compatible.
  assertConsistentValue(
    manifestUnitId,
    stringValue(compatibility.unitId),
    'deliveryUnit.unitId vs expose compatibility.unitId',
  );
  assertConsistentValue(
    manifestBuildMarker,
    stringValue(compatibility.build),
    'deliveryUnit.buildMarker vs expose compatibility.build',
  );
}

export function classifyLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('delivery-unit identity mismatch')) {
    return 'version_mismatch' as const;
  }

  if (
    message.includes('strictEffectApproach') ||
    message.includes('runtimeFramework')
  ) {
    return 'strict_effect_required' as const;
  }

  return 'remote_unavailable' as const;
}
