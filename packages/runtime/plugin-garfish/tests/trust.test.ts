import { createHash } from 'crypto';
import type { ModulesInfo, RemoteTrustIssue } from '../src/runtime';
import {
  enforceRemoteTrustPolicy,
  RemoteTrustPolicyError,
} from '../src/runtime/trust';

describe('remote trust policy', () => {
  const baseApps = [
    {
      name: 'dashboard',
      entry: 'https://remote.example.com/dashboard/remoteEntry.js',
    },
  ] as ModulesInfo;

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    rstest.restoreAllMocks();
  });

  test('strict mode fails when origin is not allowlisted', async () => {
    await expect(
      enforceRemoteTrustPolicy(baseApps, {
        mode: 'strict',
        productionOnly: false,
        allowedOrigins: ['https://allowed.example.com'],
      }),
    ).rejects.toThrow(RemoteTrustPolicyError);
  });

  test('warn mode reports trust violations without throwing', async () => {
    const issues: RemoteTrustIssue[] = [];
    await expect(
      enforceRemoteTrustPolicy(baseApps, {
        mode: 'warn',
        productionOnly: false,
        allowedOrigins: ['https://allowed.example.com'],
        onViolation: issue => {
          issues.push(issue);
        },
      }),
    ).resolves.toBeUndefined();

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      appName: 'dashboard',
      reason: 'origin_not_allowed',
      origin: 'https://remote.example.com',
    });
  });

  test('strict mode fails when origin isolation policy is violated', async () => {
    await expect(
      enforceRemoteTrustPolicy(baseApps, {
        mode: 'strict',
        productionOnly: false,
        isolatedOrigins: {
          dashboard: 'https://isolated.example.com',
        },
      }),
    ).rejects.toThrow(RemoteTrustPolicyError);
  });

  test('strict mode fails when single-origin isolation is violated', async () => {
    await expect(
      enforceRemoteTrustPolicy(
        [
          ...baseApps,
          {
            name: 'table',
            entry: 'https://other-origin.example.com/table/remoteEntry.js',
          },
        ] as ModulesInfo,
        {
          mode: 'strict',
          productionOnly: false,
          singleOriginIsolation: true,
        },
      ),
    ).rejects.toThrow(RemoteTrustPolicyError);
  });

  test('strict mode fails when integrity metadata is required and missing', async () => {
    await expect(
      enforceRemoteTrustPolicy(baseApps, {
        mode: 'strict',
        productionOnly: false,
        requireIntegrity: true,
      }),
    ).rejects.toThrow(RemoteTrustPolicyError);
  });

  test('strict mode fails when attestation metadata is required and missing', async () => {
    await expect(
      enforceRemoteTrustPolicy(baseApps, {
        mode: 'strict',
        productionOnly: false,
        requireAttestation: true,
      }),
    ).rejects.toThrow(RemoteTrustPolicyError);
  });

  test('strict mode fails when attestation does not match expected token', async () => {
    await expect(
      enforceRemoteTrustPolicy(
        [
          {
            ...baseApps[0],
            runtimeMetadata: {
              attestation: 'attest-v1',
            },
          },
        ] as ModulesInfo,
        {
          mode: 'strict',
          productionOnly: false,
          attestations: {
            dashboard: 'attest-v2',
          },
        },
      ),
    ).rejects.toThrow(RemoteTrustPolicyError);
  });

  test('strict mode accepts matching attestation token', async () => {
    await expect(
      enforceRemoteTrustPolicy(
        [
          {
            ...baseApps[0],
            runtimeMetadata: {
              attestation: 'attest-v1',
            },
          },
        ] as ModulesInfo,
        {
          mode: 'strict',
          productionOnly: false,
          attestations: {
            dashboard: 'attest-v1',
          },
        },
      ),
    ).resolves.toBeUndefined();
  });

  test('strict mode fails when integrity digest does not match remote artifact', async () => {
    global.fetch = rstest.fn().mockResolvedValue({
      ok: true,
      text: async () => 'remote entry payload',
    } as Response) as typeof fetch;

    await expect(
      enforceRemoteTrustPolicy(
        [
          {
            ...baseApps[0],
            integrity: 'sha256-invalidDigest==',
          },
        ],
        {
          mode: 'strict',
          productionOnly: false,
          requireIntegrity: true,
          verifyIntegrity: true,
        },
      ),
    ).rejects.toThrow(RemoteTrustPolicyError);
  });

  test('strict mode accepts verified SRI integrity metadata', async () => {
    const payload = 'remote entry payload';
    const digest = createHash('sha256').update(payload).digest('base64');
    global.fetch = rstest.fn().mockResolvedValue({
      ok: true,
      text: async () => payload,
    } as Response) as typeof fetch;

    await expect(
      enforceRemoteTrustPolicy(
        [
          {
            ...baseApps[0],
            runtimeMetadata: {
              integrity: `sha256-${digest}`,
            },
          },
        ],
        {
          mode: 'strict',
          productionOnly: false,
          requireIntegrity: true,
          verifyIntegrity: true,
        },
      ),
    ).resolves.toBeUndefined();
  });
});
