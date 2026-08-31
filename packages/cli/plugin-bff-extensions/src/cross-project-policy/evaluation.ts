import {
  type CrossProjectRequestObservation,
  evaluateCrossProjectPolicy,
  type NormalizedCrossProjectPolicy,
  resolveCrossProjectRequestObservation,
} from '@modern-js/bff-core/security/cross-project-policy';

export type ResolvedCrossProjectPolicy = NormalizedCrossProjectPolicy;

const DENIAL_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
} as const;

export const checkCrossProjectPolicyResponse = (
  headers: Record<string, unknown>,
  policy: ResolvedCrossProjectPolicy | undefined,
  observedRequest?: CrossProjectRequestObservation,
): Response | null => {
  if (!policy?.enabled) {
    return null;
  }

  const violation = evaluateCrossProjectPolicy(
    headers,
    policy,
    observedRequest,
  );
  if (!violation) {
    return null;
  }

  return new Response(
    JSON.stringify({
      code: violation.code,
      reason: violation.reason,
      message: violation.message,
    }),
    {
      status: violation.status,
      headers: DENIAL_HEADERS,
    },
  );
};

export const checkCrossProjectPolicyForRequest = (
  request: Request,
  policy: ResolvedCrossProjectPolicy | undefined,
): Response | null => {
  if (!policy?.enabled) {
    return null;
  }

  const requestTarget = {
    method: request.method,
    pathname: new URL(request.url).pathname,
  };
  const observedRequest = resolveCrossProjectRequestObservation(
    requestTarget,
    policy,
  ) ?? {
    method: requestTarget.method,
    routePath: requestTarget.pathname,
  };
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return checkCrossProjectPolicyResponse(headers, policy, observedRequest);
};
