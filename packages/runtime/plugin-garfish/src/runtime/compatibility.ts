import { logger } from '../util';
import type {
  ModuleInfo,
  ModulesInfo,
  RuntimeCompatibilityIssue,
  RuntimeCompatibilityMode,
  RuntimeCompatibilityPolicy,
} from './useModuleApps';

export class RuntimeCompatibilityError extends Error {
  code = 'MV_RUNTIME_INCOMPATIBLE';

  issue: RuntimeCompatibilityIssue;

  constructor(issue: RuntimeCompatibilityIssue) {
    super(formatIssueMessage(issue));
    this.name = 'RuntimeCompatibilityError';
    this.issue = issue;
  }
}

function formatIssueMessage(issue: RuntimeCompatibilityIssue) {
  if (issue.reason === 'missing_remote_digest') {
    return `Runtime compatibility handshake failed for "${issue.appName}": host digest "${issue.hostDigest}" requires a remote digest, but none was provided`;
  }
  return `Runtime compatibility handshake failed for "${issue.appName}": host digest "${issue.hostDigest}" does not match remote digest "${issue.remoteDigest}"`;
}

function resolveMode(
  mode?: RuntimeCompatibilityMode,
): RuntimeCompatibilityMode {
  return mode ?? 'strict';
}

function resolveRemoteDigest(
  app: ModuleInfo,
  manifestRuntimeDigest?: string,
  globalRuntimeDigest?: string,
) {
  return (
    app.runtimeDigest ||
    app.runtimeMetadata?.runtimeDigest ||
    manifestRuntimeDigest ||
    globalRuntimeDigest
  );
}

function reportIssue(
  issue: RuntimeCompatibilityIssue,
  policy: RuntimeCompatibilityPolicy,
) {
  policy.onIncompatible?.(issue);

  const mode = resolveMode(policy.mode);
  if (mode === 'warn') {
    logger('runtime compatibility warning', issue);
    return;
  }

  if (mode === 'strict') {
    throw new RuntimeCompatibilityError(issue);
  }
}

export function validateRuntimeCompatibility(
  apps: ModulesInfo,
  options: {
    policy?: RuntimeCompatibilityPolicy;
    manifestRuntimeDigest?: string;
    globalRuntimeDigest?: string;
  },
) {
  const { policy, manifestRuntimeDigest, globalRuntimeDigest } = options;
  if (!policy?.hostDigest || resolveMode(policy.mode) === 'off') {
    return;
  }

  const requireRemoteDigest =
    policy.requireRemoteDigest ?? resolveMode(policy.mode) === 'strict';

  apps.forEach(app => {
    const remoteDigest = resolveRemoteDigest(
      app,
      manifestRuntimeDigest,
      globalRuntimeDigest,
    );

    if (!remoteDigest) {
      if (!requireRemoteDigest) {
        return;
      }

      reportIssue(
        {
          appName: app.name,
          hostDigest: policy.hostDigest,
          reason: 'missing_remote_digest',
        },
        policy,
      );
      return;
    }

    if (remoteDigest !== policy.hostDigest) {
      reportIssue(
        {
          appName: app.name,
          hostDigest: policy.hostDigest,
          remoteDigest,
          reason: 'digest_mismatch',
        },
        policy,
      );
    }
  });
}
