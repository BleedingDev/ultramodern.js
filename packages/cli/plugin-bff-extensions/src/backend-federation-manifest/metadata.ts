// @effect-diagnostics asyncFunction:off extendsNativeError:off globalTimers:off newPromise:off strictBooleanExpressions:off

import {
  backendFederationMetadata as sharedBackendFederationMetadata,
  backendFederationVersionBoundary as sharedBackendFederationVersionBoundary,
} from '@modern-js/utils/universal';
import type { BackendFederationManifest } from './types';

export function stringValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function recordField(
  value: Record<string, unknown> | undefined,
  field: string,
) {
  const fieldValue = value?.[field];
  return isRecord(fieldValue) ? fieldValue : undefined;
}

export function resolveRemoteEntryFromMetadata(
  manifest: BackendFederationManifest,
) {
  const metaData = recordField(manifest, 'metaData');
  const remoteEntry = recordField(metaData, 'remoteEntry');
  const publicPath =
    stringValue(metaData?.publicPath) ?? stringValue(metaData?.ssrPublicPath);
  const entryName = stringValue(remoteEntry?.name);

  if (!publicPath || !entryName) {
    return undefined;
  }

  const entryPath = stringValue(remoteEntry?.path) ?? '';
  const normalizedBase = publicPath.replace(/\/+$/u, '');
  const normalizedPath = entryPath.replace(/^\/+|\/+$/gu, '');

  return [normalizedBase, normalizedPath, entryName].filter(Boolean).join('/');
}

export function backendFederationMetadata(manifest: BackendFederationManifest) {
  return sharedBackendFederationMetadata(manifest);
}

export function versionBoundaryMetadata(manifest: BackendFederationManifest) {
  return sharedBackendFederationVersionBoundary(manifest);
}

export function deliveryUnitMetadata(
  record: Record<string, unknown> | undefined,
) {
  return recordField(record, 'deliveryUnit');
}

/**
 * Resolves the delivery-unit identity root for a manifest (ADR-0019 §3):
 * prefers `versionBoundary.deliveryUnit`, falls back to the top-level
 * `backendFederation.deliveryUnit` record. Both are additive/optional so
 * legacy manifests without delivery-unit metadata continue to validate.
 */
export function manifestDeliveryUnit(
  backendFederation: Record<string, unknown> | undefined,
  boundary: Record<string, unknown> | undefined,
) {
  return {
    boundary: deliveryUnitMetadata(boundary),
    top: deliveryUnitMetadata(backendFederation),
  };
}
