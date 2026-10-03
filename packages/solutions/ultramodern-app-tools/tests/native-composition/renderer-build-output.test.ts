import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRendererBuildOutputResolver } from '../../src/native-composition/renderer-build-output';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

const fixture = async (renderer: 'react' | 'solid' | 'octane') => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'renderer-output-'),
  );
  directories.push(directory);
  const profile = resolveRendererProfile(renderer);
  const buildMarker = 'a'.repeat(64);
  const framework = renderer === 'react' ? 'tanstack' : renderer;
  const provider = { framework, ...profile.router };
  const manifest = {
    schema: 'ultramodern-renderer-build',
    version: 1,
    profile,
    buildMarker,
    sourceRevision: 'b'.repeat(40),
    inputDigest: 'c'.repeat(64),
    profileDigest: 'd'.repeat(64),
    compilerDigest: 'e'.repeat(64),
    frameworkCohortDigest: 'f'.repeat(64),
    cacheAllowed: true,
    promotable: true,
    identities: Object.fromEntries(
      ['ssr', 'csr'].map(entryName => [
        entryName,
        {
          renderer,
          appId: 'app',
          entryName,
          protocolVersion: 1,
          buildId: buildMarker,
        },
      ]),
    ),
    routerBindings: Object.fromEntries(
      ['ssr', 'csr'].map(entryName => [
        entryName,
        {
          owner: `${entryName}-owner`,
          evidence: 'file-routes',
          defaultProvider: provider,
          providers: [provider],
        },
      ]),
    ),
  };
  await fs.writeFile(
    path.join(directory, 'renderer-build.json'),
    JSON.stringify(manifest),
  );
  return {
    directory,
    manifest,
    context: {
      appDirectory: directory,
      distDirectory: directory,
      entrypoints: [
        { entryName: 'csr' },
        { entryName: 'ssr', isMainEntry: true },
      ],
    },
  };
};

describe('finalized renderer output projection', () => {
  it.each([
    'react',
    'solid',
    'octane',
  ] as const)('preserves every actual %s router binding and the actual primary identity', async renderer => {
    const { context, manifest } = await fixture(renderer);
    const output = await createRendererBuildOutputResolver(renderer)(context);
    expect(output.ui.rendererIdentity).toEqual(manifest.identities.ssr);
    expect(output.ui.routerBindings).toEqual(manifest.routerBindings);
    expect(Object.isFrozen(output.ui.routerBindings.csr!.providers[0])).toBe(
      true,
    );
    expect(output.buildMarker).toBe(manifest.buildMarker);
    expect(output.sourceRevision).toBe(manifest.sourceRevision);
  });

  it('rejects missing or additional final entries and ambiguous primary entries', async () => {
    const { context } = await fixture('react');
    const resolve = createRendererBuildOutputResolver('react');
    await expect(
      resolve({ ...context, entrypoints: [{ entryName: 'ssr' }] }),
    ).rejects.toThrow(/exactly match/);
    await expect(
      resolve({
        ...context,
        entrypoints: [...context.entrypoints, { entryName: 'unbuilt' }],
      }),
    ).rejects.toThrow(/exactly match/);
    await expect(
      resolve({
        ...context,
        entrypoints: [
          { entryName: 'csr', isMainEntry: true },
          { entryName: 'ssr', isMainEntry: true },
        ],
      }),
    ).rejects.toThrow(/one actual primary/);
  });

  it('fails on absent or conflicting finalized metadata without source synthesis', async () => {
    const { context, directory, manifest } = await fixture('solid');
    await fs.unlink(path.join(directory, 'renderer-build.json'));
    await expect(
      createRendererBuildOutputResolver('solid')(context),
    ).rejects.toThrow();
    await fs.writeFile(
      path.join(directory, 'renderer-build.json'),
      JSON.stringify({ ...manifest, profile: resolveRendererProfile('react') }),
    );
    await expect(
      createRendererBuildOutputResolver('solid')(context),
    ).rejects.toThrow(/profile conflicts/);
  });
});
