import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTopologyDeliveryUnit } from '@modern-js/app-tools-extensions/cloudflare/delivery-unit';
import { emitRendererBuildArtifact } from '@modern-js/app-tools-extensions/release-envelope/renderer-output-stamp';
import { resolveUltramodernReleaseIdentity } from '@modern-js/app-tools-extensions/release-identity';
import {
  createUltramodernBuildArtifact,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
} from '@modern-js/backend-federation-contracts';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  createRendererBuildManifest,
  readRendererBuildManifest,
  writeRendererBuildManifest,
} from '../../src/native-composition/native-build-manifest';
import { createPresetUltramodernConfig } from '../../src/native-composition/preset';
import { createRendererBuildOutputResolver } from '../../src/native-composition/renderer-build-output';
import { createRendererBuildIdentityResolver } from '../../src/native-composition/renderer-build-resolution';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';
import {
  nativeInfrastructurePluginName,
  resolveNativeRendererAdapter,
} from '../../src/native-composition/renderer-registration';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

const gitEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toUpperCase().startsWith('GIT_'),
    ),
  );

const record = (appId: string, buildMarker: string) => ({
  schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
  kind: DELIVERY_UNIT_KIND,
  deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
  appId,
  unitId: `demo/${appId}`,
  packageName: `@demo/${appId}`,
  version: '1.0.0',
  sourceRevision: 'workspace',
  buildMarker,
});

/** A committed workspace with one UI shell and one API-only vertical. */
async function cleanWorkspace(
  beforeCommit: (root: string) => Promise<void> = async () => {},
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-release-identity-prebuild-')),
  );
  roots.push(root);
  const shell = record('shell', '1'.repeat(16));
  const orders = record('orders', '2'.repeat(16));
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(
      path.join(root, file),
      typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    );
  };
  write('pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
  write('.gitignore', 'dist/\n');
  write('apps/shell/package.json', { name: '@demo/shell', version: '1.0.0' });
  write('apps/orders/package.json', { name: '@demo/orders', version: '1.0.0' });
  write('topology/reference-topology.json', {
    schemaVersion: 1,
    shell: {
      id: 'shell',
      kind: 'shell',
      path: 'apps/shell',
      surfaceProfile: 'ui-only',
      deliveryUnit: shell,
    },
    verticals: [
      {
        id: 'orders',
        kind: 'vertical',
        path: 'apps/orders',
        surfaceProfile: 'api-only',
        deliveryUnit: orders,
      },
    ],
  });
  await beforeCommit(root);
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      env: gitEnv(),
      encoding: 'utf8',
    }).trim();
  git(['init', '--quiet']);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  ]);
  return { root, shell, orders, revision: git(['rev-parse', 'HEAD']) };
}

/** What release plans and contracts compute before anything is built. */
const prebuild = (root: string, unit: ReturnType<typeof record>) =>
  resolveUltramodernReleaseIdentity({
    generationBuildMarker: unit.buildMarker,
    unitId: unit.unitId,
    workspaceRoot: root,
  });

describe('one delivery-unit identity before and after the build', () => {
  it('a UI unit builds with the release identity resolved before its build', async () => {
    const previous = process.env.ULTRAMODERN_SOURCE_REVISION;
    delete process.env.ULTRAMODERN_SOURCE_REVISION;
    try {
      const entrypoints = (appDirectory: string) => [
        {
          entryName: 'main',
          isMainEntry: true,
          entry: path.join(appDirectory, 'src/App.tsx'),
        },
      ];
      const profile = resolveRendererProfile('solid');
      const resolveIdentities = (
        appDirectory: string,
        mode: 'development' | 'production',
      ) =>
        createRendererBuildIdentityResolver('solid')({
          entrypoints: entrypoints(appDirectory),
          appDirectory,
          internalDirectory: path.join(appDirectory, 'node_modules/.modern-js'),
          distDirectory: path.join(appDirectory, 'dist'),
          packageName: '@demo/shell',
          pluginNames: [nativeInfrastructurePluginName('solid')],
          mode,
        });
      const { root, shell, revision } = await cleanWorkspace(async root => {
        // The generated UI carrier is committed source, like sync-delivery-unit.
        const appDirectory = path.join(root, 'apps/shell');
        const generated = await resolveIdentities(appDirectory, 'development');
        const unit = record('shell', '1'.repeat(16));
        fs.mkdirSync(path.join(appDirectory, 'shared'), { recursive: true });
        fs.writeFileSync(
          path.join(appDirectory, 'shared/ultramodern-build.json'),
          JSON.stringify(
            createUltramodernBuildArtifact(unit, {
              ui: {
                identity: {
                  ...generated.identities.main,
                  buildId: unit.buildMarker,
                },
                profile: {
                  renderer: profile.renderer,
                  protocolVersion: profile.protocolVersion,
                  compiler: profile.compiler,
                  hydration: profile.hydration,
                  router: profile.router,
                },
                routerBindings: generated.routerBindings,
              },
            }),
          ),
        );
      });
      const expected = prebuild(root, shell);
      expect(expected.sourceRevision).toBe(revision);

      // The build: resolve renderer identities, then commit the manifest.
      const appDirectory = path.join(root, 'apps/shell');
      const distDirectory = path.join(appDirectory, 'dist');
      const identities = await resolveIdentities(appDirectory, 'production');
      await writeRendererBuildManifest(
        distDirectory,
        createRendererBuildManifest(
          profile,
          identities,
          resolveNativeRendererAdapter('solid').worker,
        ),
      );
      const stamped = await emitRendererBuildArtifact(
        { appDirectory, distDirectory, entrypoints: entrypoints(appDirectory) },
        {
          resolveRendererBuild: createRendererBuildOutputResolver('solid'),
          rendererBuildPlugin: nativeInfrastructurePluginName('solid'),
        },
      );
      const manifest = await readRendererBuildManifest(distDirectory, profile);
      const preset = createPresetUltramodernConfig({
        deliveryUnit: { ...shell, workspaceRoot: root },
      });

      for (const built of [
        identities.buildId,
        manifest.buildId,
        manifest.entries.main.buildId,
        stamped?.deliveryUnit.buildMarker,
        stamped?.surfaces.ui?.buildMarker,
        stamped?.surfaces.ui?.rendererIdentity.buildId,
        preset.source?.globalVars?.ULTRAMODERN_BUILD_MARKER,
        (await resolveTopologyDeliveryUnit(appDirectory))?.buildMarker,
      ])
        expect(built).toBe(expected.buildMarker);
      expect(stamped?.deliveryUnit.sourceRevision).toBe(revision);
      // A full digest: renderer manifests and envelopes require 64 hex.
      expect(expected.buildMarker).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      if (previous !== undefined)
        process.env.ULTRAMODERN_SOURCE_REVISION = previous;
    }
  });

  it('an API-only unit builds with the release identity resolved before its build', async () => {
    const previous = process.env.ULTRAMODERN_SOURCE_REVISION;
    delete process.env.ULTRAMODERN_SOURCE_REVISION;
    try {
      const { root, orders, shell, revision } = await cleanWorkspace();
      const expected = prebuild(root, orders);
      expect(expected.sourceRevision).toBe(revision);
      expect(expected.buildMarker).not.toBe(prebuild(root, shell).buildMarker);
      const preset = createPresetUltramodernConfig({
        deliveryUnit: { ...orders, workspaceRoot: root },
      });
      expect(preset.source?.globalVars?.ULTRAMODERN_BUILD_MARKER).toBe(
        expected.buildMarker,
      );
      expect(
        (await resolveTopologyDeliveryUnit(path.join(root, 'apps/orders')))
          ?.buildMarker,
      ).toBe(expected.buildMarker);
    } finally {
      if (previous !== undefined)
        process.env.ULTRAMODERN_SOURCE_REVISION = previous;
    }
  });
});
