import type { ModulesInfo, RuntimeCompatibilityIssue } from '../src/runtime';
import {
  RuntimeCompatibilityError,
  validateRuntimeCompatibility,
} from '../src/runtime/compatibility';

describe('runtime compatibility handshake', () => {
  const apps = [
    {
      name: 'dashboard',
      entry: 'https://mf.example.com/dashboard/remoteEntry.js',
    },
  ] as ModulesInfo;

  test('defaults to strict hard-fail mode when host digest is configured', () => {
    expect(() => {
      validateRuntimeCompatibility(apps, {
        policy: {
          hostDigest: 'host-v1',
        },
      });
    }).toThrow(RuntimeCompatibilityError);
  });

  test('throws RuntimeCompatibilityError on digest mismatch', () => {
    expect(() => {
      validateRuntimeCompatibility(
        [
          {
            ...apps[0],
            runtimeDigest: 'remote-v2',
          },
        ],
        {
          policy: {
            hostDigest: 'host-v1',
            mode: 'strict',
          },
        },
      );
    }).toThrow(RuntimeCompatibilityError);
  });

  test('uses manifest digest fallback for app records without digest', () => {
    expect(() => {
      validateRuntimeCompatibility(apps, {
        policy: {
          hostDigest: 'runtime-shared',
          mode: 'strict',
        },
        manifestRuntimeDigest: 'runtime-shared',
      });
    }).not.toThrow();
  });

  test('reads digest from runtimeMetadata when explicit digest is absent', () => {
    expect(() => {
      validateRuntimeCompatibility(
        [
          {
            ...apps[0],
            runtimeMetadata: {
              runtimeDigest: 'runtime-shared',
            },
          },
        ],
        {
          policy: {
            hostDigest: 'runtime-shared',
            mode: 'strict',
          },
        },
      );
    }).not.toThrow();
  });

  test('uses global manifest digest fallback for injected app records', () => {
    expect(() => {
      validateRuntimeCompatibility(apps, {
        policy: {
          hostDigest: 'runtime-shared',
          mode: 'strict',
        },
        globalRuntimeDigest: 'runtime-shared',
      });
    }).not.toThrow();
  });

  test('warn mode reports incompatibilities but does not throw', () => {
    const issues: RuntimeCompatibilityIssue[] = [];

    expect(() => {
      validateRuntimeCompatibility(
        [
          {
            ...apps[0],
            runtimeDigest: 'remote-v2',
          },
        ],
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

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      appName: 'dashboard',
      hostDigest: 'host-v1',
      remoteDigest: 'remote-v2',
      reason: 'digest_mismatch',
    });
  });

  test('off mode bypasses compatibility checks', () => {
    expect(() => {
      validateRuntimeCompatibility(
        [
          {
            ...apps[0],
            runtimeDigest: 'remote-v2',
          },
        ],
        {
          policy: {
            hostDigest: 'host-v1',
            mode: 'off',
          },
        },
      );
    }).not.toThrow();
  });
});
