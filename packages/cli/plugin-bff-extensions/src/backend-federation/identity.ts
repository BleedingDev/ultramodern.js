// @effect-diagnostics strictBooleanExpressions:off

import { isRecord } from './utils';

/**
 * Mandatory delivery-unit identity for public backend federation loads
 * (MV-G23, ADR-0019 / RESOLUTION-0001 §2.3): consumers pass the record's
 * `unitId` + `buildMarker` through to identity validation.
 */
export type BackendFederationExpectedIdentity = {
  unitId: string;
  buildMarker: string;
};

export type BackendFederationIdentityIssue = {
  path: string;
  message: string;
};

/**
 * Shared expected-identity validation for loaded backend federation modules.
 * Compares the expose's `backendFederationContract.compatibility` identity
 * (`unitId`, `build`) against the consumer's expected delivery-unit identity.
 * Missing identity metadata is an error: with an expectation present there is
 * no legacy escape hatch.
 */
export function validateExpectedBackendFederationIdentity(
  loaded: unknown,
  expected: BackendFederationExpectedIdentity,
  options: {
    /**
     * Tolerate exposes that declare no identity metadata (legacy modules).
     * Mismatching declared values still fail. Used by the manifest adapter,
     * whose manifest-side identity is already validated against `expected`;
     * the raw identity-aware loader is strict.
     */
    allowMissingIdentityMetadata?: boolean;
  } = {},
): BackendFederationIdentityIssue[] {
  const allowMissing = options.allowMissingIdentityMetadata === true;
  const issues: BackendFederationIdentityIssue[] = [];
  const contract = isRecord(loaded)
    ? loaded.backendFederationContract
    : undefined;
  const compatibility = isRecord(contract) ? contract.compatibility : undefined;

  if (!isRecord(compatibility)) {
    if (allowMissing) {
      return [];
    }
    return [
      {
        path: 'backendFederationContract.compatibility',
        message:
          'loaded module declares no compatibility metadata; delivery-unit identity cannot be validated',
      },
    ];
  }

  const unitId = compatibility.unitId;
  if (typeof unitId !== 'string' || unitId.length === 0) {
    if (!allowMissing) {
      issues.push({
        path: 'backendFederationContract.compatibility.unitId',
        message: `missing delivery-unit id; expected ${expected.unitId}`,
      });
    }
  } else if (unitId !== expected.unitId) {
    issues.push({
      path: 'backendFederationContract.compatibility.unitId',
      message: `expected ${expected.unitId}, received ${unitId}`,
    });
  }

  const build = compatibility.build;
  if (typeof build !== 'string' || build.length === 0) {
    if (!allowMissing) {
      issues.push({
        path: 'backendFederationContract.compatibility.build',
        message: `missing build marker; expected ${expected.buildMarker}`,
      });
    }
  } else if (build !== expected.buildMarker) {
    issues.push({
      path: 'backendFederationContract.compatibility.build',
      message: `expected ${expected.buildMarker}, received ${build}`,
    });
  }

  return issues;
}

export function formatBackendFederationIdentityIssues(
  issues: BackendFederationIdentityIssue[],
): string {
  return issues.map(issue => `${issue.path}: ${issue.message}`).join('; ');
}
