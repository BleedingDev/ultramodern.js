import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import {
  assertRendererBuildInputsUnchanged,
  RENDERER_BUILD_MANIFEST_FILE,
  readRendererBuildManifest,
  validateRendererBuildManifest,
} from '../../src/native-composition/native-build-manifest';
import {
  resolveRendererProfile,
  resolveRendererRouterFrameworks,
} from '../../src/native-composition/renderer-profile';

function artifact() {
  return {
    schema: 'ultramodern-renderer-build',
    version: 1,
    profile: resolveRendererProfile('solid'),
    routerBindings: {
      main: {
        owner: '@modern-js/renderer-solid-infrastructure',
        evidence: 'owned-default',
        defaultProvider: {
          ...resolveRendererProfile('solid').router,
          framework: 'solid',
        },
        providers: [
          { ...resolveRendererProfile('solid').router, framework: 'solid' },
        ],
      },
    },
    buildMarker: 'a'.repeat(64),
    sourceRevision: 'app-commit-proof',
    inputDigest: 'b'.repeat(64),
    profileDigest: 'c'.repeat(64),
    compilerDigest: 'd'.repeat(64),
    frameworkCohortDigest: 'e'.repeat(64),
    cacheAllowed: true,
    promotable: true,
    identities: {
      main: {
        renderer: 'solid',
        appId: 'checkout',
        entryName: 'main',
        protocolVersion: 1,
        buildId: 'a'.repeat(64),
      },
    },
  };
}

describe('immutable native build evidence', () => {
  it('requires router ownership for every built entry and rejects undeclared entries', () => {
    const { routerBindings, ...missing } = artifact();
    expect(() =>
      validateRendererBuildManifest(missing, resolveRendererProfile('solid')),
    ).toThrow('router bindings');
    expect(() =>
      validateRendererBuildManifest(
        { ...artifact(), routerBindings: {} },
        resolveRendererProfile('solid'),
      ),
    ).toThrow('router bindings');
    expect(() =>
      validateRendererBuildManifest(
        {
          ...artifact(),
          routerBindings: { ...routerBindings, extra: routerBindings.main },
        },
        resolveRendererProfile('solid'),
      ),
    ).toThrow('not an expected entry');
  });

  it('freezes an isolated router ownership map instead of retaining authored objects', () => {
    const built = artifact();
    const validated = validateRendererBuildManifest(
      built,
      resolveRendererProfile('solid'),
    );
    built.routerBindings.main.owner = 'changed-source';
    expect(validated.routerBindings.main.owner).toBe(
      '@modern-js/renderer-solid-infrastructure',
    );
    expect(Object.isFrozen(validated.routerBindings)).toBe(true);
    expect(Object.isFrozen(validated.routerBindings.main.providers)).toBe(true);
    expect(Object.isFrozen(validated.routerBindings.main.defaultProvider)).toBe(
      true,
    );
  });

  it('accepts well-formed router evidence and applies an explicit selected owner policy', () => {
    const built = artifact();
    const provider = {
      ...resolveRendererProfile('octane').router,
      framework: 'octane',
    };
    const conflicting = {
      ...built,
      routerBindings: {
        main: {
          owner: '@modern-js/renderer-octane-infrastructure',
          evidence: 'owned-default',
          defaultProvider: provider,
          providers: [provider],
        },
      },
    };
    const validated = validateRendererBuildManifest(
      conflicting,
      resolveRendererProfile('solid'),
    );
    expect(validated.identities).toEqual(built.identities);
    expect(validated.routerBindings).toEqual(conflicting.routerBindings);
    expect(() =>
      validateRendererBuildManifest(
        conflicting,
        resolveRendererProfile('solid'),
        { routerFrameworks: resolveRendererRouterFrameworks('solid') },
      ),
    ).toThrow('must be admitted by the selected router owner.');
  });
  it.each([
    'buildMarker',
    'sourceRevision',
    'inputDigest',
    'profileDigest',
    'compilerDigest',
    'frameworkCohortDigest',
    'cacheAllowed',
    'promotable',
    'identities',
    'routerBindings',
  ] as const)('rejects an input change during compilation: %s', key => {
    const initial = validateRendererBuildManifest(
      artifact(),
      resolveRendererProfile('solid'),
    );
    const current = structuredClone(initial);
    Object.assign(current, {
      [key]:
        key === 'identities' || key === 'routerBindings'
          ? {}
          : typeof initial[key] === 'boolean'
            ? !initial[key]
            : 'changed',
    });
    expect(() => assertRendererBuildInputsUnchanged(initial, current)).toThrow(
      `changed during compilation (${key})`,
    );
    expect(() =>
      assertRendererBuildInputsUnchanged(initial, structuredClone(initial)),
    ).not.toThrow();
  });
  it('reports every changed fingerprint while retaining the first fatal input field', () => {
    const initial = validateRendererBuildManifest(
      artifact(),
      resolveRendererProfile('solid'),
    );
    const current = {
      ...initial,
      buildMarker: 'f'.repeat(64),
      inputDigest: '0'.repeat(64),
      compilerDigest: '1'.repeat(64),
    };
    let failure: unknown;
    try {
      assertRendererBuildInputsUnchanged(initial, current);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error))
      throw new Error('The changed build fingerprints must reject');
    expect(failure.message).toContain(
      'changed during compilation (buildMarker)',
    );
    expect(failure.message).toContain(
      `inputDigest: expected="${initial.inputDigest}", actual="${current.inputDigest}"`,
    );
    expect(failure.message).toContain(
      `compilerDigest: expected="${initial.compilerDigest}", actual="${current.compilerDigest}"`,
    );
    expect(failure.message).not.toContain('profileDigest:');
    expect(() =>
      assertRendererBuildInputsUnchanged(initial, structuredClone(initial)),
    ).not.toThrow();
  });
  it('loads the actual built identity without replacing it from current app source', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'um-renderer-manifest-'),
    );
    try {
      const built = artifact();
      fs.writeFileSync(
        path.join(root, RENDERER_BUILD_MANIFEST_FILE),
        JSON.stringify(built),
      );
      fs.writeFileSync(
        path.join(root, 'App.tsx'),
        'export default "changed-after-build";',
      );
      const loaded = await readRendererBuildManifest(
        root,
        resolveRendererProfile('solid'),
      );
      expect(loaded.identities.main.buildId).toBe(built.buildMarker);
      expect(loaded.sourceRevision).toBe('app-commit-proof');
      expect(Object.isFrozen(loaded.identities.main)).toBe(true);
      expect(Object.isFrozen(loaded.profile.compiler)).toBe(true);
      const provider = {
        ...resolveRendererProfile('octane').router,
        framework: 'octane',
      };
      const foreignRouter = {
        ...built,
        routerBindings: {
          main: {
            owner: '@modern-js/renderer-octane-infrastructure',
            evidence: 'owned-default',
            defaultProvider: provider,
            providers: [provider],
          },
        },
      };
      fs.writeFileSync(
        path.join(root, RENDERER_BUILD_MANIFEST_FILE),
        JSON.stringify(foreignRouter),
      );
      const generic = await readRendererBuildManifest(
        root,
        resolveRendererProfile('solid'),
      );
      expect(generic.identities).toEqual(built.identities);
      expect(generic.routerBindings).toEqual(foreignRouter.routerBindings);
      await expect(
        readRendererBuildManifest(root, resolveRendererProfile('solid'), {
          routerFrameworks: resolveRendererRouterFrameworks('solid'),
        }),
      ).rejects.toThrow('must be admitted by the selected router owner.');
      fs.unlinkSync(path.join(root, RENDERER_BUILD_MANIFEST_FILE));
      await expect(
        readRendererBuildManifest(root, resolveRendererProfile('solid')),
      ).rejects.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    'renderer',
    'entryName',
    'buildId',
  ] as const)('rejects conflicting entry %s', field => {
    const built = artifact();
    built.identities.main[field] = 'conflicting';
    expect(() =>
      validateRendererBuildManifest(built, resolveRendererProfile('solid')),
    ).toThrow();
  });

  it('rejects a different selected profile and preserves separate app/cohort provenance', () => {
    const built = artifact();
    expect(() =>
      validateRendererBuildManifest(built, resolveRendererProfile('octane')),
    ).toThrow('profile conflicts');
    const validated = validateRendererBuildManifest(
      built,
      resolveRendererProfile('solid'),
    );
    expect(validated.sourceRevision).toBe(built.sourceRevision);
    expect(validated.frameworkCohortDigest).toBe(built.frameworkCohortDigest);
    built.identities.main.appId = 'modified-after-validation';
    expect(validated.identities.main.appId).toBe('checkout');
  });

  it('requires actual provenance and cannot promote or cache dirty source', () => {
    const built = artifact();
    built.sourceRevision = 'workspace';
    expect(() =>
      validateRendererBuildManifest(built, resolveRendererProfile('solid')),
    ).toThrow('dirty');
    built.cacheAllowed = false;
    built.promotable = false;
    expect(
      validateRendererBuildManifest(built, resolveRendererProfile('solid'))
        .cacheAllowed,
    ).toBe(false);
    built.compilerDigest = 'not-a-compiler-digest';
    expect(() =>
      validateRendererBuildManifest(built, resolveRendererProfile('solid')),
    ).toThrow('compilerDigest');
  });
});
