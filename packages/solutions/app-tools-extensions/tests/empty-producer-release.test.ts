import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createUltramodernBuildArtifact,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
} from '@modern-js/backend-federation-contracts';
import * as sourceFramework from '../src/release-envelope/framework-output';

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

async function fixture(framework: typeof sourceFramework) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-mf-release-'));
  roots.push(root);
  const put = async (name: string, contents: string) => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), contents);
  };
  const json = (name: string, value: unknown) =>
    put(name, JSON.stringify(value));
  const manifest = {
    exposes: [],
    remotes: [],
    metaData: {
      publicPath,
      remoteEntry: { name: '', path: '', type: 'global' },
    },
  };
  await json(
    'ultramodern-build.json',
    createUltramodernBuildArtifact(deliveryUnit),
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
  await json('route.json', { routes: [{ bundle: ssr }] });
  await json('package.json', { type: 'module' });
  for (const name of [client, ssr, api, 'index.js', 'backendRemoteEntry.cjs']) {
    await put(name, 'console.log("compiled fixture");');
  }
  const emit = () =>
    framework.emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: root,
      target: 'node',
    });
  return { root, put, json, manifest, routes, emit };
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
      createUltramodernBuildArtifact(workspaceUnit),
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
    await framework.verifyBuildOutputReleaseEnvelope(f.root, 'node');
    const staged = await framework.emitNodeStagedReleaseEnvelope({
      distDirectory: f.root,
      outputDirectory: f.root,
    });
    expect(staged?.surfaces.uiClient).toEqual([]);
    expect(staged?.surfaces.ssr).toEqual([]);
    await framework.verifyNodeReleaseEnvelopeStaging({
      outputDirectory: f.root,
    });
    await fs.writeFile(path.join(f.root, api), 'changed API bytes');
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
  });

  test('binds a Cloudflare API worker through final output', async () => {
    const f = await apiOnlyFixture('cloudflare');
    const source = await f.emit();
    expect(source?.surfaces.uiClient).toEqual([]);
    expect(source?.surfaces.ssr).toEqual([]);
    expect(source?.surfaces.apiBackend).toEqual([
      'worker/__modern_bff_effect.js',
    ]);
    const outputDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'api-only-cloudflare-release-'),
    );
    roots.push(outputDirectory);
    for (const [from, to] of [
      ['backend-mf-manifest.json', 'public/backend-mf-manifest.json'],
      ['backendRemoteEntry.cjs', 'public/backendRemoteEntry.cjs'],
      ['worker/__modern_bff_effect.js', 'worker/__modern_bff_effect.js'],
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
    await framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory);
    await fs.rm(path.join(outputDirectory, 'worker/__modern_bff_effect.js'));
    await expect(
      framework.verifyCloudflareReleaseEnvelopeStaging(outputDirectory),
    ).rejects.toThrow(/does not exist/u);
  });
});
