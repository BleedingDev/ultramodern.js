import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppTools } from '@modern-js/app-tools/cli-config';
import type {
  RendererBuildOutputContext,
  rendererBuildArtifactStampPlugin,
} from '@modern-js/app-tools-extensions/release-envelope/renderer-output-stamp';
import {
  assertUltramodernBuildArtifact,
  createUltramodernBuildArtifact,
  type DeliveryUnitRecord,
  ULTRAMODERN_BUILD_ARTIFACT_FILE,
  ULTRAMODERN_BUILD_ARTIFACT_PATH,
} from '@modern-js/backend-federation-contracts';
import { createPluginManager } from '@modern-js/plugin';
import type { AppContext, CLIPluginAPI } from '@modern-js/plugin/cli';
import type { RendererIdentity } from '@modern-js/renderer-core';
import type { Entrypoint } from '@modern-js/types/cli/base';
import {
  defineConfig,
  resolveRendererProfile,
} from '@modern-js/ultramodern-app-tools';
import { describe, expect, it } from '@rstest/core';
import {
  RENDERER_BUILD_MANIFEST_FILE,
  type RendererBuildManifest,
} from '../../src/native-composition/native-build-manifest';
import { resolveEntrypointRouterBindings } from '../../src/native-composition/renderer-router-resolution';

type NativeRenderer = 'solid' | 'octane';

// Completed metadata is controlled here; these tests do not admit native UI builds.
const compiledMarker = 'a'.repeat(64);
const generatedMarker = 'generated-native-ui-carrier';
const compiledRevision = 'b'.repeat(40);
const appId = 'native-stamp';
const entries: Entrypoint[] = [
  { entryName: 'main', entry: '/fixture/src/App.tsx', isMainEntry: true },
  {
    entryName: 'admin',
    entry: '/fixture/src/admin/App.tsx',
    isMainEntry: false,
  },
];

async function withFixture(
  run: (context: RendererBuildOutputContext) => Promise<void>,
): Promise<void> {
  const directory = fs.realpathSync(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'ultramodern-native-stamp-',
      ),
    ),
  );
  try {
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: '@fixture/native-stamp', version: '0.1.0' }),
    );
    await run({
      appDirectory: directory,
      distDirectory: path.join(directory, 'dist'),
      entrypoints: entries,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function writeJson(filename: string, value: unknown): string {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(filename, bytes);
  return bytes;
}

function selectedGraph(renderer: NativeRenderer) {
  const config = defineConfig({ renderer });
  if (typeof config === 'function')
    throw new Error('Object configuration unexpectedly produced a callback');
  const manager = createPluginManager<
    CLIPluginAPI<AppTools> & AppTools['extendApi'],
    AppContext<AppTools> & AppTools['extendContext']
  >();
  manager.addPlugins(config.plugins ?? []);
  const plugins = manager.getPlugins();
  const stamp = plugins.find(
    plugin => plugin.name === '@modern-js/renderer-build-artifact-stamp',
  );
  if (!stamp)
    throw new Error(`The selected ${renderer} graph has no artifact stamper`);
  return { plugins, stamp };
}

async function captureStampCallback(
  renderer: NativeRenderer,
  context: RendererBuildOutputContext,
) {
  const { stamp } = selectedGraph(renderer);
  const callbacks: Array<() => Promise<void>> = [];
  const api: Parameters<
    ReturnType<typeof rendererBuildArtifactStampPlugin>['setup']
  >[0] = {
    getAppContext: () => context,
    onAfterBuild(callback: () => Promise<void>) {
      callbacks.push(callback);
    },
  };
  if (!stamp.setup) throw new Error('Artifact stamper has no setup function');
  await Reflect.apply(stamp.setup, undefined, [api]);
  expect(callbacks).toHaveLength(1);
  const callback = callbacks[0];
  if (!callback)
    throw new Error('Artifact stamper registered no build callback');
  return callback;
}

async function nativeCarriers(renderer: NativeRenderer) {
  const profile = resolveRendererProfile(renderer);
  const routerBindings = await resolveEntrypointRouterBindings(
    renderer,
    entries,
    [`@modern-js/renderer-${renderer}-infrastructure`],
  );
  const identities: Record<string, RendererIdentity> = {};
  for (const entry of entries) {
    identities[entry.entryName] = {
      renderer,
      appId,
      entryName: entry.entryName,
      protocolVersion: 1,
      buildId: compiledMarker,
    };
  }
  const compiled: RendererBuildManifest = {
    schema: 'ultramodern-renderer-build',
    version: 2,
    renderer,
    profile,
    entries: identities,
    routerBindings,
    buildId: compiledMarker,
    sourceRevision: compiledRevision,
  };
  const deliveryUnit: DeliveryUnitRecord = {
    schemaVersion: 1,
    kind: 'microvertical-delivery-unit',
    appId,
    unitId: 'fixture/native-stamp',
    packageName: '@fixture/native-stamp',
    version: '0.1.0',
    sourceRevision: 'workspace',
    buildMarker: generatedMarker,
    deployProfile: 'cloudflare-ssr-mf-effect-v1',
  };
  const artifact = createUltramodernBuildArtifact(deliveryUnit, {
    ui: {
      identity: { ...identities.main, buildId: generatedMarker },
      profile: {
        renderer,
        protocolVersion: profile.protocolVersion,
        compiler: profile.compiler,
        hydration: profile.hydration,
        router: profile.router,
      },
      routerBindings,
    },
  });
  return { artifact, compiled };
}

function expectNoStampedOutputs(context: RendererBuildOutputContext): void {
  for (const relative of [
    ULTRAMODERN_BUILD_ARTIFACT_FILE,
    path.join('public', ULTRAMODERN_BUILD_ARTIFACT_FILE),
    'backend-mf-manifest.json',
    'backendRemoteEntry.cjs',
  ]) {
    expect(fs.existsSync(path.join(context.distDirectory, relative))).toBe(
      false,
    );
  }
}

describe.each(['solid', 'octane'] as const)(
  'selected %s generated UI artifact stamping',
  renderer => {
    it('registers one neutral stamp after the actual metadata owner without the backend emitter', () => {
      const { plugins, stamp } = selectedGraph(renderer);
      const names = plugins.map(plugin => plugin.name);
      const metadataOwner = `@modern-js/renderer-${renderer}-infrastructure`;
      expect(names.filter(name => name === stamp.name)).toHaveLength(1);
      expect(stamp.pre).toEqual([metadataOwner]);
      expect(stamp.required).toEqual([metadataOwner]);
      expect(names.indexOf(metadataOwner)).toBeGreaterThanOrEqual(0);
      expect(names.indexOf(metadataOwner)).toBeLessThan(
        names.indexOf(stamp.name),
      );
      expect(names.indexOf(stamp.name)).toBeLessThan(
        names.indexOf('@modern-js/ultramodern-release-envelope'),
      );
      expect(names).not.toContain('@modern-js/backend-federation-build');
      expect(names).not.toContain('@modern-js/renderer-react-build-metadata');
    });

    it('stamps the compiled primary identity and full final router map into both generated output carriers', async () =>
      withFixture(async context => {
        const { artifact, compiled } = await nativeCarriers(renderer);
        const authoredFile = path.join(
          context.appDirectory,
          ULTRAMODERN_BUILD_ARTIFACT_PATH,
        );
        const authoredBytes = writeJson(authoredFile, artifact);
        writeJson(
          path.join(context.distDirectory, RENDERER_BUILD_MANIFEST_FILE),
          compiled,
        );
        await (await captureStampCallback(renderer, context))();
        for (const directory of [
          context.distDirectory,
          path.join(context.distDirectory, 'public'),
        ]) {
          const output: unknown = JSON.parse(
            fs.readFileSync(
              path.join(directory, ULTRAMODERN_BUILD_ARTIFACT_FILE),
              'utf8',
            ),
          );
          assertUltramodernBuildArtifact(output);
          expect(output.deliveryUnit.buildMarker).toBe(compiledMarker);
          expect(output.deliveryUnit.build).toBe(compiledMarker);
          expect(output.deliveryUnit.sourceRevision).toBe(compiledRevision);
          expect(output.surfaces.ui?.rendererIdentity).toEqual(
            compiled.entries.main,
          );
          expect(output.surfaces.ui?.routerBindings).toEqual(
            compiled.routerBindings,
          );
          expect(Object.keys(output.surfaces.ui?.routerBindings ?? {})).toEqual(
            ['main', 'admin'],
          );
          expect(output.surfaces.ui?.rendererProfile).toEqual(
            artifact.surfaces.ui?.rendererProfile,
          );
        }
        expect(fs.readFileSync(authoredFile, 'utf8')).toBe(authoredBytes);
        expect(
          fs.existsSync(
            path.join(context.distDirectory, 'backendRemoteEntry.cjs'),
          ),
        ).toBe(false);
        expect(
          fs.existsSync(
            path.join(context.distDirectory, 'backend-mf-manifest.json'),
          ),
        ).toBe(false);
      }));

    it('rejects a generated UI carrier without the committed renderer build manifest', async () =>
      withFixture(async context => {
        const { artifact } = await nativeCarriers(renderer);
        writeJson(
          path.join(context.appDirectory, ULTRAMODERN_BUILD_ARTIFACT_PATH),
          artifact,
        );
        const callback = await captureStampCallback(renderer, context);
        await expect(callback()).rejects.toThrow(/renderer-build\.json/);
        expectNoStampedOutputs(context);
      }));

    it('rejects malformed final metadata and never stamps candidate identities', async () =>
      withFixture(async context => {
        const { artifact, compiled } = await nativeCarriers(renderer);
        writeJson(
          path.join(context.appDirectory, ULTRAMODERN_BUILD_ARTIFACT_PATH),
          artifact,
        );
        const manifest = path.join(
          context.distDirectory,
          RENDERER_BUILD_MANIFEST_FILE,
        );
        writeJson(manifest, {
          ...compiled,
          buildId: 'not-a-compiled-digest',
        });
        const callback = await captureStampCallback(renderer, context);
        await expect(callback()).rejects.toThrow(/buildId/);
        expectNoStampedOutputs(context);
      }));

    it('rejects a compiled manifest with different installed framework dependencies', async () =>
      withFixture(async context => {
        const { artifact, compiled } = await nativeCarriers(renderer);
        writeJson(
          path.join(context.appDirectory, ULTRAMODERN_BUILD_ARTIFACT_PATH),
          artifact,
        );
        writeJson(
          path.join(context.distDirectory, RENDERER_BUILD_MANIFEST_FILE),
          {
            ...compiled,
            profile: {
              ...compiled.profile,
              dependencies: {
                ...compiled.profile.dependencies,
                [`@modern-js/renderer-${renderer}`]: '99.0.0',
              },
            },
          },
        );
        const callback = await captureStampCallback(renderer, context);
        await expect(callback()).rejects.toThrow(
          /different .* renderer profile than the installed one; rebuild/,
        );
        expectNoStampedOutputs(context);
      }));

    it('rejects committed identity and router maps that omit an actual analyzed entry', async () =>
      withFixture(async context => {
        const { artifact, compiled } = await nativeCarriers(renderer);
        writeJson(
          path.join(context.appDirectory, ULTRAMODERN_BUILD_ARTIFACT_PATH),
          artifact,
        );
        writeJson(
          path.join(context.distDirectory, RENDERER_BUILD_MANIFEST_FILE),
          {
            ...compiled,
            entries: { main: compiled.entries.main },
            routerBindings: { main: compiled.routerBindings.main },
          },
        );
        const callback = await captureStampCallback(renderer, context);
        await expect(callback()).rejects.toThrow(
          /exactly match the actual application entries/,
        );
        expectNoStampedOutputs(context);
      }));

    it('rejects a malformed authored generated carrier before emitting output', async () =>
      withFixture(async context => {
        const { compiled } = await nativeCarriers(renderer);
        writeJson(
          path.join(context.appDirectory, ULTRAMODERN_BUILD_ARTIFACT_PATH),
          { kind: 'invalid-carrier' },
        );
        writeJson(
          path.join(context.distDirectory, RENDERER_BUILD_MANIFEST_FILE),
          compiled,
        );
        const callback = await captureStampCallback(renderer, context);
        await expect(callback()).rejects.toThrow();
        expectNoStampedOutputs(context);
      }));

    it('leaves an ordinary native app without a generated UI carrier unstamped', async () =>
      withFixture(async context => {
        const callback = await captureStampCallback(renderer, context);
        await expect(callback()).resolves.toBeUndefined();
        expectNoStampedOutputs(context);
        expect(fs.existsSync(context.distDirectory)).toBe(false);
      }));
  },
);
