import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  emitCloudflareStagedReleaseEnvelope,
  emitFrameworkMicroVerticalReleaseEnvelope,
  emitNodeStagedReleaseEnvelope,
  MICROVERTICAL_RELEASE_ENVELOPE_PATH,
  verifyBuildOutputReleaseEnvelope,
  verifyNodeReleaseEnvelopeStaging,
} from '@modern-js/app-tools-extensions/release-envelope/framework-output';
import type { ReleaseEnvelopePluginApi } from '@modern-js/app-tools-extensions/release-envelope/plugin';
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

const createTargetBuildOutput = async (target: MicroVerticalReleaseTarget) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), `modern-release-envelope-${target}-`),
  );
  temporaryDirectories.push(root);
  const distDirectory = path.join(root, 'dist');
  const files: Record<string, string> = {
    'static/catalog.js': compiledModule(),
    'static/catalog.css': '.catalog{color:green}',
    'html/main/index.html': '<main>catalog</main>',
    'backendRemoteEntry.cjs': compiledModule(true),
    'public/robots.txt': 'User-agent: *\nAllow: /\n',
    'mf-manifest.json': JSON.stringify({
      name: 'verticalCatalog',
      pluginVersion: '2.8.0',
      exposes: [
        {
          path: './Route',
          assets: { js: { sync: ['static/catalog.js'], async: [] } },
        },
      ],
    }),
    'route.json': JSON.stringify({
      routes: [
        target === 'node'
          ? { bundle: 'bundles/main.js', urlPath: '/' }
          : { worker: 'worker/main.js', urlPath: '/' },
      ],
    }),
    ...(target === 'node'
      ? {
          'api/index.js': compiledModule(),
          'bundles/main.js': compiledModule(),
        }
      : {
          'worker/main.js': compiledModule(),
          'worker/__modern_bff_effect.js': compiledModule(),
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
    createUltramodernBuildArtifact(
      deliveryUnit,
      uiBuildArtifactOptions(deliveryUnit.buildMarker, deliveryUnit.appId),
    ),
  );
  const { buildMarker, sourceRevision, unitId } = identity;
  await writeJson(path.join(distDirectory, 'backend-mf-manifest.json'), {
    backendFederation: {
      deliveryUnit,
      versionBoundary: {
        deliveryUnit: { buildMarker, sourceRevision, unitId },
      },
    },
  });
  return { distDirectory, root };
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
) => {
  await fs.mkdir(path.join(outputDirectory, 'public'), { recursive: true });
  for (const [from, to] of [
    ['static', 'public/static'],
    ['html', 'public/html'],
    ['mf-manifest.json', 'public/mf-manifest.json'],
    ['backend-mf-manifest.json', 'public/backend-mf-manifest.json'],
    ['backendRemoteEntry.cjs', 'public/backendRemoteEntry.cjs'],
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
