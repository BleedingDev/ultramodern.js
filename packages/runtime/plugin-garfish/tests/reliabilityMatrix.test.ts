import { createHash } from 'crypto';
import type { ModulesInfo, RemoteTrustIssue } from '../src/runtime';
import { RuntimeCompatibilityError } from '../src/runtime';
import { validateRuntimeCompatibility } from '../src/runtime/compatibility';
import { inferFallbackReason } from '../src/runtime/fallbackTelemetry';
import {
  RemoteTrustPolicyError,
  enforceRemoteTrustPolicy,
} from '../src/runtime/trust';

describe('mf reliability matrix', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
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
  });

  test('integrity verification reports network failures', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network failed'));
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
    expect(inferFallbackReason(thrown)).toBe('integrity_fetch_failed');
  });

  test('integrity verification reports timeout failures', async () => {
    global.fetch = jest.fn((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('timeout');
          (abortError as any).name = 'AbortError';
          reject(abortError);
        });
      });
    }) as any;

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
});
