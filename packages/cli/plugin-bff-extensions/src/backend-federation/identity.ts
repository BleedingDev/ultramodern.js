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

/** Decode independently at each received-manifest / executed-expose boundary. */
export function backendFederationCompatibility(loaded: unknown) {
  const contract = isRecord(loaded)
    ? loaded.backendFederationContract
    : undefined;
  const compatibility = isRecord(contract) ? contract.compatibility : undefined;
  return isRecord(compatibility) ? compatibility : undefined;
}

export function validateBackendFederationCompatibility(
  compatibility: Record<string, unknown>,
  expected: Record<string, string | undefined>,
): BackendFederationIdentityIssue[] {
  return Object.entries(expected).flatMap(([field, value]) =>
    value === undefined ||
    (typeof compatibility[field] === 'string' &&
      compatibility[field].length > 0 &&
      compatibility[field] === value)
      ? []
      : [
          {
            path: `backendFederationContract.compatibility.${field}`,
            message: `expected ${value}, received ${typeof compatibility[field] === 'string' ? compatibility[field] : typeof compatibility[field]}`,
          },
        ],
  );
}

export function validateExpectedBackendFederationIdentity(
  loaded: unknown,
  expected: BackendFederationExpectedIdentity,
): BackendFederationIdentityIssue[] {
  const compatibility = backendFederationCompatibility(loaded);
  return compatibility
    ? validateBackendFederationCompatibility(compatibility, {
        unitId: expected.unitId,
        build: expected.buildMarker,
      })
    : [
        {
          path: 'backendFederationContract.compatibility',
          message:
            'loaded module declares no compatibility metadata; delivery-unit identity cannot be validated',
        },
      ];
}

export function formatBackendFederationIdentityIssues(
  issues: BackendFederationIdentityIssue[],
): string {
  return issues.map(issue => `${issue.path}: ${issue.message}`).join('; ');
}
