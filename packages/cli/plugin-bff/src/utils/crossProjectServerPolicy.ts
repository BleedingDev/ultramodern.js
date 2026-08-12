// @effect-diagnostics nodeBuiltinImport:off strictBooleanExpressions:off
/**
 * Server-side cross-project policy wiring shared by the hono and effect BFF
 * runtime adapters.
 *
 * The generated cross-project SDK force-enables `bff.crossProjectPolicy`
 * (see `crossProjectApiPlugin`), so producer servers MUST actually evaluate
 * it: this module resolves the policy once per adapter (deriving the
 * operation-contract map and the producer operation version from the app's
 * package.json major) and exposes a request check both adapters call before
 * dispatching API handlers.
 *
 * The envelope/operation-context headers are client-asserted; see the threat
 * model in `@modern-js/bff-core` `security/crossProjectPolicy.ts`. Operators
 * Production namespace allowlists require `verifyProducerIdentity` to bind
 * the namespace to a verified channel; without it, only non-production keeps
 * the advisory client-asserted allowlist path.
 */
import {
  checkCrossProjectPolicy,
  deriveOperationVersion,
  type OperationContractSource,
  type ResolvedCrossProjectPolicy,
  resolveCrossProjectPolicy,
} from '@modern-js/bff-core';
import type { ServerPluginAPI } from '@modern-js/server-core';
import path from 'path';

import { toHeaderRecord } from './headers';

export type { ResolvedCrossProjectPolicy };

/**
 * Reads the version of the nearest package.json at or above `startDir`.
 *
 * Cross-project servers host the producer's compiled API from
 * `node_modules/<sdk>/dist/api`, so the producer contract version must come
 * from the SDK package — the same package whose version stamped the
 * generated client — not from the consumer app.
 */
const readNearestPackageVersion = (
  startDir: string | undefined,
): string | undefined => {
  if (!startDir) {
    return undefined;
  }
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      const packageJson = require(path.join(current, 'package.json')) as {
        version?: string;
      };
      if (typeof packageJson.version === 'string') {
        return packageJson.version;
      }
    } catch {
      // keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
  return undefined;
};

/**
 * Resolves the effective cross-project policy for a BFF runtime adapter.
 * Returns `undefined` when no policy is configured and the server is not a
 * generated cross-project producer (no middleware should be installed).
 */
export const resolveAdapterCrossProjectPolicy = (
  api: ServerPluginAPI,
  handlers: OperationContractSource[],
): ResolvedCrossProjectPolicy | undefined => {
  const bff = api.getServerConfig()?.bff;
  const { apiDirectory, appDirectory } = api.getServerContext() as {
    apiDirectory?: string;
    appDirectory?: string;
  };

  return resolveCrossProjectPolicy({
    crossProjectPolicy: bff?.crossProjectPolicy,
    handlers,
    requestId: bff?.requestId,
    isCrossProjectServer: bff?.isCrossProjectServer,
    operationVersion: deriveOperationVersion(
      readNearestPackageVersion(apiDirectory) ??
        readNearestPackageVersion(appDirectory),
    ),
  });
};

const DENIAL_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
} as const;

/**
 * Evaluates the policy against a header record and returns the denial
 * Response every adapter must send, or `null` when the request passes.
 */
export const checkCrossProjectPolicyResponse = (
  headers: Record<string, unknown>,
  policy: ResolvedCrossProjectPolicy | undefined,
): Response | null => {
  if (!policy?.enabled) {
    return null;
  }
  const denial = checkCrossProjectPolicy(headers, policy);
  if (!denial) {
    return null;
  }
  return new Response(JSON.stringify(denial.body), {
    status: denial.status,
    headers: DENIAL_HEADERS,
  });
};

/**
 * Adapts the policy check to a WHATWG `Request` (effect lane seam): returns
 * the denial Response or `null`.
 */
export const checkCrossProjectPolicyForRequest = (
  request: Request,
  policy: ResolvedCrossProjectPolicy | undefined,
): Response | null => {
  if (!policy?.enabled) {
    return null;
  }
  return checkCrossProjectPolicyResponse(
    toHeaderRecord(request.headers),
    policy,
  );
};
