import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  emitCloudflareStagedReleaseEnvelope,
  emitFrameworkMicroVerticalReleaseEnvelope,
  emitNodeStagedReleaseEnvelope,
  MICROVERTICAL_RELEASE_ENVELOPE_PATH,
  verifyBuildOutputReleaseEnvelope,
  verifyCloudflareReleaseEnvelopeStaging,
  verifyNodeReleaseEnvelopeStaging,
} from '@modern-js/app-tools-extensions/release-envelope/framework-output';
import {
  createUltramodernReleaseEnvelopePlugin,
  type ReleaseEnvelopePluginApi,
} from '@modern-js/app-tools-extensions/release-envelope/plugin';
import type { MicroVerticalReleaseTarget } from '@modern-js/app-tools-extensions/release-envelope/types';
import {
  createUltramodernBuildArtifact,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitRecord,
} from '@modern-js/backend-federation-contracts';
import { uiBuildArtifactOptions } from '../../../app-tools-extensions/tests/renderer-release-fixture';
import { ultramodernReleaseEnvelopePlugin } from '../../src/native-composition/release-envelope-plugin';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';

const temporaryDirectories: string[] = [];

const identity = {
  buildMarker: '0123456789abcdef',
  releaseVersion: '1.0.0',
  sourceRevision: 'a'.repeat(40),
  unitId: 'tractor-store/catalog',
};

const deliveryUnit: DeliveryUnitRecord = {
  appId: 'catalog',
  deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
  kind: DELIVERY_UNIT_KIND,
  packageName: '@tractor-store/catalog',
  schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
  version: identity.releaseVersion,
  ...identity,
};

const compiledModule = (commonjs = false) =>
  commonjs
    ? 'module.exports = { render: () => "catalog" };\n'
    : 'export const render = () => "catalog";\n';

const writeJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const createTargetBuildOutput = async (
  target: MicroVerticalReleaseTarget,
  { uiOnly = false }: { uiOnly?: boolean } = {},
) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), `modern-release-envelope-${target}-`),
  );
  temporaryDirectories.push(root);
  const distDirectory = path.join(
    root,
    uiOnly && target === 'cloudflare' ? 'dist-cloudflare' : 'dist',
  );
  const unit = uiOnly
    ? { ...deliveryUnit, buildMarker: 'f'.repeat(64) }
    : deliveryUnit;
  const { renderer, protocolVersion, compiler, hydration, router } =
    resolveRendererProfile('react');
  const ui = {
    ...uiBuildArtifactOptions(unit.buildMarker, unit.appId).ui,
    profile: { renderer, protocolVersion, compiler, hydration, router },
  };
  const files: Record<string, string> = {
    'static/catalog.js': compiledModule(),
    'static/catalog.css': '.catalog{color:green}',
    'html/main/index.html': '<main>catalog</main>',
    ...(!uiOnly ? { 'backendRemoteEntry.cjs': compiledModule(true) } : {}),
    'public/robots.txt': 'User-agent: *\nAllow: /\n',
    'mf-manifest.json': JSON.stringify(
      uiOnly
        ? {
            name: 'shellCatalog',
            metaData: {
              publicPath: '/',
              remoteEntry: { name: '', path: '', type: 'global' },
            },
            exposes: [],
            remotes: [
              {
                federationContainerName: 'verticalInventory',
                moduleName: 'Widget',
                alias: 'inventory',
                entry: 'http://localhost:51246/mf-manifest.json',
              },
            ],
          }
        : {
            name: 'verticalCatalog',
            pluginVersion: '2.8.0',
            exposes: [
              {
                path: './Route',
                assets: { js: { sync: ['static/catalog.js'], async: [] } },
              },
            ],
          },
    ),
    ...(uiOnly
      ? {
          'routes-manifest.json': JSON.stringify({
            routeAssets: { main: { assets: ['/static/catalog.js'] } },
          }),
        }
      : {}),
    'route.json': JSON.stringify({
      routes: [
        target === 'node'
          ? { bundle: 'bundles/main.js', urlPath: '/' }
          : { worker: 'worker/main.js', urlPath: '/' },
      ],
    }),
    ...(target === 'node'
      ? {
          ...(!uiOnly ? { 'api/index.js': compiledModule() } : {}),
          'bundles/main.js': compiledModule(),
        }
      : {
          'worker/main.js': compiledModule(),
          ...(!uiOnly
            ? { 'worker/__modern_bff_effect.js': compiledModule() }
            : {}),
        }),
  };
  await Promise.all(
    Object.entries(files).map(async ([logicalPath, contents]) => {
      const filePath = path.join(distDirectory, logicalPath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents);
    }),
  );
  await writeJson(
    path.join(distDirectory, 'ultramodern-build.json'),
    createUltramodernBuildArtifact(unit, { ui }),
  );
  const { buildMarker, sourceRevision, unitId } = unit;
  if (!uiOnly)
    await writeJson(path.join(distDirectory, 'backend-mf-manifest.json'), {
      backendFederation: {
        deliveryUnit: unit,
        versionBoundary: {
          deliveryUnit: { buildMarker, sourceRevision, unitId },
        },
      },
    });
  if (uiOnly) {
    await writeJson(path.join(root, 'topology/reference-topology.json'), {
      shell: {
        id: unit.appId,
        kind: 'shell',
        path: '.',
        surfaceProfile: 'ui-only',
        deliveryUnit: unit,
        renderer: ui.identity.renderer,
        rendererIdentity: ui.identity,
        rendererProfile: ui.profile,
        routerBindings: ui.routerBindings,
      },
      verticals: [],
    });
  }
  return { distDirectory, root, deliveryUnit: unit, ui };
};

const stageNodeOutput = async (
  fixture: { distDirectory: string; root: string },
  name: string,
) => {
  const outputDirectory = path.join(fixture.root, name);
  await fs.cp(fixture.distDirectory, outputDirectory, { recursive: true });
  await fs.rm(path.join(outputDirectory, 'release'), {
    force: true,
    recursive: true,
  });
  await fs.writeFile(path.join(outputDirectory, 'index.js'), compiledModule());
  await writeJson(path.join(outputDirectory, 'package.json'), {
    type: 'commonjs',
  });
  return outputDirectory;
};

const createCloudflareStaging = async (
  distDirectory: string,
  outputDirectory: string,
  uiOnly = false,
) => {
  await fs.mkdir(path.join(outputDirectory, 'public'), { recursive: true });
  for (const [from, to] of [
    ['static', 'public/static'],
    ['html', 'public/html'],
    ['mf-manifest.json', 'public/mf-manifest.json'],
    ...(uiOnly
      ? [['routes-manifest.json', 'public/routes-manifest.json']]
      : []),
    ...(!uiOnly
      ? [
          ['backend-mf-manifest.json', 'public/backend-mf-manifest.json'],
          ['backendRemoteEntry.cjs', 'public/backendRemoteEntry.cjs'],
        ]
      : []),
    ['ultramodern-build.json', 'public/ultramodern-build.json'],
    ['worker', 'worker'],
    ['route.json', 'server/route.json'],
  ]) {
    await fs.mkdir(path.dirname(path.join(outputDirectory, to!)), {
      recursive: true,
    });
    await fs.cp(
      path.join(distDirectory, from!),
      path.join(outputDirectory, to!),
      { recursive: true },
    );
  }
  await fs.writeFile(
    path.join(outputDirectory, 'server/index.mjs'),
    compiledModule(),
  );
  await writeJson(
    path.join(outputDirectory, 'server/modern-worker-manifest.json'),
    { version: 1 },
  );
  await writeJson(path.join(outputDirectory, 'wrangler.json'), {
    main: 'server/index.mjs',
  });
  await writeJson(path.join(outputDirectory, 'package.json'), {
    type: 'module',
  });
  await writeJson(path.join(outputDirectory, 'worker/package.json'), {
    type: 'module',
  });
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe('framework target-specific MicroVertical release-envelope integration', () => {
  it('keeps an ordinary UI build and fresh Node deploy outside the delivery-unit lifecycle', async () => {
    const fixture = await createTargetBuildOutput('node', { uiOnly: true });
    await fs.unlink(path.join(fixture.distDirectory, 'ultramodern-build.json'));
    await fs.unlink(
      path.join(fixture.root, 'topology/reference-topology.json'),
    );
    const afterBuild: Array<() => Promise<void>> = [];
    const beforeDeploy: Array<() => Promise<void>> = [];
    const afterDeploy: Array<() => Promise<void>> = [];
    const api: ReleaseEnvelopePluginApi = {
      getAppContext: () => ({
        apiOnly: false,
        appDirectory: fixture.root,
        distDirectory: fixture.distDirectory,
        metaName: 'ultramodern',
      }),
      getNormalizedConfig: () => ({ deploy: { target: 'node' } }),
      onAfterBuild: handler => afterBuild.push(handler),
      onBeforeDeploy: handler => beforeDeploy.push(handler),
      onAfterDeploy: handler => afterDeploy.push(handler),
    };
    const options = { resolveDeployTarget: () => 'node' };
    createUltramodernReleaseEnvelopePlugin(options).setup(api);
    await expect(afterBuild[0]!()).resolves.toBeUndefined();
    await expect(
      verifyBuildOutputReleaseEnvelope(fixture.distDirectory, 'node'),
    ).resolves.toBeUndefined();
    createUltramodernReleaseEnvelopePlugin(options).setup(api);
    await expect(beforeDeploy[1]!()).resolves.toBeUndefined();
    const outputDirectory = await stageNodeOutput(fixture, '.output');
    await expect(afterDeploy[1]!()).resolves.toBeUndefined();
    for (const root of [fixture.distDirectory, outputDirectory])
      await expect(
        fs.access(path.join(root, MICROVERTICAL_RELEASE_ENVELOPE_PATH)),
      ).rejects.toThrow();
  });

  it.each([
    'source carrier',
    'source declaration',
    'topology',
  ] as const)('refuses a missing finalized UI carrier when participation is declared by %s', async declaration => {
    const fixture = await createTargetBuildOutput('node', { uiOnly: true });
    const carrierPath = path.join(
      fixture.distDirectory,
      'ultramodern-build.json',
    );
    if (declaration !== 'topology')
      await fs.unlink(
        path.join(fixture.root, 'topology/reference-topology.json'),
      );
    if (declaration === 'source carrier')
      await writeJson(
        path.join(fixture.root, 'shared/ultramodern-build.json'),
        JSON.parse(await fs.readFile(carrierPath, 'utf8')),
      );
    if (declaration === 'source declaration') {
      await fs.mkdir(path.join(fixture.root, 'shared'), { recursive: true });
      await fs.writeFile(
        path.join(fixture.root, 'shared/ultramodern-build.ts'),
        'export const deliveryUnit = {} as const;\n',
      );
    }
    await fs.unlink(carrierPath);
    const afterBuild: Array<() => Promise<void>> = [];
    createUltramodernReleaseEnvelopePlugin({
      resolveDeployTarget: () => 'node',
    }).setup({
      getAppContext: () => ({
        apiOnly: false,
        appDirectory: fixture.root,
        distDirectory: fixture.distDirectory,
        metaName: 'ultramodern',
      }),
      getNormalizedConfig: () => ({ deploy: { target: 'node' } }),
      onAfterBuild: handler => afterBuild.push(handler),
      onBeforeDeploy: () => {},
      onAfterDeploy: () => {},
    });
    await expect(afterBuild[0]!()).rejects.toThrow(/ENOENT/u);
    await expect(
      fs.access(
        path.join(fixture.distDirectory, MICROVERTICAL_RELEASE_ENVELOPE_PATH),
      ),
    ).rejects.toThrow();
  });

  it.each([
    'corrupt',
    'dangling symlink',
    'directory',
  ] as const)('never treats a present %s finalized carrier as an ordinary UI build', async kind => {
    const fixture = await createTargetBuildOutput('node', { uiOnly: true });
    const carrierPath = path.join(
      fixture.distDirectory,
      'ultramodern-build.json',
    );
    await fs.unlink(carrierPath);
    await fs.unlink(
      path.join(fixture.root, 'topology/reference-topology.json'),
    );
    if (kind === 'corrupt') await fs.writeFile(carrierPath, '{');
    else if (kind === 'directory') await fs.mkdir(carrierPath);
    else await fs.symlink('missing-finalized-carrier.json', carrierPath);
    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        appDirectory: fixture.root,
        distDirectory: fixture.distDirectory,
        requirePromotable: false,
        target: 'node',
      }),
    ).rejects.toThrow();
  });

  it('emits and stages a declared UI-only Node release through a fresh deploy lifecycle', async () => {
    const fixture = await createTargetBuildOutput('node', { uiOnly: true });
    const { ui } = fixture;
    const afterBuild: Array<() => Promise<void>> = [];
    const beforeDeploy: Array<() => Promise<void>> = [];
    const afterDeploy: Array<() => Promise<void>> = [];
    const api: ReleaseEnvelopePluginApi = {
      getAppContext: () => ({
        apiOnly: false,
        appDirectory: fixture.root,
        distDirectory: fixture.distDirectory,
        metaName: 'ultramodern',
      }),
      getNormalizedConfig: () => ({ deploy: { target: 'node' } }),
      onAfterBuild: handler => afterBuild.push(handler),
      onBeforeDeploy: handler => beforeDeploy.push(handler),
      onAfterDeploy: handler => afterDeploy.push(handler),
    };
    const options = {
      resolveDeployTarget: (config: { deploy?: { target?: string } }) =>
        config.deploy?.target ?? 'node',
      resolveRendererProfile: () => ui.profile,
    };
    createUltramodernReleaseEnvelopePlugin(options).setup(api);
    await expect(
      verifyBuildOutputReleaseEnvelope(fixture.distDirectory, 'node'),
    ).rejects.toThrow(/required envelope is missing/u);
    await afterBuild[0]!();
    const source = await verifyBuildOutputReleaseEnvelope(
      fixture.distDirectory,
      'node',
    );
    expect(source?.identity).toEqual({
      unitId: fixture.deliveryUnit.unitId,
      buildMarker: fixture.deliveryUnit.buildMarker,
      sourceRevision: fixture.deliveryUnit.sourceRevision,
      releaseVersion: fixture.deliveryUnit.version,
    });
    expect(source?.ui).toEqual({
      rendererIdentity: ui.identity,
      rendererProfile: ui.profile,
      routerBindings: ui.routerBindings,
    });
    expect(source?.surfaces.apiBackend).toEqual([]);
    expect(Object.hasOwn(source?.surfaces ?? {}, 'backendFederation')).toBe(
      false,
    );
    expect(source?.artifacts.map(artifact => artifact.logicalPath)).toContain(
      'bundles/main.js',
    );
    expect(source?.artifacts.map(artifact => artifact.logicalPath)).toContain(
      'static/catalog.js',
    );
    createUltramodernReleaseEnvelopePlugin(options).setup(api);
    await beforeDeploy[1]!();
    const outputDirectory = await stageNodeOutput(fixture, '.output');
    await afterDeploy[1]!();
    const staged = await verifyNodeReleaseEnvelopeStaging({ outputDirectory });
    expect(staged?.identity).toEqual(source?.identity);
    expect(staged?.ui).toEqual(source?.ui);
    expect(staged?.surfaces.apiBackend).toEqual([]);
    expect(Object.hasOwn(staged?.surfaces ?? {}, 'backendFederation')).toBe(
      false,
    );
    for (const file of [
      'backendRemoteEntry.cjs',
      'backend-mf-manifest.json',
      'api/index.js',
    ])
      await expect(
        fs.access(path.join(outputDirectory, file)),
      ).rejects.toThrow();
    await fs.writeFile(
      path.join(outputDirectory, 'bundles/main.js'),
      'export const render = () => "tampered";\n',
    );
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).rejects.toThrow(/digest|byteLength|sha256/u);
  });

  it('emits and privately stages a declared UI-only Cloudflare release without an Effect worker', async () => {
    const fixture = await createTargetBuildOutput('cloudflare', {
      uiOnly: true,
    });
    const source = await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      appDirectory: fixture.root,
      distDirectory: fixture.distDirectory,
      target: 'cloudflare',
    });
    expect(source?.identity.buildMarker).toBe(fixture.deliveryUnit.buildMarker);
    expect(source?.ui?.rendererIdentity.buildId).toBe(
      fixture.deliveryUnit.buildMarker,
    );
    expect(source?.surfaces.apiBackend).toEqual([]);
    expect(Object.hasOwn(source?.surfaces ?? {}, 'backendFederation')).toBe(
      false,
    );
    const outputDirectory = path.join(fixture.root, '.output');
    await createCloudflareStaging(fixture.distDirectory, outputDirectory, true);
    const staged = await emitCloudflareStagedReleaseEnvelope({
      distDirectory: fixture.distDirectory,
      outputDirectory,
    });
    await expect(
      verifyCloudflareReleaseEnvelopeStaging(outputDirectory),
    ).resolves.toEqual(staged);
    expect(staged?.identity).toEqual(source?.identity);
    expect(staged?.ui).toEqual(source?.ui);
    expect(staged?.surfaces.apiBackend).toEqual([]);
    expect(Object.hasOwn(staged?.surfaces ?? {}, 'backendFederation')).toBe(
      false,
    );
    for (const file of [
      'public/backendRemoteEntry.cjs',
      'public/backend-mf-manifest.json',
      'worker/__modern_bff_effect.js',
      `public/${MICROVERTICAL_RELEASE_ENVELOPE_PATH}`,
    ])
      await expect(
        fs.access(path.join(outputDirectory, file)),
      ).rejects.toThrow();
    await fs.writeFile(
      path.join(outputDirectory, 'worker/main.js'),
      'export const render = () => "tampered";\n',
    );
    await expect(
      verifyCloudflareReleaseEnvelopeStaging(outputDirectory),
    ).rejects.toThrow(/digest|byteLength|sha256/u);
  });

  it.each([
    'node',
    'cloudflare',
  ] as const)('requires an explicit topology declaration before accepting UI-only %s output', async target => {
    const fixture = await createTargetBuildOutput(target, { uiOnly: true });
    await fs.unlink(
      path.join(fixture.root, 'topology/reference-topology.json'),
    );
    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        appDirectory: fixture.root,
        distDirectory: fixture.distDirectory,
        target,
      }),
    ).rejects.toThrow(
      /backend federation manifest and container must be emitted together/u,
    );
  });

  it.each([
    ['node', false],
    ['node', true],
    ['cloudflare', false],
    ['cloudflare', true],
  ] as const)('still requires the real backend pair for %s output with apiOnly=%s', async (target, apiOnly) => {
    const fixture = await createTargetBuildOutput(target);
    await fs.unlink(
      path.join(fixture.distDirectory, 'backend-mf-manifest.json'),
    );
    await fs.unlink(path.join(fixture.distDirectory, 'backendRemoteEntry.cjs'));
    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly,
        distDirectory: fixture.distDirectory,
        target,
      }),
    ).rejects.toThrow(
      /backend federation manifest and container must be emitted together/u,
    );
  });

  it.each([
    'node',
    'cloudflare',
  ] as const)('rejects API artifacts injected into declared UI-only %s build output', async target => {
    const fixture = await createTargetBuildOutput(target, { uiOnly: true });
    const apiPath =
      target === 'node' ? 'api/index.js' : 'worker/__modern_bff_effect.js';
    await fs.mkdir(path.dirname(path.join(fixture.distDirectory, apiPath)), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(fixture.distDirectory, apiPath),
      compiledModule(),
    );
    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        appDirectory: fixture.root,
        distDirectory: fixture.distDirectory,
        target,
      }),
    ).rejects.toThrow(
      /UI-only application emitted an undeclared API\/backend artifact/u,
    );
  });

  it.each([
    'node',
    'cloudflare',
  ] as const)('rejects API artifacts injected into final UI-only %s staging', async target => {
    const fixture = await createTargetBuildOutput(target, { uiOnly: true });
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      appDirectory: fixture.root,
      distDirectory: fixture.distDirectory,
      target,
    });
    const outputDirectory = path.join(fixture.root, '.output');
    if (target === 'node') await stageNodeOutput(fixture, '.output');
    else
      await createCloudflareStaging(
        fixture.distDirectory,
        outputDirectory,
        true,
      );
    const apiPath =
      target === 'node' ? 'api/index.js' : 'worker/__modern_bff_effect.js';
    await fs.mkdir(path.dirname(path.join(outputDirectory, apiPath)), {
      recursive: true,
    });
    await fs.writeFile(path.join(outputDirectory, apiPath), compiledModule());
    await expect(
      target === 'node'
        ? emitNodeStagedReleaseEnvelope({
            distDirectory: fixture.distDirectory,
            outputDirectory,
          })
        : emitCloudflareStagedReleaseEnvelope({
            distDirectory: fixture.distDirectory,
            outputDirectory,
          }),
    ).rejects.toThrow(
      /final UI-only (?:Node|Cloudflare) staging contains an undeclared API\/backend/u,
    );
  });

  it.each([
    ['node', false],
    ['node', true],
    ['cloudflare', false],
    ['cloudflare', true],
  ] as const)('still requires real API execution for %s output with apiOnly=%s', async (target, apiOnly) => {
    const fixture = await createTargetBuildOutput(target);
    await fs.unlink(
      path.join(
        fixture.distDirectory,
        target === 'node' ? 'api/index.js' : 'worker/__modern_bff_effect.js',
      ),
    );
    if (apiOnly) {
      await writeJson(
        path.join(fixture.distDirectory, 'ultramodern-build.json'),
        createUltramodernBuildArtifact(fixture.deliveryUnit),
      );
      await fs.rm(path.join(fixture.distDirectory, 'static'), {
        recursive: true,
      });
      await fs.rm(path.join(fixture.distDirectory, 'html'), {
        recursive: true,
      });
      await fs.unlink(path.join(fixture.distDirectory, 'mf-manifest.json'));
      await fs.rm(
        path.join(
          fixture.distDirectory,
          target === 'node' ? 'bundles' : 'worker',
        ),
        { recursive: true },
      );
    }
    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly,
        distDirectory: fixture.distDirectory,
        target,
      }),
    ).rejects.toThrow(
      /has no actual (?:compiled Node Effect API artifact|Effect API\/BFF worker artifact)/u,
    );
  });

  it.each([
    ['node', []],
    ['cloudflare', []],
    ['node', ['https://remote.example.test/static/catalog.js']],
    ['cloudflare', ['https://remote.example.test/static/catalog.js']],
  ] as const)('requires local route execution evidence for a native UI-only %s consumer', async (target, assets) => {
    const fixture = await createTargetBuildOutput(target, { uiOnly: true });
    await writeJson(path.join(fixture.distDirectory, 'routes-manifest.json'), {
      routeAssets: { main: { assets } },
    });
    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        appDirectory: fixture.root,
        distDirectory: fixture.distDirectory,
        target,
      }),
    ).rejects.toThrow(
      /UI\/client manifest references no compiled execution module/u,
    );
  });

  it('runs the Node release lifecycle against real build and staged artifacts', async () => {
    const fixture = await createTargetBuildOutput('node');
    const afterBuild: Array<() => Promise<void>> = [];
    const beforeDeploy: Array<() => Promise<void>> = [];
    const afterDeploy: Array<() => Promise<void>> = [];
    const plugin = ultramodernReleaseEnvelopePlugin();

    const api: ReleaseEnvelopePluginApi = {
      getAppContext: () => ({
        apiOnly: false,
        appDirectory: fixture.root,
        distDirectory: fixture.distDirectory,
        metaName: 'modern-js',
      }),
      getNormalizedConfig: () => ({ deploy: { target: 'node' } }),
      onAfterBuild: handler => afterBuild.push(handler),
      onBeforeDeploy: handler => beforeDeploy.push(handler),
      onAfterDeploy: handler => afterDeploy.push(handler),
    };
    Reflect.apply(plugin.setup!, plugin, [api]);

    await afterBuild[0]!();
    await expect(
      verifyBuildOutputReleaseEnvelope(fixture.distDirectory, 'node'),
    ).resolves.toMatchObject({ target: 'node' });
    await beforeDeploy[0]!();

    const outputDirectory = await stageNodeOutput(fixture, '.output');
    await afterDeploy[0]!();
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).resolves.toMatchObject({ target: 'node' });
  });

  it('binds internal Node package aliases to their final files', async () => {
    const fixture = await createTargetBuildOutput('node');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: fixture.distDirectory,
      target: 'node',
    });
    const outputDirectory = await stageNodeOutput(fixture, 'node-output-alias');
    const targetDirectory = path.join(
      outputDirectory,
      'node_modules/@bleedingdev/modern-js-bff-core',
    );
    const aliasDirectory = path.join(
      outputDirectory,
      'node_modules/@modern-js/bff-core',
    );
    await writeJson(path.join(targetDirectory, 'package.json'), {
      name: '@bleedingdev/modern-js-bff-core',
      version: '1.0.0',
    });
    await fs.writeFile(
      path.join(targetDirectory, 'index.js'),
      "module.exports = 'bff-core';\n",
    );
    const byteIdenticalTargetDirectory = path.join(
      outputDirectory,
      'node_modules/@bleedingdev/modern-js-bff-core-copy',
    );
    await fs.cp(targetDirectory, byteIdenticalTargetDirectory, {
      recursive: true,
    });
    await fs.mkdir(path.dirname(aliasDirectory), { recursive: true });
    await fs.symlink(
      path.relative(path.dirname(aliasDirectory), targetDirectory),
      aliasDirectory,
      'dir',
    );

    const envelope = await emitNodeStagedReleaseEnvelope({
      distDirectory: fixture.distDirectory,
      outputDirectory,
    });
    expect(
      envelope?.artifacts.find(
        artifact => artifact.logicalPath === 'node_modules/@modern-js/bff-core',
      ),
    ).toMatchObject({ kind: 'symbolic-link', targetKind: 'directory' });
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).resolves.toMatchObject({ target: 'node' });

    await fs.rm(aliasDirectory);
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).rejects.toThrow(/does not exist/u);

    await fs.symlink(
      path.relative(path.dirname(aliasDirectory), byteIdenticalTargetDirectory),
      aliasDirectory,
      'dir',
    );
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).rejects.toThrow(/does not match its final filesystem binding/u);
  });

  it('keeps the staged Cloudflare envelope out of the public directory', async () => {
    const fixture = await createTargetBuildOutput('cloudflare');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: fixture.distDirectory,
      target: 'cloudflare',
    });
    const outputDirectory = path.join(fixture.root, 'cloudflare-output');
    await createCloudflareStaging(fixture.distDirectory, outputDirectory);

    await expect(
      emitCloudflareStagedReleaseEnvelope({
        distDirectory: fixture.distDirectory,
        outputDirectory,
      }),
    ).resolves.toMatchObject({ target: 'cloudflare' });
    await expect(
      fs.access(
        path.join(outputDirectory, MICROVERTICAL_RELEASE_ENVELOPE_PATH),
      ),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(
          outputDirectory,
          'public',
          MICROVERTICAL_RELEASE_ENVELOPE_PATH,
        ),
      ),
    ).rejects.toThrow();
  });

  it('does not impose the UltraModern envelope on legacy backend output', async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'modern-release-envelope-legacy-'),
    );
    temporaryDirectories.push(root);
    await writeJson(path.join(root, 'backend-mf-manifest.json'), {
      remotes: [{ entry: 'backendRemoteEntry.cjs' }],
    });
    await fs.writeFile(
      path.join(root, 'backendRemoteEntry.cjs'),
      'module.exports = {};',
    );

    await expect(
      verifyBuildOutputReleaseEnvelope(root, 'node'),
    ).resolves.toBeUndefined();
  });

  it('rejects a vacuous SSR carrier declaration', async () => {
    const fixture = await createTargetBuildOutput('node');
    await writeJson(path.join(fixture.distDirectory, 'route.json'), {
      routes: [{ bundle: 'bundles/not-emitted.js', urlPath: '/' }],
    });
    await fs.writeFile(
      path.join(fixture.distDirectory, 'bundles/identity-decoy.js'),
      'export const decoy = true;\n',
    );

    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: fixture.distDirectory,
        target: 'node',
      }),
    ).rejects.toThrow(
      /route manifest references no emitted Node SSR execution module/u,
    );
  });
});
