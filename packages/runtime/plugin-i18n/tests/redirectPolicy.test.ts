import { describe, expect, test } from '@rstest/core';
import { shouldIgnoreRedirect as shouldIgnoreRuntimeRedirect } from '../src/runtime/utils';
import {
  isStaticResourceRequest,
  shouldIgnoreRedirect as shouldIgnoreServerRedirect,
} from '../src/server/redirectPolicy';

const languages = ['en', 'cs'];

const defaultSkippedPaths = [
  '/backend-mf-manifest.json',
  '/backendRemoteEntry.cjs',
  '/mf-manifest.json',
  '/mf-stats.json',
  '/remoteEntry.js',
  '/static/app.js',
  '/upload/avatar.png',
];

describe('locale redirect default skip policy', () => {
  test('skips ADR-0002 Module Federation and static endpoints on the server', () => {
    for (const pathname of defaultSkippedPaths) {
      expect(isStaticResourceRequest(pathname, [], languages)).toBe(true);
      expect(shouldIgnoreServerRedirect(pathname, '/', undefined)).toBe(true);
    }
  });

  test('skips language-prefixed static and upload endpoints', () => {
    expect(isStaticResourceRequest('/cs/static/app.js', [], languages)).toBe(
      true,
    );
    expect(
      isStaticResourceRequest('/en/upload/avatar.png', [], languages),
    ).toBe(true);
  });

  test('uses the same default skip policy in runtime redirects', () => {
    for (const pathname of defaultSkippedPaths) {
      expect(shouldIgnoreRuntimeRedirect(pathname, languages)).toBe(true);
      expect(shouldIgnoreRuntimeRedirect(`/cs${pathname}`, languages)).toBe(
        true,
      );
    }
  });
});
