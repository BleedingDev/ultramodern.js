import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import backendFederationBuildPlugin from '@modern-js/app-tools-extensions/backend-federation-build';
import {
  resolveTopologyDeliveryUnit,
  resolveWorkerDeliveryUnitStamp,
} from '@modern-js/app-tools-extensions/cloudflare/delivery-unit';
import { verifyDeliveryUnitIdentity } from '@modern-js/app-tools-extensions/cloudflare-output-verifier/identity';
import {
  createUltramodernBuildArtifact,
  type RendererName,
  type RendererProfile,
  stampUltramodernBuildArtifactIdentity,
} from '@modern-js/backend-federation-contracts';

const temporaryDirectories: string[] = [];
const profiles: Record<RendererName, RendererProfile> = {
  react: {
    renderer: 'react',
    protocolVersion: 1,
    compiler: { name: '@rsbuild/plugin-react', version: '2.1.1' },
    hydration: { name: 'react-dom', version: '19.3.0' },
    router: {
      name: '@tanstack/react-router',
      version: '1.170.39',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.32',
    },
  },
  solid: {
    renderer: 'solid',
    protocolVersion: 1,
    compiler: { name: '@solidjs/compiler', version: '2.0.0-rc.13' },
    hydration: { name: '@solidjs/web', version: '2.0.0-rc.13' },
    router: {
      name: '@tanstack/solid-router',
      version: '2.0.0-rc.8',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.22',
    },
  },
  octane: {
    renderer: 'octane',
    protocolVersion: 1,
    compiler: { name: '@octanejs/rspack-plugin', version: '0.1.55' },
    hydration: { name: 'octane', version: '0.7.1' },
    router: {
      name: '@octanejs/tanstack-router',
      version: '0.1.60',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.15',
    },
  },
};

const createDeliveryUnit = (appId: string) => ({
  appId,
  buildMarker: `build-${appId}`,
  deployProfile: 'cloudflare-ssr-mf-effect-v1' as const,
  kind: 'microvertical-delivery-unit' as const,
  packageName: `@profile-test/${appId}`,
  schemaVersion: 1 as const,
  sourceRevision: 'profile-test-revision',
  unitId: `profile-test/${appId}`,
  version: '0.1.0',
});

const uiOptions = (appId: string, renderer: RendererName = 'react') => ({
  identity: {
    renderer,
    appId,
    entryName: 'main',
    protocolVersion: 1 as const,
    buildId: createDeliveryUnit(appId).buildMarker,
  },
  profile: profiles[renderer],
  routerBindings: {
    main: {
      owner: 'fixture-file-routes',
      evidence: 'file-routes' as const,
      defaultProvider: {
        framework: renderer === 'react' ? ('tanstack' as const) : renderer,
        ...profiles[renderer].router,
      },
      providers: [
        {
          framework: renderer === 'react' ? ('tanstack' as const) : renderer,
          ...profiles[renderer].router,
        },
      ],
    },
  },
});

const writeWorkspace = async ({
  surfaceProfile = 'full-stack',
  renderer = 'react',
  artifact,
}: {
  surfaceProfile?: 'api-only' | 'ui-only' | 'full-stack';
  renderer?: RendererName;
  artifact?: unknown;
} = {}) => {
  const appId = 'catalog';
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'cloudflare-delivery-profile-'),
  );
  temporaryDirectories.push(workspaceRoot);
  const appDirectory = path.join(workspaceRoot, 'verticals', appId);
  const ui = uiOptions(appId, renderer);
  await fs.mkdir(path.join(workspaceRoot, 'topology'), { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, 'topology/reference-topology.json'),
    `${JSON.stringify({
      shell: { id: 'shell', kind: 'shell', path: 'shell' },
      verticals: [
        {
          id: appId,
          kind: 'vertical',
          path: `verticals/${appId}`,
          surfaceProfile,
          deliveryUnit: createDeliveryUnit(appId),
          ...(surfaceProfile === 'api-only'
            ? {}
            : {
                renderer,
                rendererIdentity: ui.identity,
                rendererProfile: ui.profile,
                routerBindings: ui.routerBindings,
              }),
        },
      ],
    })}\n`,
  );
  await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
  const emittedArtifact =
    artifact ??
    createUltramodernBuildArtifact(
      createDeliveryUnit(appId),
      surfaceProfile === 'api-only' ? {} : { ui },
    );
  await fs.writeFile(
    path.join(appDirectory, 'shared/ultramodern-build.json'),
    `${JSON.stringify(emittedArtifact)}\n`,
  );
  await fs.mkdir(path.join(appDirectory, 'dist'), { recursive: true });
  await fs.writeFile(
    path.join(appDirectory, 'dist/ultramodern-build.json'),
    JSON.stringify(emittedArtifact),
  );
  return { appDirectory, artifact: emittedArtifact };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { force: true, recursive: true })),
  );
});

it.each([
  'api-only',
  'ui-only',
  'full-stack',
] as const)('stamps only topology-emitted surfaces for %s without inventing UI', async surfaceProfile => {
  const { appDirectory } = await writeWorkspace({ surfaceProfile });
  const topology = await resolveTopologyDeliveryUnit(appDirectory);
  const worker = await resolveWorkerDeliveryUnitStamp(
    appDirectory,
    path.join(appDirectory, 'dist'),
  );

  expect(Boolean(topology?.surfaces.ui)).toBe(surfaceProfile !== 'api-only');
  expect(Boolean(worker?.surfaces.ui)).toBe(surfaceProfile !== 'api-only');
  expect(Boolean(topology?.surfaces.api)).toBe(surfaceProfile !== 'ui-only');
  expect(Boolean(worker?.surfaces.api)).toBe(surfaceProfile !== 'ui-only');
  if (surfaceProfile === 'api-only') {
    expect(Object.hasOwn(worker?.surfaces ?? {}, 'ui')).toBe(false);
  }

  const issues: Parameters<typeof verifyDeliveryUnitIdentity>[0] = [];
  verifyDeliveryUnitIdentity(
    issues,
    { deliveryUnit: worker },
    'modern-worker-manifest.json',
    topology,
  );
  expect(issues).toEqual([]);
});

it.each([
  'react',
  'solid',
  'octane',
] as const)('preserves the actual %s UI renderer identity and profile in the worker stamp', async renderer => {
  const { appDirectory } = await writeWorkspace({ renderer });
  const worker = await resolveWorkerDeliveryUnitStamp(
    appDirectory,
    path.join(appDirectory, 'dist'),
  );

  expect(worker).toMatchObject(createDeliveryUnit('catalog'));
  expect(worker?.surfaces.ui).toMatchObject({
    ...createDeliveryUnit('catalog'),
    surface: 'ui',
    rendererIdentity: uiOptions('catalog', renderer).identity,
    rendererProfile: profiles[renderer],
    routerBindings: uiOptions('catalog', renderer).routerBindings,
  });
});

it('preserves the compiled build identity without restamping generation inputs', async () => {
  const initial = createUltramodernBuildArtifact(
    createDeliveryUnit('catalog'),
    { ui: uiOptions('catalog') },
  );
  const finalized = stampUltramodernBuildArtifactIdentity(initial, {
    buildMarker: 'compiled-build-marker',
    sourceRevision: 'b'.repeat(40),
  });
  const { appDirectory } = await writeWorkspace({ artifact: finalized });
  await fs.writeFile(
    path.join(appDirectory, 'shared/ultramodern-build.json'),
    JSON.stringify(initial),
  );
  const worker = await resolveWorkerDeliveryUnitStamp(
    appDirectory,
    path.join(appDirectory, 'dist'),
  );
  expect(worker?.buildMarker).toBe('compiled-build-marker');
  expect(worker?.sourceRevision).toBe('b'.repeat(40));
  expect(worker?.surfaces.ui?.rendererIdentity.buildId).toBe(
    'compiled-build-marker',
  );
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(appDirectory, 'shared/ultramodern-build.json'),
        'utf8',
      ),
    ),
  ).toEqual(initial);
});

it('persists finalized UI-only output for cold deployment without backend federation', async () => {
  const { appDirectory, artifact } = await writeWorkspace({
    surfaceProfile: 'ui-only',
  });
  const distDirectory = path.join(appDirectory, 'dist-cloudflare');
  const ui = uiOptions('catalog');
  const buildMarker = '9'.repeat(64);
  const sourceRevision = 'b'.repeat(40);
  const resolveRendererBuild = rstest.fn(async () => ({
    buildMarker,
    sourceRevision,
    ui: {
      rendererIdentity: { ...ui.identity, buildId: buildMarker },
      rendererProfile: ui.profile,
      routerBindings: ui.routerBindings,
    },
  }));
  await expect(
    resolveWorkerDeliveryUnitStamp(appDirectory, distDirectory),
  ).rejects.toThrow(/Finalized build artifact is required/);

  const afterBuild: Array<() => Promise<void>> = [];
  backendFederationBuildPlugin({
    resolveRendererBuild,
    rendererBuildPlugin: '@modern-js/renderer-react-build-metadata',
  }).setup({
    getAppContext: () => ({
      appDirectory,
      distDirectory,
      entrypoints: [{ entryName: 'main', isMainEntry: true }],
    }),
    onAfterBuild: handler => afterBuild.push(handler),
  });
  expect(resolveRendererBuild).not.toHaveBeenCalled();
  expect(afterBuild).toHaveLength(1);
  await afterBuild[0]!();

  const persisted = await fs.readFile(
    path.join(distDirectory, 'ultramodern-build.json'),
    'utf8',
  );
  expect(
    await fs.readFile(
      path.join(distDirectory, 'public/ultramodern-build.json'),
      'utf8',
    ),
  ).toBe(persisted);
  const worker = await resolveWorkerDeliveryUnitStamp(
    appDirectory,
    distDirectory,
  );
  expect(worker?.buildMarker).toBe(buildMarker);
  expect(worker?.sourceRevision).toBe(sourceRevision);
  expect(worker?.surfaces.ui?.rendererIdentity).toEqual({
    ...ui.identity,
    buildId: buildMarker,
  });
  expect(worker?.surfaces.ui?.rendererProfile).toEqual(ui.profile);
  expect(worker?.surfaces.ui?.routerBindings).toEqual(ui.routerBindings);
  expect(Object.hasOwn(worker?.surfaces ?? {}, 'api')).toBe(false);
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(appDirectory, 'shared/ultramodern-build.json'),
        'utf8',
      ),
    ),
  ).toEqual(artifact);
  for (const file of ['backendRemoteEntry.cjs', 'backend-mf-manifest.json'])
    await expect(fs.access(path.join(distDirectory, file))).rejects.toThrow();
  expect(resolveRendererBuild).toHaveBeenCalledOnce();
  expect(resolveRendererBuild).toHaveBeenCalledWith({
    appDirectory,
    distDirectory,
    entrypoints: [{ entryName: 'main', isMainEntry: true }],
  });
});

it('does not manufacture a finalized UI-only artifact when its compiler output is missing', async () => {
  const { appDirectory } = await writeWorkspace({ surfaceProfile: 'ui-only' });
  const distDirectory = path.join(appDirectory, 'dist-cloudflare');
  const afterBuild: Array<() => Promise<void>> = [];
  backendFederationBuildPlugin({
    resolveRendererBuild: async () => {
      throw new Error('Finalized renderer output is missing');
    },
    rendererBuildPlugin: '@modern-js/renderer-react-build-metadata',
  }).setup({
    getAppContext: () => ({
      appDirectory,
      distDirectory,
      entrypoints: [{ entryName: 'main', isMainEntry: true }],
    }),
    onAfterBuild: handler => afterBuild.push(handler),
  });
  await expect(afterBuild[0]!()).rejects.toThrow(
    'Finalized renderer output is missing',
  );
  await expect(
    fs.access(path.join(distDirectory, 'ultramodern-build.json')),
  ).rejects.toThrow();
  await expect(
    resolveWorkerDeliveryUnitStamp(appDirectory, distDirectory),
  ).rejects.toThrow(/Finalized build artifact is required/);
});

it('rejects a generation-only artifact before worker output and preserves required final bindings', async () => {
  const { appDirectory } = await writeWorkspace();
  await fs.unlink(path.join(appDirectory, 'dist/ultramodern-build.json'));
  await expect(
    resolveWorkerDeliveryUnitStamp(
      appDirectory,
      path.join(appDirectory, 'dist'),
    ),
  ).rejects.toThrow(/Finalized build artifact is required/);
});

it('rejects a record-only artifact for a UI topology instead of inventing a UI stamp', async () => {
  const { appDirectory } = await writeWorkspace({
    artifact: createUltramodernBuildArtifact(createDeliveryUnit('catalog')),
  });
  await expect(
    resolveWorkerDeliveryUnitStamp(
      appDirectory,
      path.join(appDirectory, 'dist'),
    ),
  ).rejects.toThrow('Build artifact UI surface must match');
});

it('rejects an actual UI artifact for API-only topology', async () => {
  const { appDirectory } = await writeWorkspace({
    surfaceProfile: 'api-only',
    artifact: createUltramodernBuildArtifact(createDeliveryUnit('catalog'), {
      ui: uiOptions('catalog'),
    }),
  });
  await expect(
    resolveWorkerDeliveryUnitStamp(
      appDirectory,
      path.join(appDirectory, 'dist'),
    ),
  ).rejects.toThrow('Build artifact UI surface must match');
});

it('rejects an API-only artifact belonging to another app despite identical delivery identity', async () => {
  const { appDirectory } = await writeWorkspace({
    surfaceProfile: 'api-only',
    artifact: createUltramodernBuildArtifact({
      ...createDeliveryUnit('catalog'),
      appId: 'inventory',
    }),
  });
  await expect(
    resolveWorkerDeliveryUnitStamp(
      appDirectory,
      path.join(appDirectory, 'dist'),
    ),
  ).rejects.toThrow('Build artifact appId must match');
});

it('rejects compiler profile drift even when delivery-unit identity matches', async () => {
  const ui = uiOptions('catalog');
  const { appDirectory } = await writeWorkspace({
    artifact: createUltramodernBuildArtifact(createDeliveryUnit('catalog'), {
      ui: {
        ...ui,
        profile: {
          ...ui.profile,
          compiler: { ...ui.profile.compiler, version: '2.0.0' },
        },
      },
    }),
  });
  await expect(
    resolveWorkerDeliveryUnitStamp(
      appDirectory,
      path.join(appDirectory, 'dist'),
    ),
  ).rejects.toThrow('rendererProfile.compiler.version');
});

it('rejects obsolete artifact schema before stamping a worker identity', async () => {
  const artifact = createUltramodernBuildArtifact(
    createDeliveryUnit('catalog'),
  );
  const { appDirectory } = await writeWorkspace({
    surfaceProfile: 'api-only',
    artifact: { ...artifact, schemaVersion: 1 },
  });
  await expect(
    resolveWorkerDeliveryUnitStamp(
      appDirectory,
      path.join(appDirectory, 'dist'),
    ),
  ).rejects.toThrow('artifact.schemaVersion');
});

it('rejects a worker manifest that invents a UI surface for api-only', () => {
  const deliveryUnit = createDeliveryUnit('catalog');
  const api = { ...deliveryUnit, surface: 'api' as const };
  const ui = { ...deliveryUnit, surface: 'ui' as const };
  const topology = { ...deliveryUnit, surfaces: { api } };
  const issues: Parameters<typeof verifyDeliveryUnitIdentity>[0] = [];

  verifyDeliveryUnitIdentity(
    issues,
    { deliveryUnit: { ...deliveryUnit, surfaces: { api, ui } } },
    'modern-worker-manifest.json',
    topology,
  );

  expect(issues).toEqual([
    expect.objectContaining({
      code: 'delivery-unit-drift',
      message: expect.stringContaining('unexpected ui delivery-unit surface'),
    }),
  ]);
});

it('rejects a missing declared API surface marker', () => {
  const deliveryUnit = createDeliveryUnit('catalog');
  const topology = {
    ...deliveryUnit,
    surfaces: { api: { ...deliveryUnit, surface: 'api' as const } },
  };
  const issues: Parameters<typeof verifyDeliveryUnitIdentity>[0] = [];

  verifyDeliveryUnitIdentity(
    issues,
    { deliveryUnit: { ...deliveryUnit, surfaces: {} } },
    'modern-worker-manifest.json',
    topology,
  );

  expect(issues).toEqual([
    expect.objectContaining({
      code: 'missing-delivery-unit',
      message: expect.stringContaining(
        'missing the api delivery-unit surface marker',
      ),
    }),
  ]);
});

it.each([
  undefined,
  [],
])('rejects absent or invalid delivery-unit surfaces %j', surfaces => {
  const deliveryUnit = createDeliveryUnit('catalog');
  const issues: Parameters<typeof verifyDeliveryUnitIdentity>[0] = [];

  verifyDeliveryUnitIdentity(
    issues,
    { deliveryUnit: { ...deliveryUnit, surfaces } },
    'modern-worker-manifest.json',
    {
      ...deliveryUnit,
      surfaces: { api: { ...deliveryUnit, surface: 'api' } },
    },
  );

  expect(issues).toEqual([
    expect.objectContaining({
      code: 'missing-delivery-unit',
      message: expect.stringContaining('missing delivery-unit surface markers'),
    }),
  ]);
});

it('rejects changed UI renderer ABI despite unchanged delivery identity', () => {
  const artifact = createUltramodernBuildArtifact(
    createDeliveryUnit('catalog'),
    {
      ui: uiOptions('catalog'),
    },
  );
  const marker = artifact.surfaces.ui;
  if (!marker) {
    throw new Error('Test artifact must contain a UI surface.');
  }
  const issues: Parameters<typeof verifyDeliveryUnitIdentity>[0] = [];

  verifyDeliveryUnitIdentity(
    issues,
    {
      deliveryUnit: {
        ...artifact.deliveryUnit,
        surfaces: {
          ...artifact.surfaces,
          ui: {
            ...marker,
            rendererProfile: {
              ...marker.rendererProfile,
              hydration: {
                ...marker.rendererProfile.hydration,
                version: '19.2.0',
              },
            },
          },
        },
      },
    },
    'modern-worker-manifest.json',
    { ...artifact.deliveryUnit, surfaces: artifact.surfaces },
  );

  expect(issues).toContainEqual(
    expect.objectContaining({
      code: 'delivery-unit-drift',
      message: expect.stringContaining('rendererProfile.hydration.version'),
    }),
  );
});

it('rejects a UI marker with no renderer metadata', () => {
  const deliveryUnit = createDeliveryUnit('catalog');
  const issues: Parameters<typeof verifyDeliveryUnitIdentity>[0] = [];

  verifyDeliveryUnitIdentity(
    issues,
    {
      deliveryUnit: {
        ...deliveryUnit,
        surfaces: { ui: { ...deliveryUnit, surface: 'ui' } },
      },
    },
    'modern-worker-manifest.json',
    undefined,
  );

  expect(issues).toContainEqual(
    expect.objectContaining({
      code: 'delivery-unit-drift',
      message: expect.stringContaining('UI rendererIdentity must be an object'),
    }),
  );
});

it('rejects a delivery-unit stamp that has no known surfaces without a topology declaration', () => {
  const issues: Parameters<typeof verifyDeliveryUnitIdentity>[0] = [];
  verifyDeliveryUnitIdentity(
    issues,
    { deliveryUnit: { ...createDeliveryUnit('catalog'), surfaces: {} } },
    'modern-worker-manifest.json',
    undefined,
  );
  expect(issues).toContainEqual(
    expect.objectContaining({ code: 'missing-delivery-unit' }),
  );
});

it.each([
  'missing root appId',
  'wrong root appId',
  'missing UI appId',
])('rejects %s before a verified worker can fail its renderer guard', corruption => {
  const artifact = createUltramodernBuildArtifact(
    createDeliveryUnit('catalog'),
    {
      ui: uiOptions('catalog'),
    },
  );
  const manifest = JSON.parse(
    JSON.stringify({
      deliveryUnit: { ...artifact.deliveryUnit, surfaces: artifact.surfaces },
    }),
  );
  if (corruption === 'missing root appId') {
    delete manifest.deliveryUnit.appId;
  } else if (corruption === 'wrong root appId') {
    manifest.deliveryUnit.appId = 'inventory';
  } else {
    delete manifest.deliveryUnit.surfaces.ui.appId;
  }
  const issues: Parameters<typeof verifyDeliveryUnitIdentity>[0] = [];
  verifyDeliveryUnitIdentity(issues, manifest, 'modern-worker-manifest.json', {
    ...artifact.deliveryUnit,
    surfaces: artifact.surfaces,
  });
  expect(issues).toContainEqual(
    expect.objectContaining({
      code: 'delivery-unit-drift',
      message: expect.stringContaining('appId'),
    }),
  );
});
