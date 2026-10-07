import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import {
  createRendererBuildManifest,
  RENDERER_BUILD_MANIFEST_FILE,
  readRendererBuildManifest,
  rendererBuildCachePerformance,
  validateRendererBuildManifest,
  writeRendererBuildManifest,
} from '../../src/native-composition/native-build-manifest';
import {
  type RendererBuildProfile,
  resolveRendererProfile,
} from '../../src/native-composition/renderer-profile';

function identities(renderer: 'react' | 'solid') {
  const profile = resolveRendererProfile(renderer);
  const provider = {
    ...profile.router,
    framework: renderer === 'react' ? ('tanstack' as const) : renderer,
  };
  return {
    profile,
    built: {
      buildId: 'a'.repeat(64),
      profileKey: 'b'.repeat(64),
      sourceRevision: 'workspace',
      identities: {
        main: {
          renderer,
          appId: 'checkout',
          entryName: 'main',
          protocolVersion: 1 as const,
          buildId: 'a'.repeat(64),
        },
      },
      routerBindings: {
        main: {
          owner: `@fixture/${renderer}-router`,
          evidence: 'file-routes' as const,
          defaultProvider: provider,
          providers: [provider] satisfies [typeof provider],
        },
      },
    },
  };
}

function temporaryDist() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-build-manifest-'));
}

describe('renderer-build.json', () => {
  it('records renderer, profile, router bindings, buildId and entries', async () => {
    const { profile, built } = identities('solid');
    const dist = temporaryDist();
    try {
      await writeRendererBuildManifest(
        dist,
        createRendererBuildManifest(profile, built),
      );
      const written = JSON.parse(
        fs.readFileSync(path.join(dist, RENDERER_BUILD_MANIFEST_FILE), 'utf8'),
      );
      expect(Object.keys(written).sort()).toEqual([
        'buildId',
        'entries',
        'profile',
        'renderer',
        'routerBindings',
        'schema',
        'sourceRevision',
        'version',
      ]);
      const read = await readRendererBuildManifest(dist, profile);
      expect(read.renderer).toBe('solid');
      expect(read.entries.main).toEqual(built.identities.main);
    } finally {
      fs.rmSync(dist, { recursive: true, force: true });
    }
  });

  it('rejects a stale build at serve after the renderer was switched', async () => {
    const { profile, built } = identities('solid');
    const dist = temporaryDist();
    try {
      await writeRendererBuildManifest(
        dist,
        createRendererBuildManifest(profile, built),
      );
      await expect(
        readRendererBuildManifest(dist, resolveRendererProfile('react')),
      ).rejects.toThrow(
        'made for the solid renderer, but the configuration selects react; rebuild',
      );
    } finally {
      fs.rmSync(dist, { recursive: true, force: true });
    }
  });

  it('rejects a build made with another installed renderer profile', () => {
    const { profile, built } = identities('solid');
    const manifest = createRendererBuildManifest(profile, built);
    const upgraded: RendererBuildProfile = {
      ...profile,
      compiler: { ...profile.compiler, version: '999.0.0' },
    };
    expect(() =>
      validateRendererBuildManifest(
        JSON.parse(JSON.stringify(manifest)),
        upgraded,
      ),
    ).toThrow(/different solid renderer profile.*rebuild/u);
  });

  it('rejects a missing build with a build-first message', async () => {
    const dist = temporaryDist();
    try {
      await expect(
        readRendererBuildManifest(dist, resolveRendererProfile('solid')),
      ).rejects.toThrow('build the application first');
    } finally {
      fs.rmSync(dist, { recursive: true, force: true });
    }
  });

  it('rejects entries whose buildId disagrees with the build', () => {
    const { profile, built } = identities('solid');
    const manifest = JSON.parse(
      JSON.stringify(createRendererBuildManifest(profile, built)),
    );
    manifest.entries.main.buildId = 'c'.repeat(64);
    expect(() => validateRendererBuildManifest(manifest, profile)).toThrow(
      'conflicts with its build',
    );
  });
});

describe('persistent build cache', () => {
  it('is always on and keyed by renderer and profile', () => {
    const solid = rendererBuildCachePerformance(
      undefined,
      'solid',
      resolveRendererProfile('solid'),
    );
    const react = rendererBuildCachePerformance(
      undefined,
      'react',
      resolveRendererProfile('react'),
    );
    const solidDigest = (solid.buildCache as { cacheDigest: unknown[] })
      .cacheDigest;
    expect(solidDigest).toHaveLength(2);
    expect(solidDigest[0]).toBe('solid');
    expect(
      (react.buildCache as { cacheDigest: unknown[] }).cacheDigest,
    ).not.toEqual(solidDigest);
  });

  it('keeps authored cache options and an explicit opt-out', () => {
    const profile = resolveRendererProfile('solid');
    expect(
      rendererBuildCachePerformance(
        { buildCache: { cacheDigest: ['authored'] } },
        'solid',
        profile,
      ).buildCache,
    ).toEqual({
      cacheDigest: [
        'authored',
        'solid',
        (
          rendererBuildCachePerformance(undefined, 'solid', profile)
            .buildCache as { cacheDigest: unknown[] }
        ).cacheDigest[1],
      ],
    });
    expect(
      rendererBuildCachePerformance({ buildCache: false }, 'solid', profile)
        .buildCache,
    ).toBe(false);
    expect(
      rendererBuildCachePerformance(undefined, 'solid', profile, false)
        .buildCache,
    ).toBeUndefined();
    expect(
      (
        rendererBuildCachePerformance(
          { buildCache: { cacheDigest: [] } },
          'solid',
          profile,
          false,
        ).buildCache as { cacheDigest: unknown[] }
      ).cacheDigest[0],
    ).toBe('solid');
  });
});
