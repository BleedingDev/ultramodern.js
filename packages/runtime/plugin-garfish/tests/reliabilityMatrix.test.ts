import { createHash } from 'crypto';
import {
  RuntimeCompatibilityError,
  validateRuntimeCompatibility,
} from '../src/runtime/compatibility';
import {
  emitErrorFallbackTelemetry,
  inferFallbackPhase,
  inferFallbackReason,
} from '../src/runtime/fallbackTelemetry';
import {
  enforceRemoteTrustPolicy,
  RemoteTrustPolicyError,
} from '../src/runtime/trust';
import type {
  ModulesInfo,
  RemoteTrustIssue,
} from '../src/runtime/useModuleApps';

describe('mf reliability matrix', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    rstest.restoreAllMocks();
  });

  test('digest mismatch fails fast and maps to runtime_incompatible fallback', () => {
    const apps = [
      {
        name: 'dashboard',
        entry: 'https://remote.example.com/dashboard/remoteEntry.js',
        runtimeDigest: 'remote-v2',
      },
    ] as ModulesInfo;

    let thrown: unknown;
    try {
      validateRuntimeCompatibility(apps, {
        policy: {
          hostDigest: 'host-v1',
          mode: 'strict',
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RuntimeCompatibilityError);
    expect(inferFallbackReason(thrown)).toBe('runtime_incompatible');
    expect(
      emitErrorFallbackTelemetry(
        {
          error: thrown,
          phase: inferFallbackPhase(thrown),
        },
        {
          emitConsole: false,
          emitWindowEvent: false,
          reportToServer: false,
          traceId: 'trace-digest-mismatch',
        },
      ),
    ).toMatchObject({
      reason: 'runtime_incompatible',
      phase: 'compatibility',
      code: 'MV_RUNTIME_INCOMPATIBLE',
      trustDecision: 'trusted',
      compatibilityDecision: 'incompatible',
      traceId: 'trace-digest-mismatch',
    });
  });

  test('integrity verification reports network failures', async () => {
    global.fetch = rstest
      .fn()
      .mockRejectedValue(new Error('network failed')) as typeof fetch;
    const payload = 'remote entry payload';
    const digest = createHash('sha256').update(payload).digest('base64');

    let thrown: unknown;
    try {
      await enforceRemoteTrustPolicy(
        [
          {
            name: 'dashboard',
            entry: 'https://remote.example.com/dashboard/remoteEntry.js',
            integrity: `sha256-${digest}`,
          },
        ] as ModulesInfo,
        {
          mode: 'strict',
          productionOnly: false,
          requireIntegrity: true,
          verifyIntegrity: true,
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RemoteTrustPolicyError);
    expect((thrown as RemoteTrustPolicyError).issue.reason).toBe(
      'integrity_fetch_failed',
    );
    expect(inferFallbackReason(thrown)).toBe('entry_load_failed');
    expect(inferFallbackPhase(thrown)).toBe('load');
    expect(
      emitErrorFallbackTelemetry(
        {
          error: thrown,
          phase: inferFallbackPhase(thrown),
        },
        {
          emitConsole: false,
          emitWindowEvent: false,
          reportToServer: false,
          traceId: 'trace-network-failure',
        },
      ),
    ).toMatchObject({
      reason: 'entry_load_failed',
      phase: 'load',
      code: 'MV_ENTRY_LOAD_FAILED',
      trustDecision: 'blocked',
      compatibilityDecision: 'unknown',
      traceId: 'trace-network-failure',
    });
  });

  test('integrity verification reports timeout failures', async () => {
    global.fetch = rstest.fn((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('timeout');
          (abortError as any).name = 'AbortError';
          reject(abortError);
        });
      });
    }) as typeof fetch;

    let thrown: unknown;
    try {
      await enforceRemoteTrustPolicy(
        [
          {
            name: 'dashboard',
            entry: 'https://remote.example.com/dashboard/remoteEntry.js',
            integrity: 'sha256-anyDigest==',
          },
        ] as ModulesInfo,
        {
          mode: 'strict',
          productionOnly: false,
          requireIntegrity: true,
          verifyIntegrity: true,
          integrityFetchTimeoutMs: 1,
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RemoteTrustPolicyError);
    expect((thrown as RemoteTrustPolicyError).issue.reason).toBe(
      'integrity_timeout',
    );
    expect(inferFallbackReason(thrown)).toBe('integrity_timeout');
    expect(
      emitErrorFallbackTelemetry(
        {
          error: thrown,
          phase: inferFallbackPhase(thrown),
        },
        {
          emitConsole: false,
          emitWindowEvent: false,
          reportToServer: false,
          traceId: 'trace-integrity-timeout',
        },
      ),
    ).toMatchObject({
      reason: 'integrity_timeout',
      phase: 'integrity',
      code: 'MV_INTEGRITY_TIMEOUT',
      trustDecision: 'blocked',
      compatibilityDecision: 'unknown',
      traceId: 'trace-integrity-timeout',
    });
  });

  test('strict origin isolation violation emits canonical blocked trust telemetry', async () => {
    let thrown: unknown;
    try {
      await enforceRemoteTrustPolicy(
        [
          {
            name: 'dashboard',
            entry: 'https://remote.example.com/dashboard/remoteEntry.js',
          },
        ] as ModulesInfo,
        {
          mode: 'strict',
          productionOnly: false,
          isolatedOrigins: {
            dashboard: 'https://isolated.example.com',
          },
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RemoteTrustPolicyError);
    expect(
      emitErrorFallbackTelemetry(
        {
          error: thrown,
          phase: inferFallbackPhase(thrown),
        },
        {
          emitConsole: false,
          emitWindowEvent: false,
          reportToServer: false,
          traceId: 'trace-origin-isolation',
        },
      ),
    ).toMatchObject({
      reason: 'origin_isolation_violation',
      phase: 'trust',
      code: 'MV_ORIGIN_ISOLATION_VIOLATION',
      trustDecision: 'blocked',
      compatibilityDecision: 'unknown',
      traceId: 'trace-origin-isolation',
    });
  });

  test('warn mode allows partial degradation while surfacing violations', async () => {
    const issues: RemoteTrustIssue[] = [];
    await expect(
      enforceRemoteTrustPolicy(
        [
          {
            name: 'dashboard',
            entry: 'https://bad-origin.example.com/dashboard/remoteEntry.js',
          },
          {
            name: 'table',
            entry: 'https://allowed-origin.example.com/table/remoteEntry.js',
          },
        ] as ModulesInfo,
        {
          mode: 'warn',
          productionOnly: false,
          allowedOrigins: ['https://allowed-origin.example.com'],
          onViolation: issue => {
            issues.push(issue);
          },
        },
      ),
    ).resolves.toBeUndefined();

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      appName: 'dashboard',
      reason: 'origin_not_allowed',
      origin: 'https://bad-origin.example.com',
    });
  });

  test('compatibility warn mode surfaces onIncompatible without throwing', () => {
    const issues: Array<{
      appName: string;
      hostDigest: string;
      remoteDigest?: string;
      reason: string;
    }> = [];

    expect(() => {
      validateRuntimeCompatibility(
        [
          {
            name: 'dashboard',
            entry: 'https://remote.example.com/dashboard/remoteEntry.js',
            runtimeDigest: 'remote-v2',
          },
        ] as ModulesInfo,
        {
          policy: {
            hostDigest: 'host-v1',
            mode: 'warn',
            onIncompatible: issue => {
              issues.push(issue);
            },
          },
        },
      );
    }).not.toThrow();

    expect(issues).toEqual([
      expect.objectContaining({
        appName: 'dashboard',
        hostDigest: 'host-v1',
        remoteDigest: 'remote-v2',
        reason: 'digest_mismatch',
      }),
    ]);
  });
});
