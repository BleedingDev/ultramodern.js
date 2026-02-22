import { applyMfEntryCachePolicy } from '../src/runtime/cachePolicy';
import type { ModulesInfo } from '../src/runtime/useModuleApps';

describe('mf cache policy', () => {
  test('pins remote entry URL with app runtime digest', () => {
    const apps = [
      {
        name: 'dashboard',
        entry: 'https://remote.example.com/remoteEntry.js',
        runtimeDigest: 'remote-v1',
      },
    ] as ModulesInfo;

    const output = applyMfEntryCachePolicy(apps);
    expect(output[0].entry).toBe(
      'https://remote.example.com/remoteEntry.js?mfv=remote-v1',
    );
  });

  test('keeps existing query params and appends mfv pin', () => {
    const apps = [
      {
        name: 'dashboard',
        entry: '/remoteEntry.js?lang=en',
        runtimeMetadata: {
          runtimeDigest: 'remote-v2',
        },
      },
    ] as ModulesInfo;

    const output = applyMfEntryCachePolicy(apps);
    expect(output[0].entry).toBe('/remoteEntry.js?lang=en&mfv=remote-v2');
  });

  test('uses manifest digest fallback when app digest is missing', () => {
    const apps = [
      {
        name: 'dashboard',
        entry: '/remoteEntry.js',
      },
    ] as ModulesInfo;

    const output = applyMfEntryCachePolicy(apps, {
      manifestRuntimeDigest: 'manifest-v1',
    });
    expect(output[0].entry).toBe('/remoteEntry.js?mfv=manifest-v1');
  });

  test('does not duplicate mfv query when already pinned', () => {
    const apps = [
      {
        name: 'dashboard',
        entry: '/remoteEntry.js?mfv=remote-v3',
        runtimeDigest: 'remote-v3',
      },
    ] as ModulesInfo;

    const output = applyMfEntryCachePolicy(apps);
    expect(output[0].entry).toBe('/remoteEntry.js?mfv=remote-v3');
  });
});
