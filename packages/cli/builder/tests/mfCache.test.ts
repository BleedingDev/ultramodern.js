import { describe, expect, test } from '@rstest/core';
import {
  getRequestPathname,
  isMfManifestAsset,
  isMfRemoteEntryAsset,
  resolveMfAssetCacheHeaders,
} from '../../../server/core/src/plugins/mfCache';

describe('mf cache headers', () => {
  test('detects MF manifest assets', () => {
    expect(isMfManifestAsset('/mf-manifest.json')).toBe(true);
    expect(isMfManifestAsset('/mf-stats.json')).toBe(true);
    expect(isMfManifestAsset('/foo/bar.json')).toBe(false);
  });

  test('detects remoteEntry assets', () => {
    expect(isMfRemoteEntryAsset('/remoteEntry.js')).toBe(true);
    expect(isMfRemoteEntryAsset('/assets/remoteEntry.abc123.js')).toBe(true);
    expect(isMfRemoteEntryAsset('/assets/index.js')).toBe(false);
  });

  test('resolves strict no-cache headers for MF manifest endpoints', () => {
    const headers = resolveMfAssetCacheHeaders('/mf-manifest.json');
    expect(headers).toEqual({
      'cache-control': 'no-cache, no-store, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
    });
  });

  test('resolves revalidation cache policy for non-versioned remoteEntry', () => {
    const headers = resolveMfAssetCacheHeaders('/remoteEntry.js');
    expect(headers).toEqual({
      'cache-control': 'public, max-age=0, must-revalidate',
    });
  });

  test('resolves immutable cache policy for version-pinned remoteEntry', () => {
    const headers = resolveMfAssetCacheHeaders('/remoteEntry.js', {
      mfv: 'remote-v1',
    });
    expect(headers).toEqual({
      'cache-control': 'public, max-age=31536000, immutable',
    });
  });

  test('extracts pathname from full request URL', () => {
    expect(
      getRequestPathname('https://example.com/remoteEntry.js?mfv=remote-v1'),
    ).toBe('/remoteEntry.js');
  });
});
