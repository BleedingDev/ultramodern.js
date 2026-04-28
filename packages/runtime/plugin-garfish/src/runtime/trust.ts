import { logger } from '../util';
import type {
  ModuleInfo,
  ModulesInfo,
  RemoteTrustIssue,
  RemoteTrustMode,
  RemoteTrustPolicy,
} from './useModuleApps';

export class RemoteTrustPolicyError extends Error {
  code: string;

  issue: RemoteTrustIssue;

  constructor(issue: RemoteTrustIssue) {
    super(formatIssueMessage(issue));
    this.name = 'RemoteTrustPolicyError';
    this.issue = issue;
    this.code = getIssueCode(issue);
  }
}

function getIssueCode(issue: RemoteTrustIssue) {
  switch (issue.reason) {
    case 'origin_not_allowed':
      return 'MV_ORIGIN_NOT_ALLOWED';
    case 'origin_isolation_violation':
      return 'MV_ORIGIN_ISOLATION_VIOLATION';
    case 'integrity_missing':
      return 'MV_INTEGRITY_MISSING';
    case 'integrity_invalid_format':
    case 'integrity_mismatch':
      return 'MV_INTEGRITY_MISMATCH';
    case 'integrity_timeout':
    case 'integrity_verification_unavailable':
      return 'MV_INTEGRITY_TIMEOUT';
    case 'integrity_fetch_failed':
      return 'MV_ENTRY_LOAD_FAILED';
    case 'attestation_missing':
      return 'MV_ATTESTATION_MISSING';
    case 'attestation_mismatch':
      return 'MV_ATTESTATION_MISMATCH';
    default:
      return 'MV_UNKNOWN';
  }
}

function formatIssueMessage(issue: RemoteTrustIssue) {
  switch (issue.reason) {
    case 'origin_not_allowed':
      return `Remote trust policy failed for "${issue.appName}": origin "${issue.origin}" is not allowlisted`;
    case 'origin_isolation_violation':
      return `Remote trust policy failed for "${issue.appName}": origin "${issue.origin}" violates isolation requirement "${issue.expectedOrigin}"`;
    case 'integrity_missing':
      return `Remote trust policy failed for "${issue.appName}": integrity metadata is required but missing`;
    case 'integrity_invalid_format':
      return `Remote trust policy failed for "${issue.appName}": integrity value "${issue.expectedIntegrity}" is invalid`;
    case 'integrity_fetch_failed':
      return `Remote trust policy failed for "${issue.appName}": unable to fetch remote entry for integrity verification`;
    case 'integrity_timeout':
      return `Remote trust policy failed for "${issue.appName}": integrity verification timed out`;
    case 'integrity_verification_unavailable':
      return `Remote trust policy failed for "${issue.appName}": integrity verification API is unavailable`;
    case 'integrity_mismatch':
      return `Remote trust policy failed for "${issue.appName}": integrity mismatch (expected "${issue.expectedIntegrity}", got "${issue.actualIntegrity}")`;
    case 'attestation_missing':
      return `Remote trust policy failed for "${issue.appName}": attestation metadata is required but missing`;
    case 'attestation_mismatch':
      return `Remote trust policy failed for "${issue.appName}": attestation mismatch (expected "${issue.expectedAttestation}", got "${issue.actualAttestation}")`;
    default:
      return `Remote trust policy failed for "${issue.appName}"`;
  }
}

function resolveMode(mode?: RemoteTrustMode): RemoteTrustMode {
  return mode ?? 'strict';
}

function shouldEnforce(policy?: RemoteTrustPolicy) {
  if (!policy) {
    return false;
  }
  if (resolveMode(policy.mode) === 'off') {
    return false;
  }
  const productionOnly = policy.productionOnly ?? true;
  if (!productionOnly) {
    return true;
  }
  return process.env.NODE_ENV === 'production';
}

function reportIssue(issue: RemoteTrustIssue, policy: RemoteTrustPolicy) {
  policy.onViolation?.(issue);
  const mode = resolveMode(policy.mode);
  if (mode === 'warn') {
    logger('remote trust warning', issue);
    return;
  }

  if (mode === 'strict') {
    throw new RemoteTrustPolicyError(issue);
  }
}

function resolveEntryUrl(entry: string) {
  try {
    if (typeof window !== 'undefined' && window.location) {
      return new URL(entry, window.location.origin);
    }
    return new URL(entry);
  } catch (_error) {
    return undefined;
  }
}

function getAppIntegrity(app: ModuleInfo) {
  return app.integrity || app.runtimeMetadata?.integrity;
}

function getAppAttestation(app: ModuleInfo) {
  return app.attestation || app.runtimeMetadata?.attestation;
}

function parseIntegrity(integrity: string) {
  const token = integrity
    .trim()
    .split(/\s+/)
    .find(item => /^(sha256|sha384|sha512)-/i.test(item));

  if (!token) {
    return undefined;
  }

  const [algorithm, base64] = token.split('-', 2);
  if (!algorithm || !base64) {
    return undefined;
  }

  const normalizedAlgorithm = algorithm.toLowerCase();
  if (!['sha256', 'sha384', 'sha512'].includes(normalizedAlgorithm)) {
    return undefined;
  }

  return {
    algorithm: normalizedAlgorithm as 'sha256' | 'sha384' | 'sha512',
    expected: base64,
  };
}

async function getSubtleCrypto() {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }

  try {
    type SubtleCryptoLike = {
      digest: (
        algorithm: string,
        data: ArrayBuffer | ArrayBufferView,
      ) => Promise<ArrayBuffer>;
    };
    const nodeCrypto = (await import('crypto')) as {
      default?: {
        webcrypto?: {
          subtle?: SubtleCryptoLike;
        };
      };
      webcrypto?: {
        subtle?: SubtleCryptoLike;
      };
    };
    return (
      nodeCrypto.webcrypto?.subtle ?? nodeCrypto.default?.webcrypto?.subtle
    );
  } catch (_error) {
    return undefined;
  }
}

function toBase64(buffer: ArrayBuffer) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function encodeText(content: string) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(content);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(content);
  }

  return Uint8Array.from(content, ch => ch.charCodeAt(0));
}

async function verifyIntegrity(
  app: ModuleInfo,
  integrity: string,
  policy: RemoteTrustPolicy,
) {
  const parsedIntegrity = parseIntegrity(integrity);
  if (!parsedIntegrity) {
    reportIssue(
      {
        appName: app.name,
        entry: app.entry,
        expectedIntegrity: integrity,
        reason: 'integrity_invalid_format',
      },
      policy,
    );
    return;
  }

  const subtle = await getSubtleCrypto();
  if (!subtle) {
    reportIssue(
      {
        appName: app.name,
        entry: app.entry,
        expectedIntegrity: integrity,
        reason: 'integrity_verification_unavailable',
      },
      policy,
    );
    return;
  }

  let response: Response;
  try {
    if (policy.integrityFetchTimeoutMs && policy.integrityFetchTimeoutMs > 0) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, policy.integrityFetchTimeoutMs);

      try {
        response = await fetch(app.entry, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      response = await fetch(app.entry);
    }
  } catch (_error) {
    if (_error instanceof Error && _error.name === 'AbortError') {
      reportIssue(
        {
          appName: app.name,
          entry: app.entry,
          expectedIntegrity: integrity,
          reason: 'integrity_timeout',
        },
        policy,
      );
      return;
    }

    reportIssue(
      {
        appName: app.name,
        entry: app.entry,
        expectedIntegrity: integrity,
        reason: 'integrity_fetch_failed',
      },
      policy,
    );
    return;
  }

  if (!response.ok) {
    reportIssue(
      {
        appName: app.name,
        entry: app.entry,
        expectedIntegrity: integrity,
        reason: 'integrity_fetch_failed',
      },
      policy,
    );
    return;
  }

  const content = await response.text();
  const digestBuffer = await subtle.digest(
    parsedIntegrity.algorithm.replace('sha', 'SHA-'),
    encodeText(content),
  );
  const actualDigest = toBase64(digestBuffer);

  if (actualDigest !== parsedIntegrity.expected) {
    reportIssue(
      {
        appName: app.name,
        entry: app.entry,
        expectedIntegrity: integrity,
        actualIntegrity: `${parsedIntegrity.algorithm}-${actualDigest}`,
        reason: 'integrity_mismatch',
      },
      policy,
    );
  }
}

function validateOrigins(apps: ModulesInfo, policy: RemoteTrustPolicy) {
  if (!policy.allowedOrigins?.length) {
    return;
  }

  apps.forEach(app => {
    const resolved = resolveEntryUrl(app.entry);
    if (!resolved) {
      reportIssue(
        {
          appName: app.name,
          entry: app.entry,
          reason: 'origin_not_allowed',
        },
        policy,
      );
      return;
    }

    if (!policy.allowedOrigins?.includes(resolved.origin)) {
      reportIssue(
        {
          appName: app.name,
          entry: app.entry,
          origin: resolved.origin,
          reason: 'origin_not_allowed',
        },
        policy,
      );
    }
  });
}

function validateOriginIsolation(apps: ModulesInfo, policy: RemoteTrustPolicy) {
  const isolatedOrigins = policy.isolatedOrigins;
  if (isolatedOrigins) {
    apps.forEach(app => {
      const expectedOrigin = isolatedOrigins[app.name];
      if (!expectedOrigin) {
        return;
      }

      const resolved = resolveEntryUrl(app.entry);
      const origin = resolved?.origin;
      if (!origin || origin !== expectedOrigin) {
        reportIssue(
          {
            appName: app.name,
            entry: app.entry,
            origin,
            expectedOrigin,
            reason: 'origin_isolation_violation',
          },
          policy,
        );
      }
    });
  }

  if (!policy.singleOriginIsolation) {
    return;
  }

  let referenceOrigin: string | undefined;
  apps.forEach(app => {
    const resolved = resolveEntryUrl(app.entry);
    const origin = resolved?.origin;
    if (!origin) {
      reportIssue(
        {
          appName: app.name,
          entry: app.entry,
          reason: 'origin_isolation_violation',
        },
        policy,
      );
      return;
    }

    if (!referenceOrigin) {
      referenceOrigin = origin;
      return;
    }

    if (origin !== referenceOrigin) {
      reportIssue(
        {
          appName: app.name,
          entry: app.entry,
          origin,
          expectedOrigin: referenceOrigin,
          reason: 'origin_isolation_violation',
        },
        policy,
      );
    }
  });
}

function validateAttestations(apps: ModulesInfo, policy: RemoteTrustPolicy) {
  const expectedAttestations = policy.attestations || {};
  const shouldRequireAttestation =
    Boolean(policy.requireAttestation) ||
    Object.keys(expectedAttestations).length > 0;

  if (!shouldRequireAttestation) {
    return;
  }

  apps.forEach(app => {
    const actualAttestation = getAppAttestation(app);
    const expectedAttestation = expectedAttestations[app.name];

    if (!actualAttestation) {
      reportIssue(
        {
          appName: app.name,
          entry: app.entry,
          expectedAttestation,
          reason: 'attestation_missing',
        },
        policy,
      );
      return;
    }

    if (expectedAttestation && actualAttestation !== expectedAttestation) {
      reportIssue(
        {
          appName: app.name,
          entry: app.entry,
          expectedAttestation,
          actualAttestation,
          reason: 'attestation_mismatch',
        },
        policy,
      );
    }
  });
}

export async function enforceRemoteTrustPolicy(
  apps: ModulesInfo,
  policy?: RemoteTrustPolicy,
) {
  if (!shouldEnforce(policy) || !policy) {
    return;
  }

  validateOrigins(apps, policy);
  validateOriginIsolation(apps, policy);
  validateAttestations(apps, policy);

  const shouldRequireIntegrity = Boolean(policy.requireIntegrity);
  const shouldVerifyIntegrity =
    policy.verifyIntegrity ?? Boolean(policy.requireIntegrity);

  for (const app of apps) {
    const integrity = getAppIntegrity(app);
    if (!integrity) {
      if (!shouldRequireIntegrity) {
        continue;
      }
      reportIssue(
        {
          appName: app.name,
          entry: app.entry,
          reason: 'integrity_missing',
        },
        policy,
      );
      continue;
    }

    if (shouldVerifyIntegrity) {
      await verifyIntegrity(app, integrity, policy);
    }
  }
}
