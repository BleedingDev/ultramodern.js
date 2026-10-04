import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createUltramodernBuildArtifact,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  isUltramodernBuildArtifact,
} from '@modern-js/backend-federation-contracts';
import { resolveWorkerDeliveryUnitStamp } from '../src/cloudflare/delivery-unit';
import {
  createMicroVerticalReleaseEnvelope,
  MICROVERTICAL_RELEASE_ENVELOPE_KIND,
  SHELL_RELEASE_ENVELOPE_KIND,
  verifyMicroVerticalReleaseEnvelope,
} from '../src/release-envelope';
import * as sourceFramework from '../src/release-envelope/framework-output';
import { uiBuildArtifactOptions } from './renderer-release-fixture';

const roots: string[] = [];
const client = 'static/js/index.js';
const ssr = 'bundles/main.js';
const api = 'api/index.js';
const publicPath = 'https://assets.example.test/app/';
const deliveryUnit = {
  appId: 'catalog',
  buildMarker: '0123456789abcdef',
  deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
  kind: DELIVERY_UNIT_KIND,
  packageName: '@test/catalog',
  schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
  sourceRevision: 'a'.repeat(40),
  unitId: 'test/catalog',
  version: '1.0.0',
};

async function fixture(
  framework: typeof sourceFramework,
  role: 'microvertical' | 'shell' = 'microvertical',
  target: 'node' | 'cloudflare' = 'node',
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-mf-release-'));
  roots.push(root);
  const distDirectory = role === 'shell' ? path.join(root, 'dist') : root;
  const unit =
    role === 'shell'
      ? {
          ...deliveryUnit,
          appId: 'shell',
          packageName: '@test/shell',
          unitId: 'test/shell',
        }
      : deliveryUnit;
  const put = async (name: string, contents: string) => {
    await fs.mkdir(path.dirname(path.join(distDirectory, name)), {
      recursive: true,
    });
    await fs.writeFile(path.join(distDirectory, name), contents);
  };
  const json = (name: string, value: unknown) =>
    put(name, JSON.stringify(value));
  const manifest = {
    exposes: [],
    remotes:
      role === 'shell'
        ? [
            {
              federationContainerName: 'catalog',
              moduleName: 'catalog',
              alias: 'catalog',
              entry: 'https://assets.example.test/catalog/mf-manifest.json',
            },
          ]
        : [],
    metaData: {
      publicPath,
      remoteEntry: { name: '', path: '', type: 'global' },
    },
  };
  await json(
    'ultramodern-build.json',
    createUltramodernBuildArtifact(
      deliveryUnit,
      uiBuildArtifactOptions(deliveryUnit.buildMarker, deliveryUnit.appId),
    ),
  );
  await json('backend-mf-manifest.json', {
    backendFederation: { deliveryUnit, versionBoundary: { deliveryUnit } },
  });
  await json('mf-manifest.json', manifest);
  const routes = (assets: unknown[]) =>
    json('routes-manifest.json', {
      routeAssets: { index: { assets } },
    });
  await routes([`${publicPath}${client}`]);
  await json('route.json', {
    routes: [
      target === 'node' ? { bundle: ssr } : { worker: 'worker/main.js' },
    ],
  });
  await json('package.json', { type: 'module' });
  const modules =
    target === 'node'
      ? [client, ssr, api, 'index.js']
      : [
          client,
          'worker/main.js',
          'worker/__modern_bff_effect.js',
          'worker/__modern_worker_runtime.js',
          'worker/__modern_worker_shared.js',
        ];
  for (const name of modules) {
    await put(name, 'console.log("compiled fixture");');
  }
  const emit = () =>
    framework.emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      ...(role === 'shell' ? { appDirectory: root, role } : {}),
      distDirectory,
      target,
    });
  return { root, distDirectory, put, json, manifest, routes, emit };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => fs.rm(root, { force: true, recursive: true })),
  );
});

describe('workspace source revision', () => {
  const framework = sourceFramework;

  async function workspaceFixture() {
    const f = await fixture(framework);
    const workspaceUnit = { ...deliveryUnit, sourceRevision: 'workspace' };
    await f.json(
      'ultramodern-build.json',
      createUltramodernBuildArtifact(
        workspaceUnit,
        uiBuildArtifactOptions(workspaceUnit.buildMarker, workspaceUnit.appId),
      ),
    );
    await f.json('backend-mf-manifest.json', {
      backendFederation: {
        deliveryUnit: workspaceUnit,
        versionBoundary: { deliveryUnit: workspaceUnit },
      },
    });
    return f;
  }

  test('a plain build emits no envelope instead of failing', async () => {
    const f = await workspaceFixture();
    await expect(
      framework.emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: f.root,
        requirePromotable: false,
        target: 'node',
      }),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(f.root, framework.MICROVERTICAL_RELEASE_ENVELOPE_PATH),
      ),
    ).rejects.toThrow();
  });

  test('a promotion still refuses the non-promotable identity', async () => {
    const f = await workspaceFixture();
    await expect(
      framework.emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: f.root,
        target: 'node',
      }),
    ).rejects.toThrow(/cannot produce a promotable envelope/);
  });
});

describe('Shell consumer release', () => {
  const framework = sourceFramework;

  test('restamps every generated Shell build identity from workspace to clean Git', async () => {
    const configuredSourceRevision = process.env.ULTRAMODERN_SOURCE_REVISION;
    delete process.env.ULTRAMODERN_SOURCE_REVISION;
    try {
      const f = await fixture(framework, 'shell');
      const gitEnv = Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !name.toUpperCase().startsWith('GIT_'),
        ),
      );
      execFileSync('git', ['init', '--quiet'], {
        cwd: f.root,
        env: gitEnv,
      });
      await fs.writeFile(path.join(f.root, '.gitignore'), 'dist/\n.output/\n');
      const generatedIdentity = resolveUltramodernReleaseIdentity({
        generationBuildMarker: deliveryUnit.buildMarker,
        unitId: 'test/shell',
        workspaceRoot: f.root,
      });
      expect(generatedIdentity.sourceRevision).toBe('workspace');
      const generatedUnit = {
        ...deliveryUnit,
        ...generatedIdentity,
        appId: 'shell',
        packageName: '@test/shell',
        unitId: 'test/shell',
      };
      await fs.writeFile(
        path.join(f.root, 'shared/ultramodern-build.json'),
        JSON.stringify(createUltramodernBuildArtifact(generatedUnit)),
      );
      await fs.mkdir(path.join(f.root, 'topology'), { recursive: true });
      await fs.writeFile(
        path.join(f.root, 'topology/reference-topology.json'),
        JSON.stringify({
          shell: {
            id: 'shell',
            kind: 'shell',
            path: '.',
            surfaceProfile: 'full-stack',
            deliveryUnit: generatedUnit,
          },
          verticals: [],
        }),
      );
      execFileSync('git', ['add', '.'], { cwd: f.root, env: gitEnv });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Shell fixture',
          '-c',
          'user.email=shell-fixture@example.test',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'core.hooksPath=/dev/null',
          'commit',
          '--quiet',
          '-m',
          'Commit the generated Shell fixture',
        ],
        { cwd: f.root, env: gitEnv },
      );
      const cleanRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: f.root,
        env: gitEnv,
        encoding: 'utf8',
      }).trim();
      expect(
        execFileSync(
          'git',
          ['status', '--porcelain', '--untracked-files=all'],
          {
            cwd: f.root,
            env: gitEnv,
            encoding: 'utf8',
          },
        ).trim(),
      ).toBe('');
      const stamp = await resolveWorkerDeliveryUnitStamp(f.root);
      if (!stamp) {
        throw new Error('Expected the native clean Shell delivery-unit stamp.');
      }
      expect(stamp.sourceRevision).toBe(cleanRevision);
      expect(stamp.buildMarker).not.toBe(generatedIdentity.buildMarker);
      const envelope = await f.emit();
      expect(envelope?.identity).toMatchObject({
        buildMarker: stamp.buildMarker,
        sourceRevision: cleanRevision,
      });
      const emitted: unknown = JSON.parse(
        await fs.readFile(
          path.join(f.distDirectory, 'ultramodern-build.json'),
          'utf8',
        ),
      );
      expect(isUltramodernBuildArtifact(emitted)).toBe(true);
      if (!isUltramodernBuildArtifact(emitted)) {
        throw new Error(
          'Expected a valid native restamped Shell build artifact.',
        );
      }
      for (const identity of [
        emitted.deliveryUnit,
        emitted.surfaces.ui,
        emitted.surfaces.api,
      ]) {
        expect(identity).toMatchObject({
          unitId: stamp.unitId,
          build: stamp.buildMarker,
          buildMarker: stamp.buildMarker,
          sourceRevision: cleanRevision,
        });
      }
      await framework.verifyBuildOutputReleaseEnvelope(f.distDirectory, 'node');
    } finally {
      if (configuredSourceRevision === undefined) {
        delete process.env.ULTRAMODERN_SOURCE_REVISION;
      } else {
        process.env.ULTRAMODERN_SOURCE_REVISION = configuredSourceRevision;
      }
    }
  });

  test('binds complete Node build and staged output without a backend producer', async () => {
    const f = await fixture(framework, 'shell');
    const envelope = await f.emit();
    if (envelope?.kind !== SHELL_RELEASE_ENVELOPE_KIND) {
      throw new Error('Expected the native Shell release envelope.');
    }
    expect(envelope.identity).toMatchObject({
      unitId: 'test/shell',
      sourceRevision: deliveryUnit.sourceRevision,
    });
    expect(envelope.surfaces).toEqual({
      uiClient: ['mf-manifest.json', 'routes-manifest.json', client],
      ssr: [ssr],
      apiBackend: [api],
    });
    const boundPaths = [
      api,
      ssr,
      client,
      'index.js',
      'mf-manifest.json',
      'package.json',
      'route.json',
      'routes-manifest.json',
      'ultramodern-build.json',
      framework.MICROVERTICAL_RELEASE_IDENTITY_CARRIERS_PATH,
    ].sort((left, right) => left.localeCompare(right));
    expect(envelope.artifacts.map(artifact => artifact.logicalPath)).toEqual(
      boundPaths,
    );
    const created = await createMicroVerticalReleaseEnvelope({
      artifactRoot: f.distDirectory,
      kind: SHELL_RELEASE_ENVELOPE_KIND,
      target: 'node',
      identity: envelope.identity,
      artifacts: envelope.artifacts.map(({ logicalPath, runtime }) => ({
        logicalPath,
        runtime,
      })),
      surfaces: envelope.surfaces,
    });
    await verifyMicroVerticalReleaseEnvelope(created, {
      artifactRoot: f.distDirectory,
      expectedKind: SHELL_RELEASE_ENVELOPE_KIND,
      expectedTarget: 'node',
    });
    await expect(
      verifyMicroVerticalReleaseEnvelope(created, {
        artifactRoot: f.distDirectory,
        expectedKind: MICROVERTICAL_RELEASE_ENVELOPE_KIND,
      }),
    ).rejects.toThrow(/kind/u);
    await framework.verifyBuildOutputReleaseEnvelope(f.distDirectory, 'node');
    const outputDirectory = path.join(f.root, '.output');
    await fs.cp(f.distDirectory, outputDirectory, { recursive: true });
    const staged = await framework.emitNodeStagedReleaseEnvelope({
      distDirectory: f.distDirectory,
      outputDirectory,
    });
    expect(staged?.kind).toBe(SHELL_RELEASE_ENVELOPE_KIND);
    expect(staged?.surfaces).toEqual({
      uiClient: envelope.surfaces.uiClient,
      ssr: [ssr, 'index.js'],
      apiBackend: [api],
    });
    expect(staged?.artifacts.map(artifact => artifact.logicalPath)).toEqual(
      boundPaths,
    );
    await framework.verifyNodeReleaseEnvelopeStaging({ outputDirectory });
    await fs.writeFile(path.join(outputDirectory, api), 'tampered staged API');
    await expect(
      framework.verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).rejects.toThrow(/digest/u);
    await f.put(client, 'tampered build client');
    await expect(
      framework.verifyBuildOutputReleaseEnvelope(f.distDirectory, 'node'),
    ).rejects.toThrow(/digest/u);
  });

  test('binds complete Cloudflare build and staged output without a backend producer', async () => {
    const f = await fixture(framework, 'shell', 'cloudflare');
    const apiPaths = [
      'worker/__modern_bff_effect.js',
      'worker/__modern_worker_runtime.js',
      'worker/__modern_worker_shared.js',
    ];
    const source = await f.emit();
    expect(source?.kind).toBe(SHELL_RELEASE_ENVELOPE_KIND);
    expect(source?.surfaces).toEqual({
      uiClient: ['mf-manifest.json', 'routes-manifest.json', client],
      ssr: ['worker/main.js'],
      apiBackend: apiPaths,
    });
    expect(source?.artifacts.map(artifact => artifact.logicalPath)).toEqual(
      [
        client,
        'mf-manifest.json',
        'package.json',
        'route.json',
        'routes-manifest.json',
        'ultramodern-build.json',
        framework.MICROVERTICAL_RELEASE_IDENTITY_CARRIERS_PATH,
        ...apiPaths,
        'worker/main.js',
      ].sort((left, right) => left.localeCompare(right)),
    );
    await framework.verifyBuildOutputReleaseEnvelope(
      f.distDirectory,
      'cloudflare',
    );
    const outputDirectory = path.join(f.root, '.output');
    for (const [from, to] of [
      ['static', 'public/static'],
      ['mf-manifest.json', 'public/mf-manifest.json'],
      ['routes-manifest.json', 'public/routes-manifest.json'],
      ['ultramodern-build.json', 'public/ultramodern-build.json'],
      ['worker', 'worker'],
      ['route.json', 'server/route.json'],
    ]) {
      await fs.mkdir(path.dirname(path.join(outputDirectory, to)), {
        recursive: true,
      });
      await fs.cp(
        path.join(f.distDirectory, from),
        path.join(outputDirectory, to),
        { recursive: true },
      );
    }
    for (const name of [
      'server/modern-worker-manifest.json',
      'wrangler.json',
      'package.json',
      'worker/package.json',
    ]) {
      await fs.writeFile(path.join(outputDirectory, name), '{}');
    }
    await fs.writeFile(
      path.join(outputDirectory, 'server/index.mjs'),
      'export default {};',
    );
    await framework.stageCloudflareReleaseEnvelope({
      distDirectory: f.distDirectory,
      outputDirectory,
    });
    const staged = await framework.emitCloudflareStagedReleaseEnvelope({
      distDirectory: f.distDirectory,
      outputDirectory,
    });
    expect(staged?.kind).toBe(SHELL_RELEASE_ENVELOPE_KIND);
    expect(staged?.surfaces).toEqual({
      uiClient: [
        'public/mf-manifest.json',
        'public/routes-manifest.json',
        `public/${client}`,
      ],
      ssr: ['server/index.mjs', 'worker/main.js'],
      apiBackend: apiPaths,
    });
    expect(staged?.artifacts.map(artifact => artifact.logicalPath)).toEqual(
      [
        'package.json',
        'public/mf-manifest.json',
        'public/routes-manifest.json',
        `public/${client}`,
        'public/ultramodern-build.json',
        framework.MICROVERTICAL_RELEASE_IDENTITY_CARRIERS_PATH,
        'server/index.mjs',
        'server/modern-worker-manifest.json',
        'server/route.json',
        ...apiPaths,
        'worker/main.js',
        'worker/package.json',
        'wrangler.json',
      ].sort((left, right) => left.localeCompare(right)),
    );
    await framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory);
    await fs.writeFile(
      path.join(outputDirectory, 'public', client),
      'tampered staged client',
    );
    await expect(
      framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory),
    ).rejects.toThrow(/digest/u);
    await f.put('worker/main.js', 'tampered build SSR');
    await expect(
      framework.verifyBuildOutputReleaseEnvelope(f.distDirectory, 'cloudflare'),
    ).rejects.toThrow(/digest/u);
  });

  test('rejects a producer pair, API-only Shell and missing actual API code', async () => {
    const producer = await fixture(framework, 'shell');
    await producer.json('backend-mf-manifest.json', {
      backendFederation: { deliveryUnit },
    });
    await producer.put(
      'backendRemoteEntry.cjs',
      'exports.handler = () => null;',
    );
    await expect(producer.emit()).rejects.toThrow(/Shell.*backend federation/u);

    const apiOnly = await fixture(framework, 'shell');
    await expect(
      framework.emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: true,
        appDirectory: apiOnly.root,
        distDirectory: apiOnly.distDirectory,
        role: 'shell',
        target: 'node',
      }),
    ).rejects.toThrow(/Shell requires a full-stack application/u);

    const missingApi = await fixture(framework, 'shell');
    await fs.rm(path.join(missingApi.distDirectory, api));
    await expect(missingApi.emit()).rejects.toThrow(
      /no actual compiled Node Effect API artifact/u,
    );
  });
});

describe('empty MF producer', () => {
  const framework = sourceFramework;

  test('retains complete build and Node staged release evidence', async () => {
    const f = await fixture(framework);
    const envelope = await f.emit();
    expect(envelope?.surfaces.uiClient).toContain(client);
    expect(envelope?.surfaces.ssr).toEqual([ssr]);
    expect(envelope?.surfaces.apiBackend).toEqual([api]);
    await framework.verifyBuildOutputReleaseEnvelope(f.root, 'node');
    const staged = await framework.emitNodeStagedReleaseEnvelope({
      distDirectory: f.root,
      outputDirectory: f.root,
    });
    expect(staged?.surfaces.uiClient).toContain(client);
    await framework.verifyNodeReleaseEnvelopeStaging({
      outputDirectory: f.root,
    });
    await f.put(client, 'console.log("tampered");');
    await expect(
      framework.verifyBuildOutputReleaseEnvelope(f.root, 'node'),
    ).rejects.toThrow(/digest|hash|size/iu);
  });

  test('binds route assets under the final Cloudflare public directory', async () => {
    const f = await fixture(framework);
    await f.put('worker/main.js', 'export const render = () => "catalog";');
    await f.put(
      'worker/__modern_bff_effect.js',
      'export const handler = () => "api";',
    );
    await f.json('route.json', { routes: [{ worker: 'worker/main.js' }] });
    await framework.emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: f.root,
      target: 'cloudflare',
    });
    const outputDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'empty-mf-cloudflare-'),
    );
    roots.push(outputDirectory);
    for (const [from, to] of [
      ['static', 'public/static'],
      ['mf-manifest.json', 'public/mf-manifest.json'],
      ['routes-manifest.json', 'public/routes-manifest.json'],
      ['backend-mf-manifest.json', 'public/backend-mf-manifest.json'],
      ['backendRemoteEntry.cjs', 'public/backendRemoteEntry.cjs'],
      ['ultramodern-build.json', 'public/ultramodern-build.json'],
      ['worker', 'worker'],
      ['route.json', 'server/route.json'],
    ]) {
      await fs.mkdir(path.dirname(path.join(outputDirectory, to)), {
        recursive: true,
      });
      await fs.cp(path.join(f.root, from), path.join(outputDirectory, to), {
        recursive: true,
      });
    }
    for (const name of [
      'server/modern-worker-manifest.json',
      'wrangler.json',
      'package.json',
      'worker/package.json',
    ]) {
      await fs.writeFile(path.join(outputDirectory, name), '{}');
    }
    await fs.writeFile(
      path.join(outputDirectory, 'server/index.mjs'),
      'export default {};',
    );
    const envelope = await framework.emitCloudflareStagedReleaseEnvelope({
      distDirectory: f.root,
      outputDirectory,
    });
    expect(envelope?.surfaces.uiClient).toContain(`public/${client}`);
    await framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory);
    await fs.writeFile(
      path.join(outputDirectory, 'public', client),
      'tampered',
    );
    await expect(
      framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory),
    ).rejects.toThrow(/digest|hash|size/iu);
  });

  test('binds auto and root-relative publicPath route assets', async () => {
    for (const [base, reference] of [
      ['auto', `/${client}`],
      ['/app/', `/app/${client}`],
      ['/', client],
    ]) {
      const f = await fixture(framework);
      f.manifest.metaData.publicPath = base;
      await f.json('mf-manifest.json', f.manifest);
      await f.routes([reference]);
      expect((await f.emit())?.surfaces.uiClient).toContain(client);
    }
  });

  test('rejects undeclared, foreign, traversing, missing, and nonbrowser assets', async () => {
    for (const reference of [
      `https://foreign.example.test/app/${client}`,
      `${publicPath}../app/${client}`,
      `${publicPath}static/js/missing.js`,
    ]) {
      const f = await fixture(framework);
      await f.routes([reference]);
      await expect(f.emit()).rejects.toThrow(
        /UI\/client manifest references no compiled execution module/u,
      );
    }
    const f = await fixture(framework);
    await f.routes([]);
    await expect(f.emit()).rejects.toThrow(/no compiled execution module/u);
    await fs.rm(path.join(f.root, 'routes-manifest.json'));
    await expect(f.emit()).rejects.toThrow(/ENOENT/u);
  });

  test('rejects browser-named symlinks to server bytes', async () => {
    const f = await fixture(framework);
    await fs.rm(path.join(f.root, client));
    await fs.symlink(path.join(f.root, api), path.join(f.root, client));
    await expect(f.emit()).rejects.toThrow(/no compiled execution module/u);
  });

  test('requires proven empty exposes, remotes, and a native empty remote entry', async () => {
    const f = await fixture(framework);
    for (const manifest of [
      { ...f.manifest, exposes: [{ name: './Page' }] },
      { ...f.manifest, remotes: [{ name: 'shell' }] },
      { metaData: f.manifest.metaData, remotes: [] },
      { metaData: f.manifest.metaData, exposes: [] },
      {
        ...f.manifest,
        metaData: {
          ...f.manifest.metaData,
          remoteEntry: { name: '', path: '' },
        },
      },
    ]) {
      await f.json('mf-manifest.json', manifest);
      await expect(f.emit()).rejects.toThrow(
        /UI\/client manifest references no compiled execution module/u,
      );
    }
  });

  test('rejects a mixed delivery-unit identity in empty producer output', async () => {
    const f = await fixture(framework);
    await f.json('backend-mf-manifest.json', {
      backendFederation: {
        deliveryUnit: { ...deliveryUnit, sourceRevision: 'b'.repeat(40) },
      },
    });
    await expect(f.emit()).rejects.toThrow(/must match/u);
  });
});

describe('API-only release', () => {
  const framework = sourceFramework;

  async function apiOnlyFixture(target: 'node' | 'cloudflare') {
    const f = await fixture(framework);
    await f.json(
      'ultramodern-build.json',
      createUltramodernBuildArtifact(deliveryUnit),
    );
    for (const name of [
      'static',
      'bundles',
      'mf-manifest.json',
      'routes-manifest.json',
      'route.json',
    ]) {
      await fs.rm(path.join(f.root, name), { force: true, recursive: true });
    }
    if (target === 'cloudflare') {
      await f.put(
        'worker/__modern_bff_effect.js',
        'exports.fetch = () => "api";',
      );
    }
    const emit = () =>
      framework.emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: true,
        distDirectory: f.root,
        target,
      });
    return { ...f, emit };
  }

  test('binds the real Node API, backend container and build identity', async () => {
    const f = await apiOnlyFixture('node');
    await f.put('public/robots.txt', 'User-agent: *\nDisallow: /\n');
    await f.json('public/.well-known/ontos-module-manifest.json', {
      kind: 'api-contract',
    });
    await f.put(
      'public/_headers',
      '/.well-known/ontos-module-manifest.json\n  Cache-Control: no-cache\n',
    );
    const envelope = await f.emit();
    expect(envelope?.surfaces).toMatchObject({
      uiClient: [],
      ssr: [],
      apiBackend: [api],
      backendFederation: {
        manifest: 'backend-mf-manifest.json',
        container: 'backendRemoteEntry.cjs',
      },
    });
    expect(envelope?.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalPath: 'public/robots.txt',
          runtime: 'crawler-policy',
        }),
        expect.objectContaining({
          logicalPath: 'public/.well-known/ontos-module-manifest.json',
          runtime: 'public-metadata',
        }),
        expect.objectContaining({
          logicalPath: 'public/_headers',
          runtime: 'public-metadata',
        }),
      ]),
    );
    await framework.verifyBuildOutputReleaseEnvelope(f.root, 'node');
    const staged = await framework.emitNodeStagedReleaseEnvelope({
      distDirectory: f.root,
      outputDirectory: f.root,
    });
    expect(staged?.surfaces.uiClient).toEqual([]);
    expect(staged?.surfaces.ssr).toEqual([]);
    expect(staged?.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalPath: 'public/robots.txt',
          runtime: 'crawler-policy',
        }),
        expect.objectContaining({
          logicalPath: 'public/.well-known/ontos-module-manifest.json',
          runtime: 'public-metadata',
        }),
        expect.objectContaining({
          logicalPath: 'public/_headers',
          runtime: 'public-metadata',
        }),
      ]),
    );
    await framework.verifyNodeReleaseEnvelopeStaging({
      outputDirectory: f.root,
    });
    await fs.writeFile(path.join(f.root, 'public/robots.txt'), 'Allow: /\n');
    await expect(
      framework.verifyNodeReleaseEnvelopeStaging({ outputDirectory: f.root }),
    ).rejects.toThrow(/digest/u);
  });

  test('rejects missing backend evidence, foreign revision and undeclared UI', async () => {
    const missing = await apiOnlyFixture('node');
    await fs.rm(path.join(missing.root, 'backendRemoteEntry.cjs'));
    await expect(missing.emit()).rejects.toThrow(/manifest and container/u);

    const missingApi = await apiOnlyFixture('node');
    await fs.rm(path.join(missingApi.root, api));
    await expect(missingApi.emit()).rejects.toThrow(
      /no actual compiled Node Effect API artifact/u,
    );

    const missingEnvelope = await apiOnlyFixture('node');
    await missingEnvelope.emit();
    await fs.rm(
      path.join(
        missingEnvelope.root,
        framework.MICROVERTICAL_RELEASE_ENVELOPE_PATH,
      ),
    );
    await expect(
      framework.verifyBuildOutputReleaseEnvelope(missingEnvelope.root, 'node'),
    ).rejects.toThrow(/required envelope is missing/u);

    const foreign = await apiOnlyFixture('node');
    await foreign.json('backend-mf-manifest.json', {
      backendFederation: {
        deliveryUnit: { ...deliveryUnit, sourceRevision: 'b'.repeat(40) },
        versionBoundary: { deliveryUnit },
      },
    });
    await expect(foreign.emit()).rejects.toThrow(/must match/u);

    const undeclared = await apiOnlyFixture('node');
    await undeclared.put(client, 'console.log("unexpected UI")');
    await expect(undeclared.emit()).rejects.toThrow(/undeclared UI\/client/u);

    const publicUi = await apiOnlyFixture('node');
    await publicUi.put('public/index.html', '<main>unexpected UI</main>');
    await expect(publicUi.emit()).rejects.toThrow(/undeclared UI\/client/u);

    const wellKnownScript = await apiOnlyFixture('node');
    await wellKnownScript.put(
      'public/.well-known/client.js',
      'console.log("unexpected UI")',
    );
    await expect(wellKnownScript.emit()).rejects.toThrow(
      /undeclared UI\/client/u,
    );
  });

  test('binds a Cloudflare API worker through final output', async () => {
    const f = await apiOnlyFixture('cloudflare');
    await f.put('public/robots.txt', 'User-agent: *\nDisallow: /\n');
    await f.json('public/.well-known/ontos-module-manifest.json', {
      kind: 'api-contract',
    });
    await f.put(
      'public/_headers',
      '/.well-known/ontos-module-manifest.json\n  Cache-Control: no-cache\n',
    );
    for (const name of [
      'worker/__modern_worker_runtime.js',
      'worker/__modern_worker_shared.js',
    ]) {
      await f.put(name, `export const chunk = '${name}';`);
    }
    const source = await f.emit();
    expect(source?.surfaces.uiClient).toEqual([]);
    expect(source?.surfaces.ssr).toEqual([]);
    expect(source?.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalPath: 'public/robots.txt',
          runtime: 'crawler-policy',
        }),
        expect.objectContaining({
          logicalPath: 'public/.well-known/ontos-module-manifest.json',
          runtime: 'public-metadata',
        }),
        expect.objectContaining({
          logicalPath: 'public/_headers',
          runtime: 'public-metadata',
        }),
      ]),
    );
    expect(source?.surfaces.apiBackend).toEqual([
      'worker/__modern_bff_effect.js',
      'worker/__modern_worker_runtime.js',
      'worker/__modern_worker_shared.js',
    ]);
    expect(source?.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalPath: 'worker/__modern_worker_runtime.js',
          runtime: 'workerd-effect',
        }),
        expect.objectContaining({
          logicalPath: 'worker/__modern_worker_shared.js',
          runtime: 'workerd-effect',
        }),
      ]),
    );
    const outputDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'api-only-cloudflare-release-'),
    );
    roots.push(outputDirectory);
    for (const [from, to] of [
      ['backend-mf-manifest.json', 'public/backend-mf-manifest.json'],
      ['backendRemoteEntry.cjs', 'public/backendRemoteEntry.cjs'],
      ['ultramodern-build.json', 'public/ultramodern-build.json'],
      ['public/robots.txt', 'public/robots.txt'],
      [
        'public/.well-known/ontos-module-manifest.json',
        'public/.well-known/ontos-module-manifest.json',
      ],
      ['public/_headers', 'public/_headers'],
      ['worker/__modern_bff_effect.js', 'worker/__modern_bff_effect.js'],
      [
        'worker/__modern_worker_runtime.js',
        'worker/__modern_worker_runtime.js',
      ],
      ['worker/__modern_worker_shared.js', 'worker/__modern_worker_shared.js'],
    ]) {
      await fs.mkdir(path.dirname(path.join(outputDirectory, to)), {
        recursive: true,
      });
      await fs.copyFile(
        path.join(f.root, from),
        path.join(outputDirectory, to),
      );
    }
    for (const name of [
      'server/index.mjs',
      'server/modern-worker-manifest.json',
      'wrangler.json',
      'package.json',
      'worker/package.json',
    ]) {
      await fs.mkdir(path.dirname(path.join(outputDirectory, name)), {
        recursive: true,
      });
      await fs.writeFile(path.join(outputDirectory, name), '{}');
    }
    await framework.stageCloudflareReleaseEnvelope({
      distDirectory: f.root,
      outputDirectory,
    });
    const staged = await framework.emitCloudflareStagedReleaseEnvelope({
      distDirectory: f.root,
      outputDirectory,
    });
    expect(staged?.surfaces.uiClient).toEqual([]);
    expect(staged?.surfaces.ssr).toEqual([]);
    expect(staged?.surfaces.apiBackend).toEqual(source?.surfaces.apiBackend);
    expect(staged?.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalPath: 'public/robots.txt',
          runtime: 'crawler-policy',
        }),
        expect.objectContaining({
          logicalPath: 'public/.well-known/ontos-module-manifest.json',
          runtime: 'public-metadata',
        }),
        expect.objectContaining({
          logicalPath: 'public/_headers',
          runtime: 'public-metadata',
        }),
        expect.objectContaining({
          logicalPath: 'public/ultramodern-build.json',
          runtime: 'release-identity-metadata',
        }),
        expect.objectContaining({
          logicalPath: 'worker/__modern_worker_shared.js',
          runtime: 'workerd-effect',
        }),
      ]),
    );
    await framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory);
    await fs.writeFile(
      path.join(outputDirectory, 'public/ultramodern-build.json'),
      '{}',
    );
    await expect(
      framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory),
    ).rejects.toThrow(/digest/u);
    await fs.copyFile(
      path.join(f.root, 'ultramodern-build.json'),
      path.join(outputDirectory, 'public/ultramodern-build.json'),
    );
    await fs.writeFile(
      path.join(outputDirectory, 'worker/__modern_worker_shared.js'),
      'export const chunk = "tampered";',
    );
    await expect(
      framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory),
    ).rejects.toThrow(/digest/u);
    await fs.copyFile(
      path.join(f.root, 'worker/__modern_worker_shared.js'),
      path.join(outputDirectory, 'worker/__modern_worker_shared.js'),
    );
    await fs.writeFile(
      path.join(outputDirectory, 'public/app.js'),
      'console.log("unexpected UI")',
    );
    await expect(
      framework.emitCloudflareStagedReleaseEnvelope({
        distDirectory: f.root,
        outputDirectory,
      }),
    ).rejects.toThrow(/undeclared UI\/client/u);
    await fs.rm(path.join(outputDirectory, 'public/app.js'));
    await fs.rm(path.join(outputDirectory, 'worker/__modern_bff_effect.js'));
    await expect(
      framework.emitCloudflareStagedReleaseEnvelope({
        distDirectory: f.root,
        outputDirectory,
      }),
    ).rejects.toThrow(/no actual Effect API\/BFF worker/u);
    await expect(
      framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory),
    ).rejects.toThrow(/does not exist/u);
  });

  test('rejects worker support chunks without an API entry and actual SSR code', async () => {
    const missingApi = await apiOnlyFixture('cloudflare');
    await fs.rm(path.join(missingApi.root, 'worker/__modern_bff_effect.js'));
    await missingApi.put('worker/__modern_worker_runtime.js', 'export {};');
    await expect(missingApi.emit()).rejects.toThrow(
      /no actual Effect API\/BFF worker artifact/u,
    );

    const undeclaredSsr = await apiOnlyFixture('cloudflare');
    await undeclaredSsr.put(
      'worker/main.js',
      'export const render = () => null;',
    );
    await expect(undeclaredSsr.emit()).rejects.toThrow(
      /undeclared UI\/client or SSR surface/u,
    );
  });
});

describe('UI-only Cloudflare worker support', () => {
  const framework = sourceFramework;
  const supportPaths = [
    'worker/__modern_worker_runtime.js',
    'worker/__modern_worker_shared.js',
  ];

  async function uiOnlyFixture() {
    const f = await fixture(framework);
    await fs.rm(path.join(f.root, 'api'), { recursive: true });
    await fs.rm(path.join(f.root, 'backend-mf-manifest.json'));
    await fs.rm(path.join(f.root, 'backendRemoteEntry.cjs'));
    const appDirectory = path.join(f.root, 'apps/catalog');
    const ui = uiBuildArtifactOptions(
      deliveryUnit.buildMarker,
      deliveryUnit.appId,
    ).ui;
    await f.json('topology/reference-topology.json', {
      shell: {
        id: deliveryUnit.appId,
        kind: 'shell',
        path: 'apps/catalog',
        surfaceProfile: 'ui-only',
        deliveryUnit,
        renderer: ui.profile.renderer,
        rendererIdentity: ui.identity,
        rendererProfile: ui.profile,
        routerBindings: ui.routerBindings,
      },
      verticals: [],
    });
    await f.json(
      'apps/catalog/shared/ultramodern-build.json',
      createUltramodernBuildArtifact(deliveryUnit, { ui }),
    );
    await f.json('route.json', { routes: [{ worker: 'worker/main.js' }] });
    for (const name of ['worker/main.js', ...supportPaths])
      await f.put(name, `export const chunk = '${name}';`);
    const emit = () =>
      framework.emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        appDirectory,
        distDirectory: f.root,
        target: 'cloudflare',
      });
    const stage = async () => {
      const outputDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), 'ui-only-cloudflare-release-'),
      );
      roots.push(outputDirectory);
      for (const [from, to] of [
        ['static', 'public/static'],
        ['mf-manifest.json', 'public/mf-manifest.json'],
        ['routes-manifest.json', 'public/routes-manifest.json'],
        ['ultramodern-build.json', 'public/ultramodern-build.json'],
        ['worker', 'worker'],
        ['route.json', 'server/route.json'],
      ]) {
        await fs.mkdir(path.dirname(path.join(outputDirectory, to)), {
          recursive: true,
        });
        await fs.cp(path.join(f.root, from), path.join(outputDirectory, to), {
          recursive: true,
        });
      }
      for (const name of [
        'server/index.mjs',
        'server/modern-worker-manifest.json',
        'wrangler.json',
        'package.json',
        'worker/package.json',
      ]) {
        await fs.mkdir(path.dirname(path.join(outputDirectory, name)), {
          recursive: true,
        });
        await fs.writeFile(path.join(outputDirectory, name), '{}');
      }
      return outputDirectory;
    };
    return { ...f, emit, stage };
  }

  test('binds generic runtime/shared chunks to UI SSR through final staging', async () => {
    const f = await uiOnlyFixture();
    const source = await f.emit();
    expect(source?.surfaces.apiBackend).toEqual([]);
    expect(source?.surfaces.backendFederation).toBeUndefined();
    expect(source?.surfaces.ssr).toEqual(
      ['worker/main.js', ...supportPaths].sort(),
    );
    for (const logicalPath of supportPaths)
      expect(source?.artifacts).toContainEqual(
        expect.objectContaining({ logicalPath, runtime: 'workerd' }),
      );
    await framework.verifyBuildOutputReleaseEnvelope(f.root, 'cloudflare');
    const outputDirectory = await f.stage();
    const staged = await framework.emitCloudflareStagedReleaseEnvelope({
      distDirectory: f.root,
      outputDirectory,
    });
    expect(staged?.surfaces.apiBackend).toEqual([]);
    expect(staged?.surfaces.backendFederation).toBeUndefined();
    expect(staged?.surfaces.ssr).toEqual(
      ['server/index.mjs', 'worker/main.js', ...supportPaths].sort(),
    );
    for (const logicalPath of supportPaths)
      expect(staged?.artifacts).toContainEqual(
        expect.objectContaining({ logicalPath, runtime: 'workerd' }),
      );
    await framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory);
    await fs.writeFile(
      path.join(outputDirectory, supportPaths[1]!),
      'export const chunk = "tampered";',
    );
    await expect(
      framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory),
    ).rejects.toThrow(/digest/u);
  });

  test('rejects actual BFF entries, API code and backend federation output at build and staging', async () => {
    for (const backendPaths of [
      ['worker/__modern_bff_effect.js'],
      ['api/index.js'],
      ['backend-mf-manifest.json', 'backendRemoteEntry.cjs'],
    ]) {
      const f = await uiOnlyFixture();
      for (const name of backendPaths) await f.put(name, '{}');
      await expect(f.emit()).rejects.toThrow(/UI-only application/u);
    }
    const f = await uiOnlyFixture();
    await f.emit();
    for (const backendPaths of [
      ['worker/__modern_bff_effect.js'],
      ['api/index.js'],
      ['public/backend-mf-manifest.json', 'public/backendRemoteEntry.cjs'],
    ]) {
      const outputDirectory = await f.stage();
      for (const name of backendPaths) {
        await fs.mkdir(path.dirname(path.join(outputDirectory, name)), {
          recursive: true,
        });
        await fs.writeFile(path.join(outputDirectory, name), '{}');
      }
      await expect(
        framework.emitCloudflareStagedReleaseEnvelope({
          distDirectory: f.root,
          outputDirectory,
        }),
      ).rejects.toThrow(
        /undeclared API\/backend or backend federation artifact/u,
      );
    }
  });
});
