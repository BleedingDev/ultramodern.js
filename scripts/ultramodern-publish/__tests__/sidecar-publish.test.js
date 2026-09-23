// Consumer: publish-bleedingdev.yml version-preserving sidecar staging lane.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-sidecar-publish-'));

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeFile = (filePath, contents = 'fixture\n') => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

const legacyRoots = [
  'packages/sidecar/ipx',
  'packages/sidecar/image-size',
  'packages/sidecar/rsbuild-image-core',
];

const importSidecars = async () => {
  const sidecars = await import(
    '../lib/prepare-bleedingdev-packages/sidecars.mjs'
  );
  return {
    ...sidecars,
    collectSidecarPackages: (root, options = {}) =>
      sidecars.collectSidecarPackages(root, { roots: legacyRoots, ...options }),
  };
};

const ipxManifest = (overrides = {}) => ({
  name: '@bleedingdev/ipx',
  version: '3.2.0',
  license: 'MIT',
  bin: './bin/ipx.mjs',
  dependencies: {
    sharp: '^0.35.3',
  },
  publishConfig: { access: 'public' },
  ...overrides,
});

const imageSizeManifest = (overrides = {}) => ({
  name: '@bleedingdev/image-size',
  version: '2.1.0',
  license: 'MIT',
  bin: 'bin/image-size.js',
  publishConfig: { access: 'public' },
  ...overrides,
});

const coreManifest = (overrides = {}) => ({
  name: '@bleedingdev/rsbuild-image-core',
  version: '0.1.0',
  license: 'MIT',
  dependencies: {
    'image-size': 'npm:@bleedingdev/image-size@2.1.0',
  },
  publishConfig: { access: 'public' },
  ...overrides,
});

const makeSidecarFixture = ({
  ipx = ipxManifest(),
  imageSize = imageSizeManifest(),
  core = coreManifest(),
} = {}) => {
  const root = makeTempDir();
  writeJson(path.join(root, 'packages/sidecar/ipx/package.json'), ipx);
  writeFile(
    path.join(root, 'packages/sidecar/ipx/bin/ipx.mjs'),
    '#!/usr/bin/env node\n',
  );
  writeFile(
    path.join(root, 'packages/sidecar/ipx/dist/index.mjs'),
    'export {};\n',
  );
  writeJson(
    path.join(root, 'packages/sidecar/image-size/package.json'),
    imageSize,
  );
  writeFile(
    path.join(root, 'packages/sidecar/image-size/bin/image-size.js'),
    '#!/usr/bin/env node\n',
  );
  writeJson(
    path.join(root, 'packages/sidecar/rsbuild-image-core/package.json'),
    core,
  );
  writeFile(
    path.join(root, 'packages/sidecar/rsbuild-image-core/dist/index.js'),
    'module.exports = {};\n',
  );
  return root;
};

const stagedImageManifest = (overrides = {}) => ({
  name: '@bleedingdev/modern-js-image',
  packageJson: {
    name: '@bleedingdev/modern-js-image',
    version: '3.8.3-ultramodern.9',
    dependencies: {
      '@modern-js/utils':
        'npm:@bleedingdev/modern-js-utils@3.8.3-ultramodern.9',
      '@rsbuild-image/core': 'npm:@bleedingdev/rsbuild-image-core@0.1.0',
      '@rsbuild-image/react': '0.0.1-next.36',
      ipx: 'npm:@bleedingdev/ipx@3.2.0',
      sharp: '^0.35.3',
      ...overrides,
    },
  },
});

const cohortTargetNames = new Set([
  '@bleedingdev/modern-js-image',
  '@bleedingdev/modern-js-utils',
]);

test('stable sidecars are collected and staged verbatim', async () => {
  const { collectSidecarPackages, stageSidecarPackage } =
    await importSidecars();
  const root = makeSidecarFixture();
  const sidecars = collectSidecarPackages(root);

  assert.deepEqual(
    sidecars.map(sidecar => `${sidecar.name}@${sidecar.version}`),
    [
      '@bleedingdev/ipx@3.2.0',
      '@bleedingdev/image-size@2.1.0',
      '@bleedingdev/rsbuild-image-core@0.1.0',
    ],
  );

  const stageDir = path.join(root, '.modern/bleedingdev-publish/sidecars');
  fs.mkdirSync(stageDir, { recursive: true });
  const staged = await Promise.all(
    sidecars.map(sidecar =>
      stageSidecarPackage(sidecar, stageDir, { repoRoot: root }),
    ),
  );

  for (const item of staged) {
    const stagedManifestPath = path.join(item.stagedDir, 'package.json');
    assert.equal(
      fs.readFileSync(stagedManifestPath, 'utf8'),
      fs.readFileSync(item.packageJsonPath, 'utf8'),
      `${item.name} must stage byte-identically`,
    );
    const stagedManifest = JSON.parse(
      fs.readFileSync(stagedManifestPath, 'utf8'),
    );
    assert.equal(stagedManifest.name, item.name, 'name must not be prefixed');
    assert.equal(
      stagedManifest.version,
      item.version,
      'version must not be forced onto the cohort revision',
    );
    assert.ok(
      !/-ultramodern\./u.test(stagedManifest.version),
      'sidecars never take a cohort prerelease version',
    );
  }

  const stagedIpx = staged.find(item => item.name === '@bleedingdev/ipx');
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(stagedIpx.stagedDir, 'package.json'), 'utf8'),
    ).bin,
    './bin/ipx.mjs',
  );
  assert.ok(fs.existsSync(path.join(stagedIpx.stagedDir, 'bin/ipx.mjs')));
  assert.equal(
    stagedIpx.packageDir,
    path.join('.modern/bleedingdev-publish/sidecars', '@bleedingdev__ipx'),
  );
});

test('recipe-only sidecar closure records exact publication identities and alias edges', async () => {
  const sidecarsModule = await import(
    '../lib/prepare-bleedingdev-packages/sidecars.mjs'
  );
  const publication = await import(
    '../lib/prepare-bleedingdev-packages/sidecar-publication.mjs'
  );
  const sidecars = sidecarsModule.collectSidecarPackages();
  const byName = new Map(sidecars.map(sidecar => [sidecar.name, sidecar]));
  assert.equal(sidecars.length, 20);
  assert.equal(byName.get('@bleedingdev/effect').version, '4.0.0-rc.112');
  assert.equal(byName.get('@bleedingdev/drizzle-orm').version, '1.0.0-rc.4');
  assert.equal(
    byName.get('@bleedingdev/effect').packageJson.dependencies.msgpackr,
    'npm:@bleedingdev/msgpackr@2.1.0',
  );
  assert.equal(byName.get('@bleedingdev/mf-cli').recipeOnly, true);
  assert.equal(byName.get('@bleedingdev/mf-enhanced').recipeOnly, true);

  const ordered = sidecarsModule.sidecarPublishOrder(sidecars);
  sidecarsModule.validateAliasConsistency([], ordered);
  publication.assertSidecarPublishOrder(ordered);
  for (const sidecar of ordered) {
    publication.sidecarContentProjection(sidecar.packageJson, sidecar.name);
  }

  const consumer = {
    name: '@bleedingdev/modern-js-plugin-bff-extensions',
    dependencies: {
      '@module-federation/runtime': '2.9.0',
      effect: '4.0.0-rc.112',
    },
  };
  sidecarsModule.rewriteSidecarConsumerAliases(consumer, sidecars);
  assert.equal(
    consumer.dependencies['@module-federation/runtime'],
    'npm:@bleedingdev/mf-runtime@2.9.0',
  );
  assert.equal(
    consumer.dependencies.effect,
    'npm:@bleedingdev/effect@4.0.0-rc.112',
  );
});

test('prerelease sidecar versions are rejected', async () => {
  const { collectSidecarPackages } = await importSidecars();
  const root = makeSidecarFixture({
    ipx: ipxManifest({ version: '3.8.3-ultramodern.9' }),
  });

  assert.throws(
    () => collectSidecarPackages(root),
    /must be stable semver[\s\S]*prerelease/u,
  );
});

test('cohort-prefixed sidecar names are rejected', async () => {
  const { collectSidecarPackages } = await importSidecars();
  const root = makeSidecarFixture({
    ipx: ipxManifest({ name: '@bleedingdev/modern-js-ipx' }),
  });

  assert.throws(
    () => collectSidecarPackages(root),
    /must not carry the Modern\.js cohort prefix/u,
  );
});

test('non-bleedingdev sidecar names and non-public access are rejected', async () => {
  const { collectSidecarPackages } = await importSidecars();

  assert.throws(
    () =>
      collectSidecarPackages(
        makeSidecarFixture({ ipx: ipxManifest({ name: 'ipx' }) }),
      ),
    /must be named @bleedingdev\/<name>/u,
  );
  assert.throws(
    () =>
      collectSidecarPackages(
        makeSidecarFixture({ ipx: ipxManifest({ publishConfig: {} }) }),
      ),
    /publishConfig\.access "public"/u,
  );
  assert.throws(
    () =>
      collectSidecarPackages(
        makeSidecarFixture({
          core: coreManifest({
            dependencies: { 'image-size': 'workspace:*' },
          }),
        }),
      ),
    /workspace protocol/u,
  );
});

test('alias targets must match a staged sidecar exactly', async () => {
  const { collectSidecarPackages, validateAliasConsistency } =
    await importSidecars();
  const sidecars = collectSidecarPackages(makeSidecarFixture());

  assert.doesNotThrow(() =>
    validateAliasConsistency([stagedImageManifest()], sidecars, {
      cohortTargetNames,
    }),
  );

  assert.throws(
    () =>
      validateAliasConsistency(
        [stagedImageManifest({ ipx: 'npm:@bleedingdev/ipx@3.1.0' })],
        sidecars,
        { cohortTargetNames },
      ),
    /pins npm:@bleedingdev\/ipx@3\.1\.0 but sidecar @bleedingdev\/ipx stages version 3\.2\.0/u,
  );

  assert.throws(
    () =>
      validateAliasConsistency(
        [
          stagedImageManifest({
            '@rsbuild-image/react':
              'npm:@bleedingdev/rsbuild-image-react@0.1.0',
          }),
        ],
        sidecars,
        { cohortTargetNames },
      ),
    /neither a staged sidecar nor a cohort package/u,
  );
});

test('release staging projects exact sidecar aliases without making source installs depend on unpublished packages', async () => {
  const { collectSidecarPackages, rewriteSidecarConsumerAliases } =
    await importSidecars();
  const sidecars = collectSidecarPackages(makeSidecarFixture());
  const packageJson = {
    name: '@bleedingdev/modern-js-image',
    dependencies: {
      '@rsbuild-image/core': '0.0.1-next.36',
      '@rsbuild-image/react': '0.0.1-next.36',
      ipx: '^3.1.1',
      sharp: '^0.35.3',
    },
  };

  rewriteSidecarConsumerAliases(packageJson, sidecars);
  assert.equal(
    packageJson.dependencies['@rsbuild-image/core'],
    'npm:@bleedingdev/rsbuild-image-core@0.1.0',
  );
  assert.equal(packageJson.dependencies.ipx, 'npm:@bleedingdev/ipx@3.2.0');
  assert.equal(
    packageJson.dependencies['@rsbuild-image/react'],
    '0.0.1-next.36',
  );
  assert.equal(packageJson.dependencies.sharp, '^0.35.3');

  assert.throws(
    () =>
      rewriteSidecarConsumerAliases(
        { name: packageJson.name, dependencies: { ipx: '^3.1.1' } },
        sidecars,
      ),
    /must declare dependencies\.@rsbuild-image\/core/u,
  );
});

test('sidecar-internal aliases are validated and ordered before their dependents', async () => {
  const {
    collectSidecarPackages,
    sidecarPublishOrder,
    validateAliasConsistency,
    writeSidecarStagingManifest,
    stageSidecarPackage,
  } = await importSidecars();

  const mismatched = collectSidecarPackages(
    makeSidecarFixture({
      core: coreManifest({
        dependencies: { 'image-size': 'npm:@bleedingdev/image-size@2.0.2' },
      }),
    }),
  );
  assert.throws(
    () => validateAliasConsistency([], mismatched, { cohortTargetNames }),
    /pins npm:@bleedingdev\/image-size@2\.0\.2/u,
  );

  const root = makeSidecarFixture();
  const sidecars = collectSidecarPackages(root);
  const order = sidecarPublishOrder(sidecars).map(sidecar => sidecar.name);
  assert.ok(
    order.indexOf('@bleedingdev/image-size') <
      order.indexOf('@bleedingdev/rsbuild-image-core'),
    'image-size must publish before the core fork that aliases it',
  );

  const outDir = path.join(root, '.modern/bleedingdev-publish');
  const stageDir = path.join(outDir, 'sidecars');
  fs.mkdirSync(stageDir, { recursive: true });
  const staged = await Promise.all(
    sidecars.map(sidecar =>
      stageSidecarPackage(sidecar, stageDir, { repoRoot: root }),
    ),
  );
  const { manifest, manifestPath } = writeSidecarStagingManifest(
    outDir,
    staged,
    { publishBefore: '@bleedingdev/modern-js-image' },
  );
  assert.equal(manifest.publishBefore, '@bleedingdev/modern-js-image');
  assert.deepEqual(manifest.publishOrder, order);
  assert.deepEqual(
    manifest.packages.map(item => item.version),
    order.map(name => sidecars.find(sidecar => sidecar.name === name).version),
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifest);
});

test('object-form sidecar bins must still expose the upstream CLI name', async () => {
  const { collectSidecarPackages, normalizeSidecarBin } =
    await importSidecars();

  assert.deepEqual(
    normalizeSidecarBin({ name: '@bleedingdev/ipx', bin: './bin/ipx.mjs' }),
    { ipx: 'bin/ipx.mjs' },
  );

  assert.doesNotThrow(() =>
    collectSidecarPackages(
      makeSidecarFixture({
        ipx: ipxManifest({ bin: { ipx: './bin/ipx.mjs' } }),
      }),
    ),
  );
  assert.throws(
    () =>
      collectSidecarPackages(
        makeSidecarFixture({
          ipx: ipxManifest({ bin: { 'ipx-cli': './bin/ipx.mjs' } }),
        }),
      ),
    /must expose the 'ipx' bin/u,
  );
  assert.throws(
    () =>
      collectSidecarPackages(
        makeSidecarFixture({ ipx: ipxManifest({ bin: undefined }) }),
      ),
    /must keep the upstream 'ipx' bin/u,
  );
});

test('release rewriting rejects npm: alias targets that point at upstream names', async () => {
  const { rewritePackageJson } = await import(
    '../lib/prepare-bleedingdev-packages/rewrite.mjs'
  );
  const options = {
    bugsUrl: 'https://github.com/BleedingDev/ultramodern.js/issues',
    dependencyVersion: '3.8.3-ultramodern.9',
    homepage: 'https://github.com/BleedingDev/ultramodern.js',
    prefix: 'modern-js-',
    repositoryUrl: 'git+https://github.com/BleedingDev/ultramodern.js.git',
    scope: 'bleedingdev',
    version: '3.8.3-ultramodern.9',
  };
  const sourceNames = new Set(['@modern-js/image', '@modern-js/utils']);

  assert.throws(
    () =>
      rewritePackageJson(
        {
          name: '@modern-js/image',
          version: '3.8.3',
          dependencies: {
            'image-utils': 'npm:@modern-js/utils@3.8.3',
          },
        },
        '@modern-js/image',
        options,
        sourceNames,
      ),
    /alias specifier npm:@modern-js\/utils@3\.8\.3[\s\S]*never npm: alias targets/u,
  );

  assert.throws(
    () =>
      rewritePackageJson(
        {
          name: '@modern-js/image',
          version: '3.8.3',
          peerDependencies: {
            '@modern-js/utils': 'npm:@modern-js/utils@^3.8.3',
          },
        },
        '@modern-js/image',
        options,
        sourceNames,
      ),
    /peerDependencies\.@modern-js\/utils/u,
  );
});

test('sidecar npm: aliases survive cohort rewriting untouched', async () => {
  const { rewritePackageJson } = await import(
    '../lib/prepare-bleedingdev-packages/rewrite.mjs'
  );
  const options = {
    bugsUrl: 'https://github.com/BleedingDev/ultramodern.js/issues',
    dependencyVersion: '3.8.3-ultramodern.9',
    homepage: 'https://github.com/BleedingDev/ultramodern.js',
    prefix: 'modern-js-',
    repositoryUrl: 'git+https://github.com/BleedingDev/ultramodern.js.git',
    scope: 'bleedingdev',
    version: '3.8.3-ultramodern.9',
  };
  const packageJson = {
    name: '@modern-js/image',
    version: '3.8.3',
    dependencies: {
      '@modern-js/utils': 'workspace:*',
      '@rsbuild-image/core': 'npm:@bleedingdev/rsbuild-image-core@0.1.0',
      '@rsbuild-image/react': '0.0.1-next.36',
      ipx: 'npm:@bleedingdev/ipx@3.2.0',
      sharp: '^0.35.3',
    },
  };

  rewritePackageJson(
    packageJson,
    '@modern-js/image',
    options,
    new Set(['@modern-js/image', '@modern-js/utils']),
  );

  assert.deepEqual(packageJson.dependencies, {
    '@modern-js/utils': 'npm:@bleedingdev/modern-js-utils@3.8.3-ultramodern.9',
    '@rsbuild-image/core': 'npm:@bleedingdev/rsbuild-image-core@0.1.0',
    '@rsbuild-image/react': '0.0.1-next.36',
    ipx: 'npm:@bleedingdev/ipx@3.2.0',
    sharp: '^0.35.3',
  });
  assert.equal(packageJson.name, '@bleedingdev/modern-js-image');
  assert.equal(packageJson.version, '3.8.3-ultramodern.9');
});

test('--include-sidecars is opt-in, staging-only, and leaves defaults untouched', async () => {
  const { parseArgs } = await import(
    '../lib/prepare-bleedingdev-packages/options.mjs'
  );

  const baseline = parseArgs(['--version', '3.8.3-ultramodern.9']);
  assert.equal(baseline.includeSidecars, false);

  const withSidecars = parseArgs([
    '--version',
    '3.8.3-ultramodern.9',
    '--include-sidecars',
  ]);
  assert.equal(withSidecars.includeSidecars, true);

  assert.throws(
    () =>
      parseArgs([
        '--version',
        '3.8.3-ultramodern.9',
        '--include-sidecars',
        '--publish',
      ]),
    /staging-only flag/u,
  );
  assert.throws(
    () =>
      parseArgs([
        '--version',
        '3.8.3-ultramodern.9',
        '--include-sidecars',
        '--publish-existing',
      ]),
    /staging-only flag/u,
  );
  assert.throws(
    () =>
      parseArgs([
        '--version',
        '3.8.3-ultramodern.9',
        '--include-sidecars=true',
      ]),
    /Unknown argument: --include-sidecars=true/u,
  );
});
