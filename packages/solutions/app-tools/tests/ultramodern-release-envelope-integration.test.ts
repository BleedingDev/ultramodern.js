import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPluginManager } from '@modern-js/plugin';
import {
  createUltramodernBuildArtifact,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitRecord,
} from '@modern-js/utils/universal';
import { bffPlugin } from '../../../cli/plugin-bff/src/cli';
import { appTools } from '../src';
import {
  emitCloudflareStagedReleaseEnvelope,
  emitFrameworkMicroVerticalReleaseEnvelope,
  emitNodeStagedReleaseEnvelope,
  MICROVERTICAL_RELEASE_ENVELOPE_PATH,
  stageCloudflareReleaseEnvelope,
  verifyBuildOutputReleaseEnvelope,
  verifyCloudflareReleaseEnvelopeStaging,
  verifyNodeReleaseEnvelopeStaging,
} from '../src/ultramodern-release-envelope/framework-output';
import type { MicroVerticalReleaseTarget } from '../src/ultramodern-release-envelope/types';

const tempDirectories: string[] = [];

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

const compiledCarrier = (
  {
    buildMarker = identity.buildMarker,
    releaseVersion = identity.releaseVersion,
    sourceRevision = identity.sourceRevision,
  } = {},
  commonjs = false,
) =>
  `const i={buildMarker:${JSON.stringify(buildMarker)},releaseVersion:${JSON.stringify(releaseVersion)},sourceRevision:${JSON.stringify(sourceRevision)}};${commonjs ? 'module.exports=i;' : 'export{i};'}`;

const writeJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const createTargetBuildOutput = async (target: MicroVerticalReleaseTarget) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), `modern-release-envelope-${target}-`),
  );
  tempDirectories.push(root);
  const distDirectory = path.join(root, 'dist');
  const files: Record<string, string> = {
    'static/catalog.js': compiledCarrier(),
    'static/catalog.css': '.catalog{color:green}',
    'html/main/index.html': '<main>catalog</main>',
    'backendRemoteEntry.cjs': compiledCarrier({}, true),
    'mf-manifest.json': JSON.stringify({
      name: 'verticalCatalog',
      pluginVersion: '2.8.0',
      exposes: [
        {
          path: './Route',
          assets: {
            js: {
              sync: ['static/catalog.js'],
              async: [],
            },
          },
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
    'public/robots.txt': 'User-agent: *\nAllow: /\n',
    ...(target === 'node'
      ? {
          'api/index.js': compiledCarrier(),
          'bundles/main.js': compiledCarrier(),
        }
      : {
          'worker/main.js': compiledCarrier(),
          'worker/__modern_bff_effect.js': compiledCarrier(),
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
    createUltramodernBuildArtifact(deliveryUnit),
  );
  await writeJson(path.join(distDirectory, 'backend-mf-manifest.json'), {
    backendFederation: {
      deliveryUnit,
      versionBoundary: {
        deliveryUnit: {
          buildMarker: identity.buildMarker,
          sourceRevision: identity.sourceRevision,
          unitId: identity.unitId,
        },
      },
    },
  });
  return { distDirectory, root };
};

const createCloudflareStaging = async (
  distDirectory: string,
  outputDirectory: string,
) => {
  await fs.mkdir(path.join(outputDirectory, 'public'), { recursive: true });
  await fs.mkdir(path.join(outputDirectory, 'worker'), { recursive: true });
  for (const logicalPath of [
    'static',
    'html',
    'mf-manifest.json',
    'backend-mf-manifest.json',
    'backendRemoteEntry.cjs',
  ]) {
    await fs.cp(
      path.join(distDirectory, logicalPath),
      path.join(outputDirectory, 'public', logicalPath),
      { recursive: true },
    );
  }
  await fs.cp(
    path.join(distDirectory, 'worker'),
    path.join(outputDirectory, 'worker'),
    { recursive: true },
  );
  await fs.mkdir(path.join(outputDirectory, 'server'), { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, 'server/index.mjs'),
    compiledCarrier(),
  );
  await fs.copyFile(
    path.join(distDirectory, 'route.json'),
    path.join(outputDirectory, 'server/route.json'),
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
    tempDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('framework target-specific MicroVertical release-envelope integration', () => {
  it('runs after backend federation and before deploy staging', () => {
    const plugins = appTools().usePlugins ?? [];
    const pluginNames = plugins.map(plugin => plugin.name);
    const envelopePlugin = plugins.find(
      plugin => plugin.name === '@modern-js/ultramodern-release-envelope',
    );
    expect(pluginNames).toEqual(
      expect.arrayContaining([
        '@modern-js/backend-federation-build',
        '@modern-js/ultramodern-release-envelope',
        '@modern-js/plugin-deploy',
      ]),
    );
    expect(
      pluginNames.indexOf('@modern-js/backend-federation-build'),
    ).toBeLessThan(
      pluginNames.indexOf('@modern-js/ultramodern-release-envelope'),
    );
    expect(
      pluginNames.indexOf('@modern-js/ultramodern-release-envelope'),
    ).toBeLessThan(pluginNames.indexOf('@modern-js/plugin-deploy'));
    expect(envelopePlugin?.pre).toEqual(
      expect.arrayContaining([
        '@modern-js/backend-federation-build',
        '@modern-js/plugin-bff',
      ]),
    );

    const pluginManager = createPluginManager();
    pluginManager.addPlugins([appTools(), bffPlugin()]);
    const resolvedPluginNames = pluginManager
      .getPlugins()
      .map(plugin => plugin.name);
    const resolvedEnvelopeIndex = resolvedPluginNames.indexOf(
      '@modern-js/ultramodern-release-envelope',
    );
    expect(
      resolvedPluginNames.indexOf('@modern-js/backend-federation-build'),
    ).toBeLessThan(resolvedEnvelopeIndex);
    expect(resolvedPluginNames.indexOf('@modern-js/plugin-bff')).toBeLessThan(
      resolvedEnvelopeIndex,
    );
  });

  it('emits independent Node and Cloudflare envelopes with one exact release identity', async () => {
    const nodeFixture = await createTargetBuildOutput('node');
    const cloudflareFixture = await createTargetBuildOutput('cloudflare');
    const nodeEnvelope = await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: nodeFixture.distDirectory,
      target: 'node',
    });
    const cloudflareEnvelope = await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: cloudflareFixture.distDirectory,
      target: 'cloudflare',
    });

    expect(nodeEnvelope?.identity).toEqual(identity);
    expect(cloudflareEnvelope?.identity).toEqual(identity);
    expect(nodeEnvelope?.target).toBe('node');
    expect(cloudflareEnvelope?.target).toBe('cloudflare');
    expect(nodeEnvelope?.surfaces.ssr).toEqual(['bundles/main.js']);
    expect(nodeEnvelope?.surfaces.apiBackend).toEqual(['api/index.js']);
    expect(nodeEnvelope?.surfaces.uiClient).toContain('public/robots.txt');
    expect(nodeEnvelope?.surfaces.backendFederation.container).toBe(
      'backendRemoteEntry.cjs',
    );
    expect(
      nodeEnvelope?.artifacts.filter(
        artifact => artifact.logicalPath === 'backendRemoteEntry.cjs',
      ),
    ).toHaveLength(1);
    expect(cloudflareEnvelope?.surfaces.ssr).toEqual(['worker/main.js']);
    expect(cloudflareEnvelope?.surfaces.apiBackend).toEqual([
      'worker/__modern_bff_effect.js',
    ]);
    expect(nodeEnvelope?.envelopeDigest).not.toBe(
      cloudflareEnvelope?.envelopeDigest,
    );
  });

  it('reseals generated public assets into the final target envelopes', async () => {
    const nodeFixture = await createTargetBuildOutput('node');
    const firstNodeEnvelope = await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: nodeFixture.distDirectory,
      target: 'node',
    });
    await fs.writeFile(
      path.join(nodeFixture.distDirectory, 'public/sitemap.xml'),
      '<urlset />',
    );
    const resealedNodeEnvelope =
      await emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: nodeFixture.distDirectory,
        target: 'node',
      });
    expect(resealedNodeEnvelope?.surfaces.uiClient).toContain(
      'public/sitemap.xml',
    );
    expect(resealedNodeEnvelope?.envelopeDigest).not.toBe(
      firstNodeEnvelope?.envelopeDigest,
    );

    const cloudflareFixture = await createTargetBuildOutput('cloudflare');
    const firstCloudflareSourceEnvelope =
      await emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: cloudflareFixture.distDirectory,
        target: 'cloudflare',
      });
    await fs.writeFile(
      path.join(cloudflareFixture.distDirectory, 'public/site.webmanifest'),
      '{"name":"catalog"}\n',
    );
    const resealedCloudflareSourceEnvelope =
      await emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: cloudflareFixture.distDirectory,
        target: 'cloudflare',
      });
    const cloudflareOutput = path.join(
      cloudflareFixture.root,
      'cloudflare-output-reseal',
    );
    await createCloudflareStaging(
      cloudflareFixture.distDirectory,
      cloudflareOutput,
    );
    await fs.copyFile(
      path.join(cloudflareFixture.distDirectory, 'public/site.webmanifest'),
      path.join(cloudflareOutput, 'public/site.webmanifest'),
    );
    const finalCloudflareEnvelope = await emitCloudflareStagedReleaseEnvelope({
      distDirectory: cloudflareFixture.distDirectory,
      outputDirectory: cloudflareOutput,
    });
    expect(resealedCloudflareSourceEnvelope?.surfaces.uiClient).toContain(
      'public/site.webmanifest',
    );
    expect(finalCloudflareEnvelope?.surfaces.uiClient).toContain(
      'public/site.webmanifest',
    );
    expect(resealedCloudflareSourceEnvelope?.envelopeDigest).not.toBe(
      firstCloudflareSourceEnvelope?.envelopeDigest,
    );
  });

  it('stages only the selected target and keeps the Cloudflare envelope private', async () => {
    const nodeFixture = await createTargetBuildOutput('node');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: nodeFixture.distDirectory,
      target: 'node',
    });
    const nodeOutput = path.join(nodeFixture.root, 'node-output');
    await fs.cp(nodeFixture.distDirectory, nodeOutput, { recursive: true });
    await fs.rm(path.join(nodeOutput, 'release'), {
      recursive: true,
      force: true,
    });
    await fs.writeFile(path.join(nodeOutput, 'index.js'), compiledCarrier());
    await writeJson(path.join(nodeOutput, 'package.json'), {
      type: 'commonjs',
    });
    const finalNodeEnvelope = await emitNodeStagedReleaseEnvelope({
      distDirectory: nodeFixture.distDirectory,
      outputDirectory: nodeOutput,
    });
    await expect(
      verifyNodeReleaseEnvelopeStaging({
        outputDirectory: nodeOutput,
      }),
    ).resolves.toMatchObject({ target: 'node' });
    expect(finalNodeEnvelope?.surfaces.ssr).toContain('index.js');
    expect(
      finalNodeEnvelope?.artifacts.map(artifact => artifact.logicalPath),
    ).toContain('package.json');

    const cloudflareFixture = await createTargetBuildOutput('cloudflare');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: cloudflareFixture.distDirectory,
      target: 'cloudflare',
    });
    const cloudflareOutput = path.join(
      cloudflareFixture.root,
      'cloudflare-output',
    );
    await createCloudflareStaging(
      cloudflareFixture.distDirectory,
      cloudflareOutput,
    );
    const sourceEnvelope = await stageCloudflareReleaseEnvelope({
      distDirectory: cloudflareFixture.distDirectory,
      outputDirectory: cloudflareOutput,
    });
    await expect(
      fs.access(
        path.join(cloudflareOutput, MICROVERTICAL_RELEASE_ENVELOPE_PATH),
      ),
    ).rejects.toThrow();
    const stagedEnvelope = await emitCloudflareStagedReleaseEnvelope({
      distDirectory: cloudflareFixture.distDirectory,
      outputDirectory: cloudflareOutput,
    });
    expect(stagedEnvelope).toMatchObject({ target: 'cloudflare' });
    expect(stagedEnvelope?.envelopeDigest).not.toBe(
      sourceEnvelope?.envelopeDigest,
    );
    expect(stagedEnvelope?.surfaces.ssr).toEqual([
      'server/index.mjs',
      'worker/main.js',
    ]);
    expect(stagedEnvelope?.surfaces.apiBackend).toEqual([
      'worker/__modern_bff_effect.js',
    ]);
    expect(stagedEnvelope?.surfaces.backendFederation).toEqual({
      container: 'public/backendRemoteEntry.cjs',
      manifest: 'public/backend-mf-manifest.json',
    });
    await expect(
      fs.access(
        path.join(
          cloudflareOutput,
          'public',
          MICROVERTICAL_RELEASE_ENVELOPE_PATH,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      fs.access(
        path.join(cloudflareOutput, MICROVERTICAL_RELEASE_ENVELOPE_PATH),
      ),
    ).resolves.toBeUndefined();
  });

  it('binds internal Node package-alias directories to their final files', async () => {
    const fixture = await createTargetBuildOutput('node');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: fixture.distDirectory,
      target: 'node',
    });
    const outputDirectory = path.join(fixture.root, 'node-output-alias');
    await fs.cp(fixture.distDirectory, outputDirectory, { recursive: true });
    await fs.rm(path.join(outputDirectory, 'release'), {
      recursive: true,
      force: true,
    });
    await fs.writeFile(
      path.join(outputDirectory, 'index.js'),
      compiledCarrier(),
    );
    await writeJson(path.join(outputDirectory, 'package.json'), {
      type: 'commonjs',
    });

    const targetDirectory = path.join(
      outputDirectory,
      'node_modules/@bleedingdev/modern-js-bff-core',
    );
    const aliasDirectory = path.join(
      outputDirectory,
      'node_modules/@modern-js/bff-core',
    );
    const fileAlias = path.join(
      outputDirectory,
      'node_modules/bff-core-entry.js',
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
    await fs.symlink(
      path.relative(
        path.dirname(fileAlias),
        path.join(targetDirectory, 'index.js'),
      ),
      fileAlias,
      'file',
    );

    const envelope = await emitNodeStagedReleaseEnvelope({
      distDirectory: fixture.distDirectory,
      outputDirectory,
    });
    const artifactPaths = envelope?.artifacts.map(
      artifact => artifact.logicalPath,
    );
    expect(artifactPaths).toContain('node_modules/@modern-js/bff-core');
    expect(artifactPaths).not.toContain(
      'node_modules/@modern-js/bff-core/index.js',
    );
    const directoryAliasArtifact = envelope?.artifacts.find(
      artifact => artifact.logicalPath === 'node_modules/@modern-js/bff-core',
    );
    const fileAliasArtifact = envelope?.artifacts.find(
      artifact => artifact.logicalPath === 'node_modules/bff-core-entry.js',
    );
    expect(directoryAliasArtifact).toMatchObject({
      kind: 'symbolic-link',
      targetKind: 'directory',
    });
    expect(fileAliasArtifact).toMatchObject({
      kind: 'symbolic-link',
      targetKind: 'file',
    });
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).resolves.toMatchObject({ target: 'node' });

    await fs.rm(aliasDirectory);
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).rejects.toThrow(
      'Artifact "node_modules/@modern-js/bff-core" does not exist',
    );

    await fs.symlink(
      path.relative(path.dirname(aliasDirectory), byteIdenticalTargetDirectory),
      aliasDirectory,
      'dir',
    );
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).rejects.toThrow('does not match its final filesystem binding');

    await fs.rm(aliasDirectory);
    await fs.writeFile(
      aliasDirectory,
      `${JSON.stringify(directoryAliasArtifact)}\n`,
    );
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).rejects.toThrow('does not match its final filesystem binding');

    await fs.rm(aliasDirectory);
    await fs.cp(targetDirectory, aliasDirectory, { recursive: true });
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).rejects.toThrow('must be a file or symlink');

    await fs.rm(aliasDirectory, { recursive: true });
    await fs.symlink(
      path.relative(path.dirname(aliasDirectory), targetDirectory),
      aliasDirectory,
      'dir',
    );
    await fs.rm(fileAlias);
    await fs.writeFile(fileAlias, `${JSON.stringify(fileAliasArtifact)}\n`);
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).rejects.toThrow('does not match its final filesystem binding');

    await fs.rm(fileAlias);
    await fs.symlink(
      path.relative(
        path.dirname(fileAlias),
        path.join(targetDirectory, 'index.js'),
      ),
      fileAlias,
      'file',
    );
    await fs.appendFile(path.join(targetDirectory, 'index.js'), '// drift\n');
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory }),
    ).rejects.toThrow('digest does not match final artifact bytes');
  });

  it.each([
    'outside-root',
    'unresolvable-cycle',
    'ancestor-cycle',
  ] as const)('rejects a Node staging directory symlink %s', async failure => {
    const fixture = await createTargetBuildOutput('node');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: fixture.distDirectory,
      target: 'node',
    });
    const outputDirectory = path.join(
      fixture.root,
      `node-output-symlink-${failure}`,
    );
    await fs.cp(fixture.distDirectory, outputDirectory, { recursive: true });
    await fs.rm(path.join(outputDirectory, 'release'), {
      recursive: true,
      force: true,
    });
    await fs.writeFile(
      path.join(outputDirectory, 'index.js'),
      compiledCarrier(),
    );
    await writeJson(path.join(outputDirectory, 'package.json'), {
      type: 'commonjs',
    });
    const nodeModulesDirectory = path.join(outputDirectory, 'node_modules');
    await fs.mkdir(nodeModulesDirectory, { recursive: true });

    if (failure === 'outside-root') {
      const externalDirectory = path.join(fixture.root, 'external-package');
      await fs.mkdir(externalDirectory);
      await fs.symlink(
        externalDirectory,
        path.join(nodeModulesDirectory, 'escaped-package'),
        'dir',
      );
    } else if (failure === 'unresolvable-cycle') {
      await fs.symlink(
        'cycle-b',
        path.join(nodeModulesDirectory, 'cycle-a'),
        'dir',
      );
      await fs.symlink(
        'cycle-a',
        path.join(nodeModulesDirectory, 'cycle-b'),
        'dir',
      );
    } else {
      await fs.symlink(
        '..',
        path.join(nodeModulesDirectory, 'ancestor-cycle'),
        'dir',
      );
    }

    await expect(
      emitNodeStagedReleaseEnvelope({
        distDirectory: fixture.distDirectory,
        outputDirectory,
      }),
    ).rejects.toThrow(
      failure === 'outside-root'
        ? 'resolves outside artifactRoot'
        : failure === 'unresolvable-cycle'
          ? 'cannot be resolved'
          : 'targets an ancestor directory',
    );
  });

  it('fails closed when a final executed Cloudflare module changes after staging', async () => {
    const fixture = await createTargetBuildOutput('cloudflare');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: fixture.distDirectory,
      target: 'cloudflare',
    });
    const outputDirectory = path.join(fixture.root, 'cloudflare-output');
    await createCloudflareStaging(fixture.distDirectory, outputDirectory);
    await stageCloudflareReleaseEnvelope({
      distDirectory: fixture.distDirectory,
      outputDirectory,
    });
    await emitCloudflareStagedReleaseEnvelope({
      distDirectory: fixture.distDirectory,
      outputDirectory,
    });

    await fs.appendFile(
      path.join(outputDirectory, 'server/index.mjs'),
      '\n// mutated after final envelope',
    );
    await expect(
      verifyCloudflareReleaseEnvelopeStaging(outputDirectory),
    ).rejects.toThrow('digest does not match final artifact bytes');
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

  it('fails closed when final Node entry/dependency or Cloudflare deployment config changes', async () => {
    const nodeFixture = await createTargetBuildOutput('node');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: nodeFixture.distDirectory,
      target: 'node',
    });
    const nodeOutput = path.join(nodeFixture.root, 'node-output-drift');
    await fs.cp(nodeFixture.distDirectory, nodeOutput, { recursive: true });
    await fs.rm(path.join(nodeOutput, 'release'), {
      recursive: true,
      force: true,
    });
    await fs.writeFile(path.join(nodeOutput, 'index.js'), compiledCarrier());
    await writeJson(path.join(nodeOutput, 'package.json'), {
      dependencies: { effect: '4.0.0-beta.102' },
    });
    await fs.mkdir(path.join(nodeOutput, 'node_modules/effect'), {
      recursive: true,
    });
    await writeJson(path.join(nodeOutput, 'node_modules/effect/package.json'), {
      version: '4.0.0-beta.102',
    });
    await emitNodeStagedReleaseEnvelope({
      distDirectory: nodeFixture.distDirectory,
      outputDirectory: nodeOutput,
    });
    await fs.appendFile(path.join(nodeOutput, 'index.js'), '\n// drift');
    await expect(
      verifyNodeReleaseEnvelopeStaging({ outputDirectory: nodeOutput }),
    ).rejects.toThrow('digest does not match final artifact bytes');

    const cloudflareFixture = await createTargetBuildOutput('cloudflare');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: cloudflareFixture.distDirectory,
      target: 'cloudflare',
    });
    const cloudflareOutput = path.join(
      cloudflareFixture.root,
      'cloudflare-config-drift',
    );
    await createCloudflareStaging(
      cloudflareFixture.distDirectory,
      cloudflareOutput,
    );
    await emitCloudflareStagedReleaseEnvelope({
      distDirectory: cloudflareFixture.distDirectory,
      outputDirectory: cloudflareOutput,
    });
    await fs.appendFile(path.join(cloudflareOutput, 'wrangler.json'), '\n');
    await expect(
      verifyCloudflareReleaseEnvelopeStaging(cloudflareOutput),
    ).rejects.toThrow('digest does not match final artifact bytes');
  });

  it('rejects a Cloudflare release envelope leaked into public assets', async () => {
    const fixture = await createTargetBuildOutput('cloudflare');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: fixture.distDirectory,
      target: 'cloudflare',
    });
    const outputDirectory = path.join(fixture.root, 'cloudflare-output');
    await createCloudflareStaging(fixture.distDirectory, outputDirectory);
    await fs.mkdir(path.join(outputDirectory, 'public/release'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(outputDirectory, 'public', MICROVERTICAL_RELEASE_ENVELOPE_PATH),
      '{}',
    );

    await expect(
      emitCloudflareStagedReleaseEnvelope({
        distDirectory: fixture.distDirectory,
        outputDirectory,
      }),
    ).rejects.toThrow('must remain private');
  });

  it.each([
    'directory',
    'file',
  ] as const)('rejects %s symlink release-envelope escapes for Node and Cloudflare staging', async symlinkKind => {
    const nodeFixture = await createTargetBuildOutput('node');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: nodeFixture.distDirectory,
      target: 'node',
    });
    const nodeOutput = path.join(
      nodeFixture.root,
      `node-symlink-${symlinkKind}`,
    );
    await fs.cp(nodeFixture.distDirectory, nodeOutput, { recursive: true });
    await fs.rm(path.join(nodeOutput, 'release'), {
      recursive: true,
      force: true,
    });
    await fs.writeFile(path.join(nodeOutput, 'index.js'), compiledCarrier());
    await writeJson(path.join(nodeOutput, 'package.json'), {
      type: 'commonjs',
    });

    const cloudflareFixture = await createTargetBuildOutput('cloudflare');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: cloudflareFixture.distDirectory,
      target: 'cloudflare',
    });
    const cloudflareOutput = path.join(
      cloudflareFixture.root,
      `cloudflare-symlink-${symlinkKind}`,
    );
    await createCloudflareStaging(
      cloudflareFixture.distDirectory,
      cloudflareOutput,
    );

    for (const [artifactRoot, emit] of [
      [
        nodeOutput,
        () =>
          emitNodeStagedReleaseEnvelope({
            distDirectory: nodeFixture.distDirectory,
            outputDirectory: nodeOutput,
          }),
      ],
      [
        cloudflareOutput,
        () =>
          emitCloudflareStagedReleaseEnvelope({
            distDirectory: cloudflareFixture.distDirectory,
            outputDirectory: cloudflareOutput,
          }),
      ],
    ] as const) {
      const external = path.join(
        path.dirname(artifactRoot),
        `${path.basename(artifactRoot)}-external`,
      );
      if (symlinkKind === 'directory') {
        await fs.mkdir(external, { recursive: true });
        await fs.symlink(external, path.join(artifactRoot, 'release'));
      } else {
        await fs.mkdir(path.join(artifactRoot, 'release'), {
          recursive: true,
        });
        await fs.writeFile(external, '{}');
        await fs.symlink(
          external,
          path.join(artifactRoot, MICROVERTICAL_RELEASE_ENVELOPE_PATH),
        );
      }
      await expect(emit()).rejects.toThrow(/real (?:directory|file)/u);
    }
  });

  it('fails closed for the wrong target, mixed revision, and byte drift', async () => {
    const nodeFixture = await createTargetBuildOutput('node');
    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: nodeFixture.distDirectory,
        target: 'cloudflare',
      }),
    ).rejects.toThrow(
      'cloudflare full-stack MicroVertical has no workerd SSR artifacts',
    );

    const staleCloudflareTarget = await createTargetBuildOutput('cloudflare');
    await fs.mkdir(path.join(staleCloudflareTarget.distDirectory, 'bundles'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(staleCloudflareTarget.distDirectory, 'bundles/main.js'),
      compiledCarrier(),
    );
    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: staleCloudflareTarget.distDirectory,
        target: 'node',
      }),
    ).rejects.toThrow(
      'Node target conflicts with a Cloudflare Effect API/BFF worker artifact',
    );

    const mixedFixture = await createTargetBuildOutput('cloudflare');
    await writeJson(
      path.join(mixedFixture.distDirectory, 'backend-mf-manifest.json'),
      {
        backendFederation: {
          deliveryUnit: {
            ...deliveryUnit,
            sourceRevision: 'b'.repeat(40),
          },
          versionBoundary: {
            deliveryUnit: identity,
          },
        },
      },
    );
    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: mixedFixture.distDirectory,
        target: 'cloudflare',
      }),
    ).rejects.toThrow(
      `backendFederation.deliveryUnit.sourceRevision must match ${identity.sourceRevision}`,
    );

    const driftFixture = await createTargetBuildOutput('cloudflare');
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: driftFixture.distDirectory,
      target: 'cloudflare',
    });
    await fs.writeFile(
      path.join(driftFixture.distDirectory, 'worker/main.js'),
      `${compiledCarrier()}\n// mutated after envelope`,
    );
    await expect(
      verifyBuildOutputReleaseEnvelope(
        driftFixture.distDirectory,
        'cloudflare',
      ),
    ).rejects.toThrow('digest does not match final artifact bytes');
  });

  it('does not impose the UltraModern envelope on legacy backend federation output', async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'modern-release-envelope-legacy-'),
    );
    tempDirectories.push(root);
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

  it.each([
    {
      surface: 'UI/client',
      actual: 'static/catalog.js',
      decoy: 'static/identity-decoy.js',
    },
    {
      surface: 'SSR',
      actual: 'bundles/main.js',
      decoy: 'bundles/identity-decoy.js',
    },
    {
      surface: 'API/backend',
      actual: 'api/index.js',
      decoy: 'shared/identity-decoy.js',
    },
  ])('rejects an identity decoy when the executed Node $surface module is stale', async ({
    actual,
    decoy,
  }) => {
    const fixture = await createTargetBuildOutput('node');
    await fs.writeFile(
      path.join(fixture.distDirectory, actual),
      compiledCarrier({ sourceRevision: 'c'.repeat(40) }),
    );
    await fs.mkdir(path.dirname(path.join(fixture.distDirectory, decoy)), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(fixture.distDirectory, decoy),
      compiledCarrier(),
    );

    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: fixture.distDirectory,
        target: 'node',
      }),
    ).rejects.toThrow(/exact buildMarker|execution module/u);
  });

  it('rejects a vacuous SSR carrier gate when route references match no execution module', async () => {
    const fixture = await createTargetBuildOutput('node');
    await writeJson(path.join(fixture.distDirectory, 'route.json'), {
      routes: [{ bundle: 'bundles/not-emitted.js', urlPath: '/' }],
    });
    await fs.writeFile(
      path.join(fixture.distDirectory, 'bundles/identity-decoy.js'),
      compiledCarrier(),
    );

    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: fixture.distDirectory,
        target: 'node',
      }),
    ).rejects.toThrow(
      'route-referenced Node SSR has no compiled execution module',
    );
  });

  it.each([
    ['node', 'bundles/stale-transitive.js'],
    ['cloudflare', 'worker/stale-transitive.js'],
  ] as const)('rejects a stale transitive %s SSR module outside the route manifest entry', async (target, staleLogicalPath) => {
    const fixture = await createTargetBuildOutput(target);
    await fs.writeFile(
      path.join(fixture.distDirectory, staleLogicalPath),
      compiledCarrier({ sourceRevision: 'c'.repeat(40) }),
    );

    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: fixture.distDirectory,
        target,
      }),
    ).rejects.toThrow(/compiled .*SSR.* closure execution module/u);
  });

  it.each([
    'node',
    'cloudflare',
  ] as const)('rejects a stale transitive %s SSR module in final deployment staging', async target => {
    const fixture = await createTargetBuildOutput(target);
    await emitFrameworkMicroVerticalReleaseEnvelope({
      apiOnly: false,
      distDirectory: fixture.distDirectory,
      target,
    });
    const outputDirectory = path.join(
      fixture.root,
      `${target}-stale-transitive`,
    );

    if (target === 'node') {
      await fs.cp(fixture.distDirectory, outputDirectory, {
        recursive: true,
      });
      await fs.rm(path.join(outputDirectory, 'release'), {
        recursive: true,
        force: true,
      });
      await fs.writeFile(
        path.join(outputDirectory, 'index.js'),
        compiledCarrier(),
      );
      await writeJson(path.join(outputDirectory, 'package.json'), {
        type: 'commonjs',
      });
      await fs.writeFile(
        path.join(outputDirectory, 'bundles/stale-transitive.js'),
        compiledCarrier({ sourceRevision: 'c'.repeat(40) }),
      );
      await expect(
        emitNodeStagedReleaseEnvelope({
          distDirectory: fixture.distDirectory,
          outputDirectory,
        }),
      ).rejects.toThrow(
        'final compiled Node SSR closure execution module bundles/stale-transitive.js',
      );
      return;
    }

    await createCloudflareStaging(fixture.distDirectory, outputDirectory);
    await fs.writeFile(
      path.join(outputDirectory, 'worker/stale-transitive.js'),
      compiledCarrier({ sourceRevision: 'c'.repeat(40) }),
    );
    await expect(
      emitCloudflareStagedReleaseEnvelope({
        distDirectory: fixture.distDirectory,
        outputDirectory,
      }),
    ).rejects.toThrow(
      'final compiled Cloudflare SSR/workerd closure execution module worker/stale-transitive.js',
    );
  });

  it('rejects mixed fresh and stale manifest-referenced client execution modules', async () => {
    const fixture = await createTargetBuildOutput('node');
    await fs.writeFile(
      path.join(fixture.distDirectory, 'static/catalog.js'),
      compiledCarrier({ sourceRevision: 'c'.repeat(40) }),
    );
    await fs.writeFile(
      path.join(fixture.distDirectory, 'static/fresh.js'),
      compiledCarrier(),
    );
    await writeJson(path.join(fixture.distDirectory, 'mf-manifest.json'), {
      exposes: [
        {
          assets: {
            js: {
              sync: ['static/catalog.js', 'static/fresh.js'],
            },
          },
          path: './Route',
        },
      ],
      name: 'verticalCatalog',
    });

    await expect(
      emitFrameworkMicroVerticalReleaseEnvelope({
        apiOnly: false,
        distDirectory: fixture.distDirectory,
        target: 'node',
      }),
    ).rejects.toThrow(
      'manifest-referenced UI/client execution module static/catalog.js',
    );
  });
});
