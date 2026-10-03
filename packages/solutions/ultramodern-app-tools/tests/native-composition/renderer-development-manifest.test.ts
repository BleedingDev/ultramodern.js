import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RendererIdentity } from '@modern-js/renderer-core';
import type { Entrypoint } from '@modern-js/types/cli/base';
import { describe, expect, it } from '@rstest/core';
import {
  RENDERER_BUILD_MANIFEST_FILE,
  RENDERER_DEVELOPMENT_DIRECTORY,
  type RendererDevelopmentBuildManifest,
  readRendererBuildManifest,
  readRendererDevelopmentBuildManifest,
  validateRendererDevelopmentBuildManifest,
} from '../../src/native-composition/native-build-manifest';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';
import { resolveEntrypointRouterBindings } from '../../src/native-composition/renderer-router-resolution';

const compilationFields = [
  'compilationHashes',
  'generation',
  'sourceInputDigest',
] as const;
const entrypoints: Entrypoint[] = [
  { entryName: 'main', entry: '/fixture/src/App.tsx', isMainEntry: true },
  {
    entryName: 'admin',
    entry: '/fixture/src/admin/App.tsx',
    isMainEntry: false,
  },
];

// Session evidence is controlled here; these fixtures do not admit native UI builds.
async function developmentArtifact(
  renderer: 'react' | 'solid' | 'octane' = 'solid',
) {
  const profile = structuredClone(resolveRendererProfile(renderer));
  const routerBindings = structuredClone(
    await resolveEntrypointRouterBindings(renderer, entrypoints, [
      renderer === 'react'
        ? '@modern-js/plugin-router'
        : `@modern-js/renderer-${renderer}-infrastructure`,
    ]),
  );
  const buildMarker = 'a'.repeat(64);
  const identities: Record<string, RendererIdentity> = {};
  for (const entry of entrypoints) {
    identities[entry.entryName] = {
      renderer,
      appId: 'native-development-session',
      entryName: entry.entryName,
      protocolVersion: 1,
      buildId: buildMarker,
    };
  }
  const compilationHashes: Record<string, string> = { web: '1234abcd' };
  if (renderer !== 'react') compilationHashes.node = '5678efab'.repeat(4);
  return {
    schema: 'ultramodern-renderer-build',
    version: 1,
    profile,
    routerBindings,
    identities,
    buildMarker,
    sourceRevision: 'development-session-fixture',
    inputDigest: 'b'.repeat(64),
    profileDigest: 'c'.repeat(64),
    compilerDigest: 'd'.repeat(64),
    frameworkCohortDigest: 'e'.repeat(64),
    cacheAllowed: false,
    promotable: false,
    devCompilation: {
      compilationHashes,
      generation: 1,
      sourceInputDigest: 'f'.repeat(64),
    },
  } satisfies RendererDevelopmentBuildManifest;
}

async function withDistDirectory(
  run: (directories: { root: string; distDirectory: string }) => Promise<void>,
) {
  const root = await fs.mkdtemp(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'ultramodern-development-manifest-',
    ),
  );
  try {
    const distDirectory = path.join(root, 'dist');
    await fs.mkdir(distDirectory);
    await run({ root, distDirectory });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeJson(filename: string, value: unknown) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filename, bytes);
  return bytes;
}

describe('strict native development compilation evidence', () => {
  it.each([
    'solid',
    'octane',
  ] as const)('accepts explicit %s owner bindings and session identities', async renderer => {
    const built = await developmentArtifact(renderer);
    const validated = validateRendererDevelopmentBuildManifest(
      built,
      built.profile,
    );
    expect(validated.devCompilation).toEqual(built.devCompilation);
    expect(Object.keys(validated.identities)).toEqual(['main', 'admin']);
    expect(validated.identities.main.buildId).toBe(built.buildMarker);
    expect(validated.identities.admin.renderer).toBe(renderer);
    expect(validated.routerBindings.main.owner).toBe(
      `@modern-js/renderer-${renderer}-infrastructure`,
    );
    expect(validated.cacheAllowed).toBe(false);
    expect(validated.promotable).toBe(false);
  });

  it.each([
    'client-only',
    'multiple-web',
  ])('accepts a React %s named compiler shape without a node hash', async compilerShape => {
    const built = await developmentArtifact('react');
    if (compilerShape === 'multiple-web')
      built.devCompilation.compilationHashes.admin = 'cafebabe';
    const validated = validateRendererDevelopmentBuildManifest(
      built,
      built.profile,
    );
    expect(Object.keys(validated.devCompilation.compilationHashes)).toEqual(
      compilerShape === 'client-only' ? ['web'] : ['web', 'admin'],
    );
    expect(
      Object.hasOwn(validated.devCompilation.compilationHashes, 'node'),
    ).toBe(false);
    expect(validated.identities.main.renderer).toBe('react');
    expect(validated.routerBindings.main.owner).toBe(
      '@modern-js/plugin-router',
    );
  });

  it.each(
    (['web', 'node'] as const).flatMap(field =>
      [1, 8, 20, 64].map(length => ({ field, length })),
    ),
  )('accepts lowercase $field with $length hex characters', async ({
    field,
    length,
  }) => {
    const built = await developmentArtifact();
    built.devCompilation.compilationHashes[field] = 'a'.repeat(length);
    expect(
      validateRendererDevelopmentBuildManifest(built, built.profile)
        .devCompilation.compilationHashes[field],
    ).toBe('a'.repeat(length));
  });

  it.each(
    (['web', 'node'] as const).flatMap(field =>
      [
        { label: 'empty', value: '' },
        { label: 'uppercase', value: 'ABCDEF12' },
        { label: 'nonhex', value: '1234abcg' },
        { label: 'whitespace', value: '1234abcd ' },
        { label: 'newline', value: '1234abcd\n' },
        { label: 'too-long', value: 'a'.repeat(65) },
        { label: 'number', value: 1234 },
        { label: 'null', value: null },
      ].map(invalid => ({ field, ...invalid })),
    ),
  )('rejects $label $field', async ({ field, value }) => {
    const built = await developmentArtifact();
    Reflect.set(built.devCompilation.compilationHashes, field, value);
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it.each([
    'empty',
    'null',
    'array',
    'string',
    'number',
    'inherited',
  ])('rejects a %s named compilation hash map', async kind => {
    const built = await developmentArtifact();
    const hashes =
      kind === 'empty'
        ? {}
        : kind === 'null'
          ? null
          : kind === 'array'
            ? Object.assign([], built.devCompilation.compilationHashes)
            : kind === 'string'
              ? '1234abcd'
              : kind === 'number'
                ? 1234
                : Object.create(built.devCompilation.compilationHashes);
    Reflect.set(built.devCompilation, 'compilationHashes', hashes);
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it.each([
    '',
    ' ',
    ' web',
    'web ',
    Symbol('compiler'),
  ])('rejects an invalid compiler hash name %s', async name => {
    const built = await developmentArtifact();
    Object.defineProperty(built.devCompilation.compilationHashes, name, {
      value: '1234abcd',
      enumerable: true,
    });
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it.each([
    'web',
    'node',
  ])('rejects an accessor %s compiler hash without evaluating it', async name => {
    const built = await developmentArtifact();
    let reads = 0;
    Object.defineProperty(built.devCompilation.compilationHashes, name, {
      enumerable: true,
      get() {
        reads += 1;
        return '1234abcd';
      },
    });
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
    expect(reads).toBe(0);
  });

  it.each([
    'web',
    'node',
  ])('rejects a nonenumerable %s compiler hash', async name => {
    const built = await developmentArtifact();
    Object.defineProperty(built.devCompilation.compilationHashes, name, {
      enumerable: false,
    });
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it.each([
    { label: 'short', value: 'f'.repeat(63) },
    { label: 'long', value: 'f'.repeat(65) },
    { label: 'uppercase', value: 'F'.repeat(64) },
    { label: 'newline', value: `${'f'.repeat(64)}\n` },
    { label: 'nonhex', value: 'g'.repeat(64) },
    { label: 'number', value: 1234 },
    { label: 'null', value: null },
  ])('rejects a $label development source input digest', async ({ value }) => {
    const built = await developmentArtifact();
    Reflect.set(built.devCompilation, 'sourceInputDigest', value);
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it.each([
    { label: 'zero', value: 0 },
    { label: 'negative', value: -1 },
    { label: 'fraction', value: 1.5 },
    { label: 'NaN', value: Number.NaN },
    { label: 'infinite', value: Number.POSITIVE_INFINITY },
    { label: 'unsafe', value: Number.MAX_SAFE_INTEGER + 1 },
    { label: 'string', value: '1' },
    { label: 'null', value: null },
  ])('rejects $label development generations', async ({ value }) => {
    const built = await developmentArtifact();
    Reflect.set(built.devCompilation, 'generation', value);
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it.each([
    1,
    2,
    Number.MAX_SAFE_INTEGER,
  ])('accepts positive safe generation %s', async generation => {
    const built = await developmentArtifact();
    built.devCompilation.generation = generation;
    expect(
      validateRendererDevelopmentBuildManifest(built, built.profile)
        .devCompilation.generation,
    ).toBe(generation);
  });

  it.each(
    compilationFields,
  )('requires the own %s compilation field', async field => {
    const built = await developmentArtifact();
    Reflect.deleteProperty(built.devCompilation, field);
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it.each([
    'enumerable',
    'nonenumerable',
    'symbol',
  ])('rejects an extra %s compilation field', async kind => {
    const built = await developmentArtifact();
    Object.defineProperty(
      built.devCompilation,
      kind === 'symbol' ? Symbol('unowned') : 'unowned',
      { value: true, enumerable: kind !== 'nonenumerable' },
    );
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it.each([
    'null',
    'array',
    'string',
    'number',
    'inherited',
  ])('rejects a %s compilation record', async kind => {
    const built = await developmentArtifact();
    const record =
      kind === 'null'
        ? null
        : kind === 'array'
          ? Object.assign([], built.devCompilation)
          : kind === 'string'
            ? '1234abcd'
            : kind === 'number'
              ? 1234
              : Object.create(built.devCompilation);
    Reflect.set(built, 'devCompilation', record);
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it.each([
    'devCompilation',
    ...compilationFields,
  ] as const)('rejects an accessor %s without evaluating it', async field => {
    const built = await developmentArtifact();
    const record = field === 'devCompilation' ? built : built.devCompilation;
    const original = Reflect.get(record, field);
    let reads = 0;
    Object.defineProperty(record, field, {
      enumerable: true,
      get() {
        reads += 1;
        return original;
      },
    });
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
    expect(reads).toBe(0);
  });

  it.each([
    'devCompilation',
    ...compilationFields,
  ] as const)('rejects a nonenumerable %s property', async field => {
    const built = await developmentArtifact();
    const record = field === 'devCompilation' ? built : built.devCompilation;
    Object.defineProperty(record, field, { enumerable: false });
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it.each(
    (['cacheAllowed', 'promotable'] as const).flatMap(field =>
      [
        { label: 'enabled', value: true },
        { label: 'nonboolean', value: 'false' },
        { label: 'missing', value: undefined },
      ].map(invalid => ({ field, ...invalid })),
    ),
  )('rejects $label development $field', async ({ field, value }) => {
    const built = await developmentArtifact();
    if (value === undefined) Reflect.deleteProperty(built, field);
    else Reflect.set(built, field, value);
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it.each([
    'schema',
    'build-marker',
    'input-digest',
    'entry-identity',
    'router-owner',
  ])('retains canonical base validation for %s', async invalid => {
    const built = await developmentArtifact();
    if (invalid === 'schema') Reflect.set(built, 'schema', 'another-schema');
    else if (invalid === 'build-marker') built.buildMarker = 'not-a-marker';
    else if (invalid === 'input-digest') built.inputDigest = 'not-a-digest';
    else if (invalid === 'entry-identity')
      built.identities.main.buildId = 'b'.repeat(64);
    else Reflect.deleteProperty(built.routerBindings, 'admin');
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it('rejects development evidence for another selected profile', async () => {
    const built = await developmentArtifact('solid');
    expect(() =>
      validateRendererDevelopmentBuildManifest(
        built,
        resolveRendererProfile('octane'),
      ),
    ).toThrow();
  });

  it('rejects a production manifest without compilation evidence even with both flags disabled', async () => {
    const built = await developmentArtifact();
    Reflect.deleteProperty(built, 'devCompilation');
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it('rejects inherited root development compilation evidence', async () => {
    const built = await developmentArtifact();
    const compilation = built.devCompilation;
    Reflect.deleteProperty(built, 'devCompilation');
    Object.setPrototypeOf(built, { devCompilation: compilation });
    expect(() =>
      validateRendererDevelopmentBuildManifest(built, built.profile),
    ).toThrow();
  });

  it('freezes isolated evidence while subsequent caller mutation leaves the snapshot unchanged', async () => {
    const built = await developmentArtifact();
    const expected = structuredClone(built);
    const validated = validateRendererDevelopmentBuildManifest(
      built,
      built.profile,
    );
    expect(validated.devCompilation).not.toBe(built.devCompilation);
    expect(validated.devCompilation.compilationHashes).not.toBe(
      built.devCompilation.compilationHashes,
    );
    expect(validated.profile).not.toBe(built.profile);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.devCompilation)).toBe(true);
    expect(Object.isFrozen(validated.devCompilation.compilationHashes)).toBe(
      true,
    );
    expect(Object.isFrozen(validated.profile.compiler)).toBe(true);
    expect(Object.isFrozen(validated.identities.main)).toBe(true);
    expect(Object.isFrozen(validated.routerBindings.main.providers)).toBe(true);
    expect(Object.isFrozen(built)).toBe(false);
    expect(Object.isFrozen(built.devCompilation)).toBe(false);
    queueMicrotask(() => {
      built.devCompilation.compilationHashes.web = '11111111';
      built.devCompilation.generation = 2;
      built.profile.compiler.version = 'changed-after-validation';
      built.identities.main.appId = 'changed-after-validation';
      Reflect.set(
        built.routerBindings.main,
        'owner',
        'changed-after-validation',
      );
    });
    await Promise.resolve();
    expect(validated).toEqual(expected);
  });
});

describe('native development manifest reader', () => {
  it('reads only the development authority and leaves production bytes unchanged', async () => {
    await withDistDirectory(async ({ distDirectory }) => {
      const built = await developmentArtifact();
      const { devCompilation, ...production } = structuredClone(built);
      Reflect.set(production, 'cacheAllowed', true);
      Reflect.set(production, 'promotable', true);
      production.buildMarker = '1'.repeat(64);
      for (const identity of Object.values(production.identities))
        identity.buildId = production.buildMarker;
      const productionFilename = path.join(
        distDirectory,
        RENDERER_BUILD_MANIFEST_FILE,
      );
      const productionBytes = await writeJson(productionFilename, production);
      await writeJson(
        path.join(
          distDirectory,
          RENDERER_DEVELOPMENT_DIRECTORY,
          RENDERER_BUILD_MANIFEST_FILE,
        ),
        built,
      );
      expect(RENDERER_DEVELOPMENT_DIRECTORY).toBe('.ultramodern-dev');
      const loaded = await readRendererDevelopmentBuildManifest(
        distDirectory,
        built.profile,
      );
      expect(loaded.buildMarker).toBe(built.buildMarker);
      expect(loaded.devCompilation).toEqual(devCompilation);
      expect(loaded.buildMarker).not.toBe(production.buildMarker);
      expect(await fs.readFile(productionFilename, 'utf8')).toBe(
        productionBytes,
      );
      expect(
        (await readRendererBuildManifest(distDirectory, built.profile))
          .buildMarker,
      ).toBe(production.buildMarker);
    });
  });

  it('does not fall back to production or an ancestor development file', async () => {
    await withDistDirectory(async ({ root, distDirectory }) => {
      const built = await developmentArtifact();
      const productionFilename = path.join(
        distDirectory,
        RENDERER_BUILD_MANIFEST_FILE,
      );
      const productionBytes = await writeJson(productionFilename, built);
      await writeJson(
        path.join(
          root,
          RENDERER_DEVELOPMENT_DIRECTORY,
          RENDERER_BUILD_MANIFEST_FILE,
        ),
        built,
      );
      await expect(
        readRendererDevelopmentBuildManifest(distDirectory, built.profile),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(productionFilename, 'utf8')).toBe(
        productionBytes,
      );
    });
  });

  it('rejects substituted production data at the development path', async () => {
    await withDistDirectory(async ({ distDirectory }) => {
      const built = await developmentArtifact();
      const { devCompilation: _devCompilation, ...production } = built;
      const productionFilename = path.join(
        distDirectory,
        RENDERER_BUILD_MANIFEST_FILE,
      );
      const productionBytes = await writeJson(productionFilename, production);
      await expect(
        readRendererBuildManifest(distDirectory, built.profile),
      ).resolves.toMatchObject({ buildMarker: production.buildMarker });
      await writeJson(
        path.join(
          distDirectory,
          RENDERER_DEVELOPMENT_DIRECTORY,
          RENDERER_BUILD_MANIFEST_FILE,
        ),
        production,
      );
      await expect(
        readRendererDevelopmentBuildManifest(distDirectory, built.profile),
      ).rejects.toThrow();
      expect(await fs.readFile(productionFilename, 'utf8')).toBe(
        productionBytes,
      );
    });
  });

  it('reads successive generations without mutating the earlier frozen result', async () => {
    await withDistDirectory(async ({ distDirectory }) => {
      const built = await developmentArtifact('octane');
      const filename = path.join(
        distDirectory,
        RENDERER_DEVELOPMENT_DIRECTORY,
        RENDERER_BUILD_MANIFEST_FILE,
      );
      await writeJson(filename, built);
      const initial = await readRendererDevelopmentBuildManifest(
        distDirectory,
        built.profile,
      );
      built.devCompilation.generation += 1;
      built.devCompilation.compilationHashes.web = 'cafebabe';
      await writeJson(filename, built);
      const current = await readRendererDevelopmentBuildManifest(
        distDirectory,
        built.profile,
      );
      expect(initial.devCompilation.generation).toBe(1);
      expect(initial.devCompilation.compilationHashes.web).toBe('1234abcd');
      expect(current.devCompilation.generation).toBe(2);
      expect(current.devCompilation.compilationHashes.web).toBe('cafebabe');
      expect(Object.isFrozen(initial.devCompilation)).toBe(true);
      expect(Object.isFrozen(current.devCompilation)).toBe(true);
    });
  });
});
