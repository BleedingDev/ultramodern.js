import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createUltramodernBuildArtifact,
  type RendererName,
} from '@modern-js/backend-federation-contracts';
import {
  emitRendererBuildArtifact,
  type FinalizedRendererBuildOutput,
  type RendererBuildOutputContext,
  rendererBuildArtifactStampPlugin,
} from '../src/release-envelope/renderer-output-stamp';
import { reactReleaseUi } from './renderer-release-fixture';

const directories: string[] = [];
afterEach(async () => {
  rstest.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

function nativeUi(renderer: Exclude<RendererName, 'react'>, buildId: string) {
  const source = reactReleaseUi(buildId, 'native-ui');
  const provider = {
    framework: renderer,
    name:
      renderer === 'solid'
        ? '@modern-js/renderer-solid'
        : '@octanejs/tanstack-router',
    version: '0.0.1-unit',
    coreName: '@tanstack/router-core',
    coreVersion: '1.0.0-unit',
  } as const;
  return {
    rendererIdentity: { ...source.rendererIdentity, renderer },
    rendererProfile: {
      ...source.rendererProfile,
      renderer,
      compiler: { name: `${renderer}/compiler`, version: '0.0.1-unit' },
      hydration: { name: renderer, version: '0.0.1-unit' },
      router: {
        name: provider.name,
        version: provider.version,
        coreName: provider.coreName,
        coreVersion: provider.coreVersion,
      },
    },
    routerBindings: Object.fromEntries(
      ['main', 'csr'].map(entry => [
        entry,
        {
          owner: `@modern-js/renderer-${renderer}`,
          evidence: 'file-routes' as const,
          defaultProvider: provider,
          providers: [provider],
        },
      ]),
    ),
  };
}

async function fixture(renderer: 'solid' | 'octane') {
  const appDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'native-output-stamp-unit-'),
  );
  directories.push(appDirectory);
  const context: RendererBuildOutputContext = {
    appDirectory,
    distDirectory: path.join(appDirectory, 'dist'),
    entrypoints: [
      { entryName: 'main', isMainEntry: true },
      { entryName: 'csr' },
    ],
  };
  const ui = nativeUi(renderer, 'generation-marker');
  const artifact = createUltramodernBuildArtifact(
    {
      schemaVersion: 1,
      kind: 'microvertical-delivery-unit',
      unitId: 'native-unit',
      appId: 'native-ui',
      buildMarker: 'generation-marker',
      sourceRevision: 'workspace',
      packageName: '@unit/native-app',
      version: '0.0.1-unit',
      deployProfile: 'cloudflare-ssr-mf-effect-v1',
    },
    {
      ui: {
        identity: ui.rendererIdentity,
        profile: ui.rendererProfile,
        routerBindings: ui.routerBindings,
      },
    },
  );
  const source = path.join(appDirectory, 'shared/ultramodern-build.json');
  await fs.mkdir(path.dirname(source));
  const sourceBytes = `${JSON.stringify(artifact)}\n`;
  await fs.writeFile(source, sourceBytes);
  const output: FinalizedRendererBuildOutput = {
    buildMarker: 'compiled-marker',
    sourceRevision: 'actual-application-revision',
    ui: nativeUi(renderer, 'compiled-marker'),
  };
  const options = {
    rendererBuildPlugin:
      `@modern-js/renderer-${renderer}-infrastructure` as const,
    resolveRendererBuild: async () => output,
  };
  return { context, source, sourceBytes, artifact, output, options };
}

describe('finalized native UI output stamping', () => {
  it.each([
    'solid',
    'octane',
  ] as const)('stamps actual %s identity in both carriers without a backend surface or generation edit', async renderer => {
    const { context, source, sourceBytes, artifact, output, options } =
      await fixture(renderer);
    const result = await emitRendererBuildArtifact(context, options);
    expect(result?.deliveryUnit.buildMarker).toBe(output.buildMarker);
    expect(result?.deliveryUnit.sourceRevision).toBe(output.sourceRevision);
    expect(result?.surfaces.ui?.routerBindings).toEqual(
      output.ui.routerBindings,
    );
    expect(Object.keys(result!.surfaces)).toEqual(
      Object.keys(artifact.surfaces),
    );
    const root = await fs.readFile(
      path.join(context.distDirectory, 'ultramodern-build.json'),
    );
    const publicCarrier = await fs.readFile(
      path.join(context.distDirectory, 'public/ultramodern-build.json'),
    );
    expect(root.equals(publicCarrier)).toBe(true);
    expect(await fs.readFile(source, 'utf8')).toBe(sourceBytes);
    expect(await fs.readdir(context.distDirectory)).toEqual([
      'public',
      'ultramodern-build.json',
    ]);
  });

  it('runs only after its required metadata producer and leaves API-only output alone', async () => {
    const { context, options } = await fixture('solid');
    const resolver = rstest.fn(options.resolveRendererBuild);
    const plugin = rendererBuildArtifactStampPlugin({
      ...options,
      resolveRendererBuild: resolver,
    });
    expect(plugin.pre).toEqual([options.rendererBuildPlugin]);
    expect(plugin.required).toEqual([options.rendererBuildPlugin]);
    let callback: (() => Promise<void>) | undefined;
    plugin.setup({
      getAppContext: () => context,
      onAfterBuild: handler => {
        callback = handler;
      },
    });
    expect(resolver).not.toHaveBeenCalled();
    await callback!();
    expect(resolver).toHaveBeenCalledExactlyOnceWith(context);
    plugin.setup({
      getAppContext: () => ({ ...context, apiOnly: true }),
      onAfterBuild: handler => {
        callback = handler;
      },
    });
    await callback!();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('does not invent a build carrier for an ordinary app and fails on a missing declared carrier', async () => {
    const { context, source, options } = await fixture('octane');
    await fs.rm(source);
    const resolver = rstest.fn(options.resolveRendererBuild);
    expect(
      await emitRendererBuildArtifact(context, {
        ...options,
        resolveRendererBuild: resolver,
      }),
    ).toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
    await fs.writeFile(
      source.replace(/\.json$/u, '.ts'),
      'export const generatedArtifact = {};',
    );
    await expect(emitRendererBuildArtifact(context, options)).rejects.toThrow(
      'missing its build carrier',
    );
  });

  it('rejects malformed source, headless UI configuration, and full captured profile/map drift before any output write', async () => {
    for (const mode of [
      'malformed',
      'headless',
      'profile',
      'map',
      'primary',
      'duplicate',
    ]) {
      const { context, source, artifact, output, options } =
        await fixture('solid');
      if (mode === 'malformed') await fs.writeFile(source, '{}');
      else if (mode === 'headless') {
        const headless = createUltramodernBuildArtifact(artifact.deliveryUnit);
        await fs.writeFile(source, JSON.stringify(headless));
      } else if (mode === 'profile')
        output.ui.rendererProfile.compiler.version = '0.0.2-unit';
      else if (mode === 'map')
        output.ui.routerBindings.csr.owner = '@unit/another-owner';
      else if (mode === 'primary') output.ui.rendererIdentity.entryName = 'csr';
      else
        context.entrypoints = [...context.entrypoints, { entryName: 'main' }];
      await expect(
        emitRendererBuildArtifact(context, options),
      ).rejects.toThrow();
      await expect(fs.stat(context.distDirectory)).rejects.toThrow('ENOENT');
    }
  });

  it('preserves the exact selected fourth metadata producer without substituting a built-in owner', () => {
    const rendererBuildPlugin = '@fixture/fourth-native-infrastructure';
    const plugin = rendererBuildArtifactStampPlugin({
      rendererBuildPlugin,
      resolveRendererBuild: async () => ({}) as FinalizedRendererBuildOutput,
    });
    expect(plugin.pre).toEqual([rendererBuildPlugin]);
    expect(plugin.required).toEqual([rendererBuildPlugin]);
    for (const invalid of ['', ' ', ' @fixture/fourth-native-infrastructure']) {
      expect(() =>
        rendererBuildArtifactStampPlugin({
          rendererBuildPlugin: invalid,
          resolveRendererBuild: async () =>
            ({}) as FinalizedRendererBuildOutput,
        }),
      ).toThrow('owning metadata producer');
    }
  });

  it('rejects an unbound metadata resolver before registering a callback', () => {
    expect(() =>
      rendererBuildArtifactStampPlugin({
        resolveRendererBuild: async () => ({}) as FinalizedRendererBuildOutput,
      } as Parameters<typeof rendererBuildArtifactStampPlugin>[0]),
    ).toThrow('owning metadata producer');
  });

  it('retires a newly opened partial temp while preserving an existing output on write failure', async () => {
    const { context, options } = await fixture('solid');
    const target = path.join(context.distDirectory, 'ultramodern-build.json');
    await fs.mkdir(context.distDirectory);
    await fs.writeFile(target, 'previous-successful-carrier');
    const open = fs.open.bind(fs);
    let temporary: string | undefined;
    rstest.spyOn(fs, 'open').mockImplementationOnce(async (file, flags) => {
      temporary = String(file);
      const handle = await open(file, flags);
      const write = handle.writeFile.bind(handle);
      rstest.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
        await write('partial-carrier');
        throw Object.assign(new Error('Failed owned temp write'), {
          code: 'EIO',
        });
      });
      return handle;
    });
    await expect(emitRendererBuildArtifact(context, options)).rejects.toThrow(
      'Failed owned temp write',
    );
    expect(temporary).toBeDefined();
    await expect(fs.stat(temporary!)).rejects.toThrow('ENOENT');
    expect(await fs.readFile(target, 'utf8')).toBe(
      'previous-successful-carrier',
    );
    expect(await fs.readdir(context.distDirectory)).toEqual([
      'ultramodern-build.json',
    ]);
  });

  it('preserves another owner\u0027s colliding temp and the prior output when exclusive open rejects', async () => {
    const { context, options } = await fixture('octane');
    const target = path.join(context.distDirectory, 'ultramodern-build.json');
    await fs.mkdir(context.distDirectory);
    await fs.writeFile(target, 'previous-successful-carrier');
    const open = fs.open.bind(fs);
    let temporary: string | undefined;
    rstest.spyOn(fs, 'open').mockImplementationOnce(async (file, flags) => {
      temporary = String(file);
      await fs.writeFile(temporary, 'another-owner');
      return open(file, flags);
    });
    await expect(emitRendererBuildArtifact(context, options)).rejects.toThrow(
      'EEXIST',
    );
    expect(await fs.readFile(temporary!, 'utf8')).toBe('another-owner');
    expect(await fs.readFile(target, 'utf8')).toBe(
      'previous-successful-carrier',
    );
  });
});
