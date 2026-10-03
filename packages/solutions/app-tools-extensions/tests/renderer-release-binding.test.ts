import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createUltramodernBuildArtifact,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type RendererProfile,
} from '@modern-js/backend-federation-contracts';
import {
  digestMicroVerticalReleaseEnvelopePayload,
  releaseEnvelopePayload,
} from '../src/release-envelope/canonical';
import {
  emitFrameworkMicroVerticalReleaseEnvelope,
  readFrameworkMicroVerticalReleaseEnvelope,
} from '../src/release-envelope/framework-output';
import {
  createMicroVerticalReleaseEnvelope,
  verifyMicroVerticalReleaseEnvelope,
} from '../src/release-envelope/index';
import type {
  CreateMicroVerticalReleaseEnvelopeInput,
  MicroVerticalReleaseUi,
} from '../src/release-envelope/types';
import { reactReleaseUi } from './renderer-release-fixture';

const roots: string[] = [];
const identity = {
  unitId: 'test/catalog',
  buildMarker: 'final-build-123',
  sourceRevision: 'a'.repeat(40),
  releaseVersion: '1.0.0',
};
const deliveryUnit = {
  ...identity,
  appId: 'catalog',
  version: identity.releaseVersion,
  packageName: '@test/catalog',
  schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
  kind: DELIVERY_UNIT_KIND,
  deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
};

const nativeUi = (
  renderer: 'react' | 'solid' | 'octane',
): MicroVerticalReleaseUi => {
  const ui = reactReleaseUi(identity.buildMarker, deliveryUnit.appId);
  if (renderer === 'react') return ui;
  const rendererProfile: RendererProfile =
    renderer === 'solid'
      ? {
          renderer,
          protocolVersion: 1,
          compiler: { name: '@solidjs/compiler', version: '2.0.0-rc.13' },
          hydration: { name: '@solidjs/web', version: '2.0.0-rc.13' },
          router: {
            name: '@tanstack/solid-router',
            version: '2.0.0-rc.8',
            coreName: '@tanstack/router-core',
            coreVersion: '1.171.22',
          },
        }
      : {
          renderer,
          protocolVersion: 1,
          compiler: { name: '@octanejs/rspack-plugin', version: '0.1.55' },
          hydration: { name: 'octane', version: '0.7.1' },
          router: {
            name: '@octanejs/tanstack-router',
            version: '0.1.60',
            coreName: '@tanstack/router-core',
            coreVersion: '1.171.15',
          },
        };
  return {
    rendererIdentity: { ...ui.rendererIdentity, renderer },
    rendererProfile,
    routerBindings: {
      main: {
        owner: `@modern-js/renderer-${renderer}`,
        evidence: 'file-routes',
        defaultProvider: { framework: renderer, ...rendererProfile.router },
        providers: [{ framework: renderer, ...rendererProfile.router }],
      },
    },
  };
};

const fixture = async (ui: MicroVerticalReleaseUi) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'renderer-release-binding-'),
  );
  roots.push(root);
  const files = {
    'static/main.js': 'export const render = () => "client";',
    'bundles/main.js': 'export const render = () => "server";',
    'api/index.js': 'export const fetch = () => "api";',
    'backendRemoteEntry.cjs': 'exports.get = () => "api";',
    'mf-manifest.json': JSON.stringify({
      exposes: [{ assets: { js: { sync: ['static/main.js'] } } }],
    }),
    'route.json': JSON.stringify({ routes: [{ bundle: 'bundles/main.js' }] }),
    'backend-mf-manifest.json': JSON.stringify({
      backendFederation: { deliveryUnit, versionBoundary: { deliveryUnit } },
    }),
    'ultramodern-build.json': JSON.stringify(
      createUltramodernBuildArtifact(deliveryUnit, {
        ui: {
          identity: ui.rendererIdentity,
          profile: ui.rendererProfile,
          routerBindings: ui.routerBindings,
        },
      }),
    ),
  };
  for (const [name, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), contents);
  }
  const input: CreateMicroVerticalReleaseEnvelopeInput = {
    artifactRoot: root,
    target: 'node',
    identity,
    ui,
    artifacts: Object.keys(files).map(logicalPath => ({
      logicalPath,
      runtime:
        logicalPath === 'mf-manifest.json'
          ? 'browser'
          : logicalPath === 'backend-mf-manifest.json'
            ? 'module-federation-manifest'
            : logicalPath.startsWith('static/')
              ? 'browser'
              : 'nodejs',
    })),
    surfaces: {
      uiClient: ['static/main.js'],
      ssr: ['bundles/main.js'],
      apiBackend: ['api/index.js'],
      backendFederation: {
        manifest: 'backend-mf-manifest.json',
        container: 'backendRemoteEntry.cjs',
      },
    },
  };
  return { root, input };
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('immutable renderer release binding', () => {
  it('retains and freezes nonprimary router bindings and rejects bound map drift', async () => {
    const ui = nativeUi('solid');
    const fullUi = {
      ...ui,
      routerBindings: {
        ...ui.routerBindings,
        csr: { ...ui.routerBindings.main!, owner: 'csr-source-owner' },
      },
    };
    const { root } = await fixture(fullUi);
    const envelope = (await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: root,
      target: 'node',
    }))!;
    expect(envelope.ui!.routerBindings).toEqual(fullUi.routerBindings);
    expect(Object.isFrozen(envelope.ui!.routerBindings.csr!.providers[0])).toBe(
      true,
    );
    const changed = structuredClone(envelope);
    changed.ui = {
      ...changed.ui!,
      routerBindings: {
        ...changed.ui!.routerBindings,
        csr: { ...changed.ui!.routerBindings.csr!, owner: 'different-owner' },
      },
    };
    changed.envelopeDigest = digestMicroVerticalReleaseEnvelopePayload(
      releaseEnvelopePayload(changed),
    );
    await fs.writeFile(
      path.join(root, 'release/microvertical-release-envelope.json'),
      JSON.stringify(changed),
    );
    await expect(
      readFrameworkMicroVerticalReleaseEnvelope({ artifactRoot: root }),
    ).rejects.toThrow(/routerBindings differ/);
  });

  it('requires a canonical router map including the primary entry', async () => {
    const { input } = await fixture(nativeUi('solid'));
    for (const routerBindings of [
      undefined,
      {},
      { csr: input.ui!.routerBindings.main },
      {
        main: { ...input.ui!.routerBindings.main, evidence: 'plugin-presence' },
      },
    ]) {
      await expect(
        createMicroVerticalReleaseEnvelope({
          ...input,
          ui: { ...input.ui!, routerBindings } as MicroVerticalReleaseUi,
        }),
      ).rejects.toThrow(/routerBindings|evidence/);
    }
  });
  it.each([
    'react',
    'solid',
    'octane',
  ] as const)('preserves %s build evidence in an immutable framework envelope', async renderer => {
    const ui = nativeUi(renderer);
    const { root } = await fixture(ui);
    const envelope = await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: root,
      target: 'node',
      expectedRendererProfile: ui.rendererProfile,
    });
    expect(envelope?.schemaVersion).toBe(4);
    expect(envelope?.ui).toEqual(ui);
    expect(Object.isFrozen(envelope?.ui?.rendererIdentity)).toBe(true);
    expect(Object.isFrozen(envelope?.ui?.rendererProfile.router)).toBe(true);
    expect(
      envelope?.artifacts.some(
        artifact => artifact.logicalPath === 'ultramodern-build.json',
      ),
    ).toBe(true);
    await expect(
      readFrameworkMicroVerticalReleaseEnvelope({
        artifactRoot: root,
        expectedRendererProfile: ui.rendererProfile,
      }),
    ).resolves.toEqual(envelope);
  });

  it('rejects a configured cross-renderer profile before release metadata is emitted', async () => {
    const { root } = await fixture(nativeUi('solid'));
    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: root,
        target: 'node',
        expectedRendererProfile: nativeUi('react').rendererProfile,
      }),
    ).rejects.toThrow(/cross-renderer/);
    await expect(fs.access(path.join(root, 'release'))).rejects.toThrow();
  });

  it('binds entry, app, build and compiler evidence to the digest', async () => {
    const { root, input } = await fixture(nativeUi('solid'));
    const envelope = await createMicroVerticalReleaseEnvelope(input);
    for (const field of ['entryName', 'appId'] as const) {
      const changed = structuredClone(envelope);
      changed.ui!.rendererIdentity = {
        ...changed.ui!.rendererIdentity,
        [field]: 'different',
      };
      await expect(
        verifyMicroVerticalReleaseEnvelope(changed, { artifactRoot: root }),
      ).rejects.toThrow(/canonical payload|primary/);
    }
    const compiler = structuredClone(envelope);
    compiler.ui!.rendererProfile = {
      ...compiler.ui!.rendererProfile,
      compiler: {
        ...compiler.ui!.rendererProfile.compiler,
        version: '2.0.0-rc.12',
      },
    };
    await expect(
      verifyMicroVerticalReleaseEnvelope(compiler, { artifactRoot: root }),
    ).rejects.toThrow(/canonical payload/);
    const build = structuredClone(envelope);
    build.ui!.rendererIdentity = {
      ...build.ui!.rendererIdentity,
      buildId: 'stale-build',
    };
    await expect(
      verifyMicroVerticalReleaseEnvelope(build, { artifactRoot: root }),
    ).rejects.toThrow(/buildId.*buildMarker/);
  });

  it('rejects conflicting bound build carriers even when the envelope digest is valid', async () => {
    const { root } = await fixture(nativeUi('solid'));
    const envelope = (await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: root,
      target: 'node',
    }))!;
    const changed = structuredClone(envelope);
    changed.ui!.rendererIdentity = {
      ...changed.ui!.rendererIdentity,
      entryName: 'other-entry',
    };
    changed.envelopeDigest = digestMicroVerticalReleaseEnvelopePayload(
      releaseEnvelopePayload(changed),
    );
    await fs.writeFile(
      path.join(root, 'release/microvertical-release-envelope.json'),
      JSON.stringify(changed),
    );
    await expect(
      readFrameworkMicroVerticalReleaseEnvelope({ artifactRoot: root }),
    ).rejects.toThrow(/entryName.*differs|primary/);
  });

  it('requires native UI evidence and rejects legacy envelopes', async () => {
    const { root, input } = await fixture(nativeUi('octane'));
    const missing = { ...input };
    delete missing.ui;
    await expect(createMicroVerticalReleaseEnvelope(missing)).rejects.toThrow(
      /envelope.ui must be an object/,
    );
    const envelope = await createMicroVerticalReleaseEnvelope(input);
    await expect(
      verifyMicroVerticalReleaseEnvelope(
        { ...envelope, schemaVersion: 3 },
        { artifactRoot: root },
      ),
    ).rejects.toThrow(/schemaVersion must be 4/);
  });

  it('rejects a consuming ABI or entry mismatch before reading release bytes', async () => {
    const { input } = await fixture(nativeUi('solid'));
    const envelope = await createMicroVerticalReleaseEnvelope(input);
    const expected = nativeUi('solid');
    await expect(
      verifyMicroVerticalReleaseEnvelope(envelope, {
        artifactRoot: '/missing-renderer-release-root',
        expectedRendererProfile: {
          ...expected.rendererProfile,
          hydration: {
            ...expected.rendererProfile.hydration,
            version: '2.0.0-rc.12',
          },
        },
      }),
    ).rejects.toThrow(/hydration.version.*consuming renderer profile/);
    await expect(
      verifyMicroVerticalReleaseEnvelope(envelope, {
        artifactRoot: '/missing-renderer-release-root',
        expectedRendererIdentity: {
          ...expected.rendererIdentity,
          entryName: 'other-entry',
        },
      }),
    ).rejects.toThrow(/entryName.*consuming renderer identity/);
  });

  it('rejects a sealed envelope that discards its immutable build carrier', async () => {
    const { root } = await fixture(nativeUi('octane'));
    const envelope = (await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: root,
      target: 'node',
    }))!;
    const changed = structuredClone(envelope);
    changed.artifacts = changed.artifacts.filter(
      artifact => artifact.logicalPath !== 'ultramodern-build.json',
    );
    changed.envelopeDigest = digestMicroVerticalReleaseEnvelopePayload(
      releaseEnvelopePayload(changed),
    );
    await fs.writeFile(
      path.join(root, 'release/microvertical-release-envelope.json'),
      JSON.stringify(changed),
    );
    await expect(
      readFrameworkMicroVerticalReleaseEnvelope({ artifactRoot: root }),
    ).rejects.toThrow(/immutable build artifact must be bound/);
  });

  it('omits renderer evidence for headless releases and rejects a UI stamp', async () => {
    const { root, input } = await fixture(nativeUi('react'));
    const headless = {
      ...input,
      surfaces: { ...input.surfaces, uiClient: [], ssr: [] },
    };
    delete headless.ui;
    const envelope = await createMicroVerticalReleaseEnvelope(headless);
    expect(Object.hasOwn(envelope, 'ui')).toBe(false);
    await expect(
      verifyMicroVerticalReleaseEnvelope(envelope, { artifactRoot: root }),
    ).resolves.toEqual(envelope);
    await expect(
      createMicroVerticalReleaseEnvelope({ ...headless, ui: input.ui }),
    ).rejects.toThrow(/forbidden.*API-only/);
    await expect(
      createMicroVerticalReleaseEnvelope({ ...headless, ui: undefined }),
    ).rejects.toThrow(/forbidden.*API-only/);
  });
});
