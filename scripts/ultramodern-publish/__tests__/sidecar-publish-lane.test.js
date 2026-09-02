// Consumer: publish-bleedingdev.yml publish-sidecars job and its CLI/helpers.
//
// Two things are proved here without any install or network:
//   1. the workflow statically orders sidecar publication before the cohort,
//      with OIDC-only publish authority and no token secret;
//   2. the exact-version idempotency helper reuses an identical published
//      version and fails closed on every other registry state.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../../..');
const publishWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/publish-bleedingdev.yml',
);
const sidecarCliPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/publish-sidecars.mjs',
);
const requireFromPrebundle = createRequire(
  path.join(repoRoot, 'scripts/prebundle/package.json'),
);
const { load: parseYaml } = requireFromPrebundle('js-yaml');

const cohortAliasConsumer = '@bleedingdev/modern-js-image';
const sidecarNames = Object.freeze([
  '@bleedingdev/ipx',
  '@bleedingdev/image-size',
  '@bleedingdev/rsbuild-image-core',
]);

const workflow = () => parseYaml(fs.readFileSync(publishWorkflowPath, 'utf8'));
const normalizeNeeds = job =>
  Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
const jobStepRun = (job, namePattern) =>
  job.steps
    .filter(step => namePattern.test(String(step.name ?? '')))
    .map(step => String(step.run ?? ''));

const importPublication = () =>
  import('../lib/prepare-bleedingdev-packages/sidecar-publication.mjs');
const importCli = () => import('../publish-sidecars.mjs');

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-sidecar-lane-'));

const acceptedSidecarRelease = async releaseDir => {
  const { inspectNpmTarball } = await import(
    '../lib/prepare-bleedingdev-packages/release-artifacts.mjs'
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(releaseDir, 'sidecars.json'), 'utf8'),
  );
  const packages = manifest.packages.map(entry => {
    const bytes = fs.readFileSync(path.join(releaseDir, entry.tarballPath));
    const inspection = inspectNpmTarball(bytes);
    return {
      ...entry,
      artifactPath: path.join(releaseDir, entry.tarballPath),
      bytes,
      packageJson: inspection.packageJson,
    };
  });
  return {
    manifest: {
      tools: { node: process.version, npm: '11.10.1', pnpm: '11.24.0' },
    },
    sidecars: { manifest, packages },
  };
};

// ---------------------------------------------------------------------------
// Static workflow proofs
// ---------------------------------------------------------------------------

test('sidecar publication is a dedicated job the cohort publish depends on', () => {
  const parsed = workflow();
  const sidecarJob = parsed.jobs['publish-sidecars'];
  const publishJob = parsed.jobs.publish;

  assert.ok(sidecarJob, 'publish-sidecars job must exist');
  assert.ok(
    normalizeNeeds(publishJob).includes('publish-sidecars'),
    'the cohort publish job must declare publish-sidecars in needs, so a failed sidecar publication makes it unreachable',
  );
  // The sidecar job must itself sit behind the same gates the cohort publish
  // does; otherwise sidecars could reach npm from an unqualified source.
  for (const gate of ['publish-security', 'qualify-source', 'accept-release']) {
    assert.ok(
      normalizeNeeds(sidecarJob).includes(gate),
      `publish-sidecars must need ${gate}`,
    );
  }
  assert.ok(
    !normalizeNeeds(sidecarJob).includes('publish'),
    'publish-sidecars must not depend on the cohort publish it precedes',
  );

  // Both publish jobs are gated on the same dispatch conditions, so a dry run
  // skips both and a real run requires both.
  assert.equal(sidecarJob.if.includes('inputs.dry_run == false'), true);
  assert.equal(publishJob.if.includes('inputs.dry_run == false'), true);
  assert.equal(sidecarJob.environment, 'npm-publish');
  assert.equal(sidecarJob.environment, publishJob.environment);
});

test('sidecar publication uses OIDC without registry secrets', () => {
  const parsed = workflow();
  const sidecarJob = parsed.jobs['publish-sidecars'];

  assert.deepEqual(sidecarJob.permissions, {
    actions: 'read',
    contents: 'read',
    'id-token': 'write',
  });
  assert.deepEqual(parsed.permissions, { contents: 'read', actions: 'read' });

  const oidcJobs = Object.entries(parsed.jobs)
    .filter(([, job]) => job.permissions?.['id-token'] === 'write')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(
    oidcJobs,
    ['publish', 'publish-sidecars'],
    'only the two registry-publishing jobs may hold id-token: write',
  );

  assert.doesNotMatch(
    JSON.stringify(parsed),
    /NODE_AUTH_TOKEN|NPM_TOKEN|npm_token|"registry-url":|secrets\./u,
    'publication must remain OIDC-only and secret-free',
  );
});

test('sidecars are staged with the cohort and carried in the immutable bundle', () => {
  const parsed = workflow();
  const prepareJob = parsed.jobs['prepare-release'];

  const [prepareRun] = jobStepRun(prepareJob, /^Prepare exact release/u);
  assert.match(prepareRun, /--include-sidecars/u);

  const [stagingCheck] = jobStepRun(prepareJob, /staged sidecar publication/u);
  assert.match(stagingCheck, /publish-sidecars\.mjs/u);
  assert.match(stagingCheck, /--check-staging/u);

  const upload = prepareJob.steps.find(step =>
    /upload-artifact/u.test(String(step.uses ?? '')),
  );
  assert.match(upload.with.path, /sidecars\.json/u);
  assert.match(upload.with.path, /sidecar-tarballs\/\*\.tgz/u);
  assert.doesNotMatch(upload.with.path, /sidecars\/\*\*/u);

  const [identityRun] = jobStepRun(
    parsed.jobs.publish,
    /Prepare non-dry-run release identity/u,
  );
  assert.match(identityRun, /manifest\.schemaVersion !== 3/u);
  assert.match(identityRun, /'sidecars'/u);
  assert.match(identityRun, /strict v3 shape/u);
});

test('the OIDC sidecar job verifies the clean-room acceptance receipt before publishing', () => {
  const parsed = workflow();
  const sidecarJob = parsed.jobs['publish-sidecars'];
  const receiptDownload = sidecarJob.steps.find(step =>
    /Download release acceptance receipt/u.test(String(step.name ?? '')),
  );
  assert.ok(receiptDownload);
  assert.match(
    receiptDownload.with.name,
    /BLEEDINGDEV_RELEASE_ACCEPTANCE_ARTIFACT/u,
  );

  const [verifyRun] = jobStepRun(
    sidecarJob,
    /Verify exact release acceptance receipt/u,
  );
  assert.match(verifyRun, /run-release-acceptance\.mjs/u);
  assert.match(verifyRun, /--verify-receipt/u);
  assert.match(verifyRun, /acceptance-receipt\.mjs/u);
  assert.match(verifyRun, /--verify/u);
});

test('the sidecar lane publishes before the cohort and never with it', () => {
  const parsed = workflow();
  const sidecarRuns = jobStepRun(
    parsed.jobs['publish-sidecars'],
    /Publish the staged sidecars/u,
  );
  assert.equal(sidecarRuns.length, 1);
  assert.match(sidecarRuns[0], /publish-sidecars\.mjs/u);
  assert.match(sidecarRuns[0], /--tag "\$BLEEDINGDEV_PUBLISH_TAG"/u);
  // Latest-only: the tag is the workflow-level env pin, never a literal.
  assert.equal(parsed.env.BLEEDINGDEV_PUBLISH_TAG, 'latest');

  // The cohort publish step must stay the cohort CLI: sidecars are never
  // republished through the cohort's version-forcing lane.
  const [cohortRun] = jobStepRun(
    parsed.jobs.publish,
    /^Publish only the accepted/u,
  );
  assert.match(cohortRun, /prepare-bleedingdev-packages\.mjs/u);
  assert.ok(!/--include-sidecars/u.test(cohortRun));

  // A dry run validates the same reconciliation without publish authority.
  const [dryRun] = jobStepRun(
    parsed.jobs['validate-release'],
    /sidecar publication lane against the registry/u,
  );
  assert.match(dryRun, /--dry-run/u);
  assert.equal(
    parsed.jobs['validate-release'].permissions,
    undefined,
    'the dry-run validation job must not acquire publish permissions',
  );
});

test('the recorded publish outcome cannot claim success without the sidecar lane', () => {
  const parsed = workflow();
  const record = parsed.jobs['record-publish-outcome'];
  assert.ok(normalizeNeeds(record).includes('publish-sidecars'));
  assert.match(
    record.if,
    /needs\.publish-sidecars\.result == 'success'/u,
    'a real publish outcome requires a successful sidecar lane',
  );
  assert.match(
    record.if,
    /needs\.publish-sidecars\.result == 'skipped'/u,
    'a dry-run outcome requires the sidecar publish job to have been skipped',
  );
});

// ---------------------------------------------------------------------------
// Staging-lane order proofs, against the real repository sidecars
// ---------------------------------------------------------------------------

test('the repository sidecar lane orders image-size before its dependent, all before the cohort', async () => {
  const [
    {
      collectSidecarPackages,
      sidecarPublishOrder,
      writeSidecarStagingManifest,
      stageSidecarPackage,
    },
    publication,
  ] = await Promise.all([
    import('../lib/prepare-bleedingdev-packages/sidecars.mjs'),
    importPublication(),
  ]);

  const sidecars = collectSidecarPackages(repoRoot);
  const order = sidecarPublishOrder(sidecars).map(item => item.name);
  assert.deepEqual([...order].sort(), [...sidecarNames].sort());
  assert.ok(
    order.indexOf('@bleedingdev/image-size') <
      order.indexOf('@bleedingdev/rsbuild-image-core'),
    'image-size must publish before the rsbuild-image-core fork that aliases it',
  );
  assert.ok(order.includes('@bleedingdev/ipx'));

  const root = makeTempDir();
  const stageDir = path.join(root, 'sidecars');
  fs.mkdirSync(stageDir, { recursive: true });
  const staged = sidecars.map(sidecar =>
    stageSidecarPackage(sidecar, stageDir, { repoRoot: root }),
  );
  const { manifest } = writeSidecarStagingManifest(root, staged, {
    publishBefore: cohortAliasConsumer,
  });

  // The manifest the CLI consumes must pass the publication gate unchanged,
  // and it must address the cohort package that carries the aliases.
  assert.deepEqual(
    publication.assertSidecarStagingManifest(manifest).publishOrder,
    order,
  );
  assert.equal(manifest.publishBefore, cohortAliasConsumer);
  assert.doesNotThrow(() => publication.assertSidecarPublishOrder(sidecars));
});

test('a mis-ordered or mis-addressed sidecar staging manifest fails closed', async () => {
  const { assertSidecarPublishOrder, assertSidecarStagingManifest } =
    await importPublication();

  const entry = (name, version) => ({
    fileCount: 1,
    fileListSha256: '1'.repeat(64),
    integrity: `sha512-${Buffer.from(name).toString('base64')}`,
    name,
    packageJsonSha256: '2'.repeat(64),
    root: `packages/sidecar/${name.split('/')[1]}`,
    sha256: '3'.repeat(64),
    shasum: '4'.repeat(40),
    size: 1,
    tarballPath: `sidecar-tarballs/${name.replaceAll('/', '-')}-${version}.tgz`,
    unpackedSize: 1,
    version,
  });
  const manifest = {
    schema: 'bleedingdev.ultramodern.sidecar-manifest',
    schemaVersion: 2,
    publishBefore: cohortAliasConsumer,
    publishOrder: sidecarNames,
    packages: sidecarNames.map(name =>
      entry(
        name,
        name === '@bleedingdev/rsbuild-image-core' ? '0.1.0' : '2.1.0',
      ),
    ),
  };
  assert.doesNotThrow(() => assertSidecarStagingManifest(manifest));

  assert.throws(
    () =>
      assertSidecarStagingManifest({
        ...manifest,
        publishBefore: '@bleedingdev/modern-js-utils',
      }),
    /must publish before @bleedingdev\/modern-js-image/u,
  );
  assert.throws(
    () => assertSidecarStagingManifest({ ...manifest, schemaVersion: 3 }),
    /Unknown sidecar staging manifest schema .*@3/u,
  );
  assert.throws(
    () =>
      assertSidecarStagingManifest({
        ...manifest,
        publishOrder: [...sidecarNames].reverse(),
      }),
    /publishOrder\[0\] is @bleedingdev\/rsbuild-image-core but packages\[0\] is @bleedingdev\/ipx/u,
  );
  assert.throws(
    () =>
      assertSidecarStagingManifest({
        ...manifest,
        packages: manifest.packages.map(item =>
          item.name === '@bleedingdev/ipx'
            ? { ...item, version: '3.2.0-rc.1' }
            : item,
        ),
      }),
    /must be stable semver/u,
  );
  assert.throws(
    () =>
      assertSidecarStagingManifest({
        ...manifest,
        publishOrder: ['@bleedingdev/modern-js-ipx', ...sidecarNames.slice(1)],
        packages: [
          entry('@bleedingdev/modern-js-ipx', '3.2.0'),
          ...manifest.packages.slice(1),
        ],
      }),
    /must not carry the Modern\.js cohort prefix/u,
  );

  // Structural order gate: a sidecar aliasing another must publish after it.
  const imageSize = {
    name: '@bleedingdev/image-size',
    version: '2.1.0',
    packageJson: { name: '@bleedingdev/image-size', version: '2.1.0' },
  };
  const core = {
    name: '@bleedingdev/rsbuild-image-core',
    version: '0.1.0',
    packageJson: {
      name: '@bleedingdev/rsbuild-image-core',
      version: '0.1.0',
      dependencies: { 'image-size': 'npm:@bleedingdev/image-size@2.1.0' },
    },
  };
  assert.doesNotThrow(() => assertSidecarPublishOrder([imageSize, core]));
  assert.throws(
    () => assertSidecarPublishOrder([core, imageSize]),
    /is ordered after it/u,
  );
  assert.throws(
    () => assertSidecarPublishOrder([{ ...imageSize, version: '2.0.2' }, core]),
    /pins npm:@bleedingdev\/image-size@2\.1\.0 but @bleedingdev\/image-size stages version 2\.0\.2/u,
  );
});

// ---------------------------------------------------------------------------
// Exact-version idempotency / fail-closed proofs
// ---------------------------------------------------------------------------

const stagedIpx = () => ({
  name: '@bleedingdev/ipx',
  version: '3.2.0',
  integrity: `sha512-${Buffer.from('accepted-ipx').toString('base64')}`,
  shasum: 'a'.repeat(40),
  packageJson: {
    name: '@bleedingdev/ipx',
    version: '3.2.0',
    description: 'sidecar fork',
    license: 'MIT',
    repository: 'unjs/ipx',
    publishConfig: {
      registry: 'https://registry.npmjs.org/',
      access: 'public',
    },
    main: './dist/index.cjs',
    module: './dist/index.mjs',
    types: './dist/index.d.ts',
    bin: './bin/ipx.mjs',
    files: ['dist', 'bin'],
    scripts: { verify: 'node ./scripts/verify.mjs' },
    dependencies: { sharp: '^0.35.3' },
  },
});

const packumentFor = (sidecar, { tag = '3.2.0', overrides = {} } = {}) => ({
  name: sidecar.name,
  'dist-tags': { latest: tag },
  versions: {
    [sidecar.version]: {
      name: sidecar.name,
      version: sidecar.version,
      // npm normalizes a string bin to object form and rewrites repository.
      bin: { ipx: 'bin/ipx.mjs' },
      main: './dist/index.cjs',
      module: './dist/index.mjs',
      types: './dist/index.d.ts',
      dependencies: { sharp: '^0.35.3' },
      repository: { type: 'git', url: 'git+https://github.com/unjs/ipx.git' },
      gitHead: 'a'.repeat(40),
      dist: {
        integrity: sidecar.integrity,
        shasum: sidecar.shasum,
        tarball: 'https://example.invalid/x.tgz',
      },
      _id: `${sidecar.name}@${sidecar.version}`,
      ...overrides,
    },
  },
});

test('an unpublished sidecar version is published; a byte-identical one is reused', async () => {
  const { sidecarRegistryDecision } = await importPublication();
  const sidecar = stagedIpx();

  assert.deepEqual(
    sidecarRegistryDecision(sidecar, null).action,
    'publish',
    'a package that has never been published must publish',
  );
  assert.equal(
    sidecarRegistryDecision(sidecar, {
      name: sidecar.name,
      'dist-tags': { latest: '3.1.0' },
      versions: { '3.1.0': { name: sidecar.name, version: '3.1.0' } },
    }).action,
    'publish',
    'a forward version over an older latest must publish',
  );

  // The re-run case: the exact version exists and resolves identically.
  const reuse = sidecarRegistryDecision(sidecar, packumentFor(sidecar));
  assert.equal(reuse.action, 'reuse');
  assert.equal(reuse.currentTag, '3.2.0');
  assert.match(reuse.reason, /accepted tarball bytes/u);
});

test('registry content, version, and dist-tag mismatches fail closed', async () => {
  const { sidecarRegistryDecision } = await importPublication();
  const sidecar = stagedIpx();

  // Matching manifest fields are insufficient: registry reuse must bind the
  // exact accepted tarball bytes.
  assert.throws(
    () =>
      sidecarRegistryDecision(
        sidecar,
        packumentFor(sidecar, {
          overrides: {
            dist: {
              integrity: `sha512-${Buffer.from('different').toString('base64')}`,
              shasum: 'b'.repeat(40),
            },
          },
        }),
      ),
    /already published from different tarball bytes[\s\S]*integrity:[\s\S]*shasum:/u,
  );

  // Content drift on an immutable version: the published package is not the
  // one this run staged, and no re-run can fix it.
  assert.throws(
    () =>
      sidecarRegistryDecision(
        sidecar,
        packumentFor(sidecar, {
          overrides: { dependencies: { sharp: '^0.34.0' } },
        }),
      ),
    /already published with different content[\s\S]*dependencies: staged .*0\.35\.3.*registry .*0\.34\.0/u,
  );
  // A renamed CLI is exactly what the never-prefix-a-sidecar rule prevents.
  assert.throws(
    () =>
      sidecarRegistryDecision(
        sidecar,
        packumentFor(sidecar, {
          overrides: { bin: { 'modern-js-ipx': 'bin/ipx.mjs' } },
        }),
      ),
    /already published with different content[\s\S]*bin:/u,
  );
  // A resolution-critical field present on one side only is still drift.
  assert.throws(
    () =>
      sidecarRegistryDecision(
        sidecar,
        packumentFor(sidecar, {
          overrides: { peerDependencies: { sharp: '>=0.33.5' } },
        }),
      ),
    /peerDependencies: staged null/u,
  );

  // The dist-tag must land on the version the cohort aliases.
  assert.throws(
    () =>
      sidecarRegistryDecision(sidecar, packumentFor(sidecar, { tag: '3.3.0' })),
    /dist-tag latest points at 3\.3\.0, expected the already-published 3\.2\.0/u,
  );
  assert.throws(
    () =>
      sidecarRegistryDecision(sidecar, {
        name: sidecar.name,
        'dist-tags': { latest: '3.2.0' },
        versions: {},
      }),
    /dist-tag latest points at 3\.2\.0, but that exact registry version is absent/u,
  );
  // A backwards republish would make the cohort alias resolve to older bytes.
  assert.throws(
    () =>
      sidecarRegistryDecision(sidecar, {
        name: sidecar.name,
        'dist-tags': { latest: '3.4.0' },
        versions: { '3.4.0': { name: sidecar.name, version: '3.4.0' } },
      }),
    /must be greater than the current latest 3\.4\.0/u,
  );
  // Uncertain registry shapes are never read as "not published yet".
  assert.throws(
    () =>
      sidecarRegistryDecision(sidecar, { name: sidecar.name, versions: {} }),
    /invalid registry dist-tags/u,
  );
  assert.throws(
    () =>
      sidecarRegistryDecision(sidecar, {
        name: '@bleedingdev/other',
        'dist-tags': {},
        versions: {},
      }),
    /identifies package @bleedingdev\/other/u,
  );
});

test('an unclassified staged manifest field blocks the content comparison', async () => {
  const {
    sidecarContentProjection,
    sidecarResolutionFields,
    sidecarIgnoredFields,
  } = await importPublication();

  assert.equal(
    sidecarResolutionFields.some(field => sidecarIgnoredFields.includes(field)),
    false,
    'a field is either resolution-critical or npm-normalized, never both',
  );
  assert.throws(
    () =>
      sidecarContentProjection(
        { ...stagedIpx().packageJson, unknownFutureField: true },
        'fixture',
      ),
    /does not classify: unknownFutureField/u,
  );
});

test('sidecar publish targets are pinned to npm, public, and tag-free', async () => {
  const { assertSidecarPublishTarget } = await importPublication();
  const base = stagedIpx().packageJson;

  assert.doesNotThrow(() => assertSidecarPublishTarget(base, 'fixture'));
  assert.throws(
    () =>
      assertSidecarPublishTarget(
        {
          ...base,
          publishConfig: {
            access: 'public',
            registry: 'https://npm.example.invalid/',
          },
        },
        'fixture',
      ),
    /is not the pinned https:\/\/registry\.npmjs\.org\//u,
  );
  assert.throws(
    () =>
      assertSidecarPublishTarget(
        { ...base, publishConfig: { access: 'public', tag: 'next' } },
        'fixture',
      ),
    /must not pin a dist-tag/u,
  );
  assert.throws(
    () => assertSidecarPublishTarget({ ...base, tag: 'next' }, 'fixture'),
    /must not declare a top-level tag/u,
  );
  assert.throws(
    () => assertSidecarPublishTarget({ ...base, publishConfig: {} }, 'fixture'),
    /publishConfig\.access "public"/u,
  );
});

test('sidecar publication rejects accepted toolchain drift before requesting OIDC', async () => {
  const { publishSidecarBuffer } = await importCli();
  let requestedToken = false;
  await assert.rejects(
    publishSidecarBuffer(
      stagedIpx(),
      Buffer.from('accepted tarball'),
      {
        acceptedTools: { node: 'v0.0.0', npm: '11.10.1', pnpm: '11.24.0' },
        tag: 'latest',
      },
      {
        loadRuntime: () => ({ npmVersion: '11.10.1', publish: async () => {} }),
        requestToken: async () => {
          requestedToken = true;
          return 'token';
        },
      },
    ),
    /Trusted publishing Node\.js drift/u,
  );
  assert.equal(requestedToken, false);
});

test('publishing requires the trusted-publishing workflow context', async () => {
  const { assertSidecarTrustedPublishContext } = await importPublication();
  const trusted = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'BleedingDev/ultramodern.js',
    GITHUB_REF: 'refs/heads/main-ultramodern',
  };

  assert.doesNotThrow(() => assertSidecarTrustedPublishContext(trusted));
  assert.throws(
    () =>
      assertSidecarTrustedPublishContext({
        ...trusted,
        GITHUB_ACTIONS: undefined,
      }),
    /only allowed from the GitHub Actions trusted publishing workflow/u,
  );
  assert.throws(
    () =>
      assertSidecarTrustedPublishContext({
        ...trusted,
        GITHUB_REPOSITORY: 'attacker/fork',
      }),
    /only allowed from BleedingDev\/ultramodern\.js/u,
  );
  assert.throws(
    () =>
      assertSidecarTrustedPublishContext({
        ...trusted,
        GITHUB_REF: 'refs/heads/main',
      }),
    /only allowed from refs\/heads\/main-ultramodern/u,
  );
});

// ---------------------------------------------------------------------------
// CLI contract
// ---------------------------------------------------------------------------

test('the sidecar CLI is latest-only, staging-scoped, and mode-exclusive', async () => {
  const { parseArgs } = await importCli();

  const baseline = parseArgs([]);
  assert.equal(baseline.tag, 'latest');
  assert.equal(baseline.dryRun, false);
  assert.equal(baseline.checkStaging, false);
  assert.equal(
    baseline.out,
    path.join(repoRoot, '.modern/bleedingdev-publish'),
  );

  assert.equal(parseArgs(['--dry-run']).dryRun, true);
  assert.equal(parseArgs(['--check-staging']).checkStaging, true);
  assert.throws(
    () => parseArgs(['--dry-run', '--check-staging']),
    /mutually exclusive/u,
  );
  assert.throws(() => parseArgs(['--tag', 'next']), /--tag must be latest/u);
  assert.throws(() => parseArgs(['--dry-run=true']), /Unknown argument/u);
  assert.throws(
    () => parseArgs(['--out', path.join(os.tmpdir(), 'elsewhere')]),
    /must be inside/u,
  );
  assert.ok(fs.existsSync(sidecarCliPath));
});

test('immutable sidecar verification rejects descriptor, manifest, archive, and set tampering', async () => {
  const { verifySidecarArtifacts } = await import(
    '../lib/prepare-bleedingdev-packages/release-artifacts.mjs'
  );
  const {
    collectSidecarPackages,
    stageSidecarPackage,
    writeSidecarStagingManifest,
  } = await import('../lib/prepare-bleedingdev-packages/sidecars.mjs');
  const releaseDir = makeTempDir();
  const stageDir = path.join(releaseDir, 'sidecars');
  fs.mkdirSync(stageDir, { recursive: true });

  try {
    const staged = collectSidecarPackages(repoRoot).map(sidecar =>
      stageSidecarPackage(sidecar, stageDir, { repoRoot: releaseDir }),
    );
    const { descriptor } = writeSidecarStagingManifest(releaseDir, staged, {
      publishBefore: cohortAliasConsumer,
    });
    const manifestPath = path.join(releaseDir, descriptor.manifestPath);
    const tarballsDir = path.join(releaseDir, 'sidecar-tarballs');
    const manifestBytes = fs.readFileSync(manifestPath);
    const tarballs = new Map(
      fs
        .readdirSync(tarballsDir)
        .map(fileName => [
          fileName,
          fs.readFileSync(path.join(tarballsDir, fileName)),
        ]),
    );
    const sha256 = bytes =>
      crypto.createHash('sha256').update(bytes).digest('hex');
    const restore = () => {
      fs.writeFileSync(manifestPath, manifestBytes);
      fs.rmSync(tarballsDir, { force: true, recursive: true });
      fs.mkdirSync(tarballsDir);
      for (const [fileName, bytes] of tarballs) {
        fs.writeFileSync(path.join(tarballsDir, fileName), bytes);
      }
    };

    assert.doesNotThrow(() => verifySidecarArtifacts(releaseDir, descriptor));
    assert.throws(
      () =>
        verifySidecarArtifacts(releaseDir, {
          ...descriptor,
          sha256: '0'.repeat(64),
        }),
      /Sidecar manifest SHA-256 mismatch/u,
    );

    fs.appendFileSync(manifestPath, ' ');
    assert.throws(
      () => verifySidecarArtifacts(releaseDir, descriptor),
      /Sidecar manifest SHA-256 mismatch/u,
    );
    restore();

    const manifest = JSON.parse(manifestBytes);
    const nonCanonicalBytes = Buffer.from(JSON.stringify(manifest));
    fs.writeFileSync(manifestPath, nonCanonicalBytes);
    assert.throws(
      () =>
        verifySidecarArtifacts(releaseDir, {
          ...descriptor,
          sha256: sha256(nonCanonicalBytes),
        }),
      /Sidecar manifest is not canonical JSON/u,
    );
    restore();

    const [firstTarball] = tarballs.keys();
    fs.appendFileSync(path.join(tarballsDir, firstTarball), 'tampered');
    assert.throws(
      () => verifySidecarArtifacts(releaseDir, descriptor),
      /sidecar tarball size mismatch/u,
    );
    restore();

    fs.writeFileSync(path.join(tarballsDir, 'unexpected.tgz'), 'unexpected');
    assert.throws(
      () => verifySidecarArtifacts(releaseDir, descriptor),
      /Sidecar tarball set does not match the accepted release identity/u,
    );
    restore();

    fs.rmSync(path.join(tarballsDir, firstTarball));
    assert.throws(
      () => verifySidecarArtifacts(releaseDir, descriptor),
      /sidecar tarball is missing or is not a regular file/u,
    );
    restore();

    assert.throws(
      () => verifySidecarArtifacts(releaseDir, null),
      /declares no sidecars but sidecars\.json is present/u,
    );

    const identityDrift = JSON.parse(manifestBytes);
    identityDrift.packages[0].version = '9.9.9';
    const identityDriftBytes = Buffer.from(
      `${JSON.stringify(identityDrift, null, 2)}\n`,
    );
    fs.writeFileSync(manifestPath, identityDriftBytes);
    assert.throws(
      () =>
        verifySidecarArtifacts(releaseDir, {
          ...descriptor,
          sha256: sha256(identityDriftBytes),
        }),
      /sidecar tarball contains/u,
    );
  } finally {
    fs.rmSync(releaseDir, { force: true, recursive: true });
  }
});

test('the CLI reads the staged lane from the release bundle and fails closed on drift', async () => {
  const { readStagedSidecars } = await importCli();
  const {
    collectSidecarPackages,
    stageSidecarPackage,
    writeSidecarStagingManifest,
  } = await import('../lib/prepare-bleedingdev-packages/sidecars.mjs');

  // A release-bundle shape: sidecars.json binds immutable sidecar tarballs;
  // raw staged package trees are not publication inputs.
  const releaseDir = makeTempDir();
  const sidecars = collectSidecarPackages(repoRoot);
  const stageDir = path.join(releaseDir, 'sidecars');
  fs.mkdirSync(stageDir, { recursive: true });
  const staged = sidecars.map(sidecar =>
    stageSidecarPackage(sidecar, stageDir, { repoRoot: releaseDir }),
  );
  writeSidecarStagingManifest(releaseDir, staged, {
    publishBefore: cohortAliasConsumer,
  });
  const accepted = await acceptedSidecarRelease(releaseDir);

  const read = readStagedSidecars(releaseDir, {
    verifyRelease: () => accepted,
  });
  assert.deepEqual(
    read.sidecars.map(item => item.name),
    read.manifest.publishOrder,
  );
  assert.ok(read.sidecars.every(item => Buffer.isBuffer(item.bytes)));

  const tampered = {
    ...accepted,
    sidecars: {
      ...accepted.sidecars,
      packages: accepted.sidecars.packages.map(item =>
        item.name === '@bleedingdev/ipx'
          ? {
              ...item,
              packageJson: { ...item.packageJson, version: '3.2.1' },
            }
          : item,
      ),
    },
  };
  assert.throws(
    () =>
      readStagedSidecars(releaseDir, {
        verifyRelease: () => tampered,
      }),
    /Accepted sidecar @bleedingdev\/ipx@3\.2\.0 contains @bleedingdev\/ipx@3\.2\.1/u,
  );

  assert.throws(
    () =>
      readStagedSidecars(releaseDir, {
        verifyRelease: () => ({ ...accepted, sidecars: null }),
      }),
    /Missing accepted sidecars\.json/u,
  );
});

// ---------------------------------------------------------------------------
// Post-publish propagation: only a registry that has not caught up is retried
// ---------------------------------------------------------------------------

const untaggedPackument = sidecar => ({
  ...packumentFor(sidecar),
  'dist-tags': {},
});

const stubReads = reads => {
  const queue = [...reads];
  return async () => (queue.length > 1 ? queue.shift() : queue[0]);
};

test('a missing dist-tag and an unindexed version are retried until they settle', async () => {
  const {
    awaitPublishedSidecar,
    classifySidecarPropagation,
    propagationPendingStates,
  } = await importCli();
  const sidecar = stagedIpx();
  const waits = [];

  // Exactly the sequence a fresh publish walks through: the packument is not
  // readable, then the version is readable but untagged, then both are there.
  const decision = await awaitPublishedSidecar(
    sidecar,
    { tag: 'latest' },
    {
      readPackument: stubReads([
        null,
        untaggedPackument(sidecar),
        packumentFor(sidecar),
      ]),
      wait: async ms => {
        waits.push(ms);
      },
    },
  );
  assert.equal(decision.action, 'reuse');
  assert.equal(decision.currentTag, '3.2.0');
  assert.equal(waits.length, 2, 'each pending read must wait once');

  // The typed states, asserted directly rather than through message text.
  assert.equal(
    classifySidecarPropagation(sidecar, null, { tag: 'latest' }).state,
    propagationPendingStates.packumentAbsent,
  );
  assert.equal(
    classifySidecarPropagation(sidecar, untaggedPackument(sidecar), {
      tag: 'latest',
    }).state,
    propagationPendingStates.tagAbsent,
  );
  assert.equal(
    classifySidecarPropagation(
      sidecar,
      { name: sidecar.name, 'dist-tags': { latest: '3.1.0' }, versions: {} },
      { tag: 'latest' },
    ).state,
    propagationPendingStates.versionAbsent,
  );
  // The dist-tag already names this exact version: it cannot be anyone else's.
  assert.equal(
    classifySidecarPropagation(
      sidecar,
      { name: sidecar.name, 'dist-tags': { latest: '3.2.0' }, versions: {} },
      { tag: 'latest' },
    ).state,
    propagationPendingStates.versionAbsentTagClaimed,
  );
  // Settled: both the version and the tag are readable, so the decision is
  // final and there is nothing left to wait for.
  assert.equal(
    classifySidecarPropagation(sidecar, packumentFor(sidecar), {
      tag: 'latest',
    }),
    null,
  );
});

test('a first-version packument absent on the initial read gets a bounded propagation chance', async () => {
  const { awaitInitialSidecarPackument, initialPackumentDelaysMs } =
    await importCli();
  const sidecar = stagedIpx();
  const waits = [];
  const result = await awaitInitialSidecarPackument(sidecar, {
    readPackument: stubReads([null, null, packumentFor(sidecar)]),
    wait: async ms => waits.push(ms),
  });

  assert.equal(
    result.versions[sidecar.version].dist.integrity,
    sidecar.integrity,
  );
  assert.deepEqual(waits, initialPackumentDelaysMs);
});

test('a rerun converges when an exact sidecar version is still indexing at the initial gate', async () => {
  const { publishSidecars } = await importCli();
  const {
    collectSidecarPackages,
    stageSidecarPackage,
    writeSidecarStagingManifest,
  } = await import('../lib/prepare-bleedingdev-packages/sidecars.mjs');
  const releaseDir = makeTempDir();
  const stageDir = path.join(releaseDir, 'sidecars');
  fs.mkdirSync(stageDir, { recursive: true });
  const staged = collectSidecarPackages(repoRoot).map(sidecar =>
    stageSidecarPackage(sidecar, stageDir, { repoRoot: releaseDir }),
  );
  writeSidecarStagingManifest(releaseDir, staged, {
    publishBefore: cohortAliasConsumer,
  });
  const accepted = await acceptedSidecarRelease(releaseDir);
  const stagedIpxPackage = accepted.sidecars.packages.find(
    sidecar => sidecar.name === '@bleedingdev/ipx',
  );
  const readSidecars = () => ({
    manifest: accepted.sidecars.manifest,
    release: accepted,
    sidecars: accepted.sidecars.packages,
  });

  let ipxReads = 0;
  const waits = [];
  const result = await publishSidecars(
    {
      checkStaging: false,
      dryRun: true,
      out: releaseDir,
      tag: 'latest',
    },
    {
      readSidecars,
      readPackument: async name => {
        if (name !== '@bleedingdev/ipx') {
          return { name, 'dist-tags': {}, versions: {} };
        }
        ipxReads += 1;
        return ipxReads === 1
          ? {
              name,
              'dist-tags': { latest: '3.2.0' },
              versions: {},
            }
          : {
              name,
              'dist-tags': { latest: stagedIpxPackage.version },
              versions: {
                [stagedIpxPackage.version]: {
                  ...stagedIpxPackage.packageJson,
                  dist: {
                    integrity: stagedIpxPackage.integrity,
                    shasum: stagedIpxPackage.shasum,
                  },
                },
              },
            };
      },
      wait: async ms => {
        waits.push(ms);
      },
    },
  );

  assert.deepEqual(result.reused, ['@bleedingdev/ipx@3.2.0']);
  assert.equal(result.published.length, 2);
  assert.equal(ipxReads, 2);
  assert.equal(
    waits.length,
    0,
    'the immediate confirmation read settled without consuming the retry window',
  );
});

test('a dist-tag on a different real version is terminal, never retried', async () => {
  const { awaitPublishedSidecar, classifySidecarPropagation } =
    await importCli();
  const sidecar = stagedIpx();
  const waits = [];
  const wait = async ms => {
    waits.push(ms);
  };

  // This is the regression: the message for this state names the missing tag,
  // and message-matching retried it. The tag points at a real, different
  // version - waiting cannot move it, so it must fail immediately.
  const elsewhere = packumentFor(sidecar, { tag: '3.3.0' });
  assert.equal(
    classifySidecarPropagation(sidecar, elsewhere, { tag: 'latest' }),
    null,
    'a tag pointing at another version is settled, not pending',
  );
  await assert.rejects(
    awaitPublishedSidecar(
      sidecar,
      { tag: 'latest' },
      { readPackument: stubReads([elsewhere]), wait },
    ),
    /dist-tag latest points at 3\.3\.0, expected the already-published 3\.2\.0/u,
  );
  assert.deepEqual(waits, [], 'a terminal state must not sleep');

  // Content drift hiding behind a missing dist-tag is still terminal: the
  // classifier proves the published bytes match before it reports "pending".
  const driftedUntagged = {
    ...packumentFor(sidecar, {
      overrides: { dependencies: { sharp: '^0.34.0' } },
    }),
    'dist-tags': {},
  };
  await assert.rejects(
    awaitPublishedSidecar(
      sidecar,
      { tag: 'latest' },
      { readPackument: stubReads([driftedUntagged]), wait },
    ),
    /already published with different content/u,
  );
  // A backwards latest over an unindexed version is terminal too.
  await assert.rejects(
    awaitPublishedSidecar(
      sidecar,
      { tag: 'latest' },
      {
        readPackument: stubReads([
          {
            name: sidecar.name,
            'dist-tags': { latest: '3.4.0' },
            versions: { '3.4.0': { name: sidecar.name, version: '3.4.0' } },
          },
        ]),
        wait,
      },
    ),
    /must be greater than the current latest 3\.4\.0/u,
  );
  assert.deepEqual(waits, [], 'no terminal state may sleep');
});

test('a registry that never settles exhausts the bounded propagation window', async () => {
  const { awaitPublishedSidecar, propagationDelaysMs } = await importCli();
  const sidecar = stagedIpx();
  const waits = [];

  await assert.rejects(
    awaitPublishedSidecar(
      sidecar,
      { tag: 'latest' },
      {
        readPackument: stubReads([untaggedPackument(sidecar)]),
        wait: async ms => {
          waits.push(ms);
        },
      },
    ),
    /did not become verifiable[\s\S]*dist-tag latest has not propagated/u,
  );
  assert.equal(waits.length, propagationDelaysMs.length);
});

test('the trusted-publishing lane refuses to bootstrap a package npm cannot create', async () => {
  const { publishSidecars } = await importCli();
  const {
    collectSidecarPackages,
    stageSidecarPackage,
    writeSidecarStagingManifest,
  } = await import('../lib/prepare-bleedingdev-packages/sidecars.mjs');

  const releaseDir = makeTempDir();
  const stageDir = path.join(releaseDir, 'sidecars');
  fs.mkdirSync(stageDir, { recursive: true });
  const staged = collectSidecarPackages(repoRoot).map(sidecar =>
    stageSidecarPackage(sidecar, stageDir, { repoRoot: releaseDir }),
  );
  writeSidecarStagingManifest(releaseDir, staged, {
    publishBefore: cohortAliasConsumer,
  });
  const accepted = await acceptedSidecarRelease(releaseDir);
  const readSidecars = () => ({
    manifest: accepted.sidecars.manifest,
    release: accepted,
    sidecars: accepted.sidecars.packages,
  });
  const unavailable = {
    readPackument: async () => null,
    readSidecars,
    wait: async () => {},
  };

  const options = {
    checkStaging: false,
    dryRun: false,
    out: releaseDir,
    tag: 'latest',
  };
  // npm trusted publishing publishes to an EXISTING package with a configured
  // trusted publisher; the OIDC exchange cannot create a package name. An
  // unattended lane must say so rather than fail deep inside npm.
  await assert.rejects(
    publishSidecars(options, unavailable),
    /does not exist on the registry after the bounded propagation wait[\s\S]*Bootstrap @bleedingdev\/[a-z-]+@[\d.]+ interactively once, with explicit authorization/u,
  );

  // Dry-run models the same trusted-publishing capability and must not claim a
  // package can be created when OIDC cannot bootstrap its name.
  await assert.rejects(
    publishSidecars({ ...options, dryRun: true }, unavailable),
    /fails closed in both dry-run and publication modes/u,
  );
});

// ---------------------------------------------------------------------------
// Root-runnable packed-consumer proof: guards only (the proof itself needs a
// local registry process and is never run from the test suite)
// ---------------------------------------------------------------------------

const importConsumerProof = () => import('../verify-sidecar-consumer.mjs');

// A stand-in for the real system temp root, so these assertions do not change
// meaning with TMPDIR.
const fakeTmpdir = '/var/folders/zz/proof-tmp/T';

test('the packed-consumer proof publishes to loopback registries only', async () => {
  const { assertLocalRegistry, parseArgs } = await importConsumerProof();

  assert.equal(
    assertLocalRegistry('http://127.0.0.1:4873').href,
    'http://127.0.0.1:4873/',
  );
  for (const publicRegistry of [
    'https://registry.npmjs.org/',
    'https://registry.npmjs.org',
    'https://registry.yarnpkg.com/',
    'https://npm.pkg.github.com/',
  ]) {
    assert.throws(
      () => assertLocalRegistry(publicRegistry),
      /Refusing to run the packed-consumer proof against the public registry/u,
      `${publicRegistry} must be refused unconditionally`,
    );
  }
  assert.throws(
    () => assertLocalRegistry('https://npm.example.com/'),
    /is not a loopback address/u,
  );
  assert.throws(
    () => assertLocalRegistry('file:///tmp/registry'),
    /must be http\(s\)/u,
  );

  // There is no escape hatch left: the override flag is gone, not merely
  // discouraged, so it cannot be pasted next to a real token.
  assert.throws(
    () =>
      parseArgs([
        '--registry',
        'https://npm.example.com/',
        '--allow-nonlocal-registry',
        '--scratch-dir',
        path.join(os.homedir(), '.cache/ultramodern-proof'),
      ]),
    /Unknown argument/u,
  );

  assert.throws(() => parseArgs([]), /Missing --registry/u);
  const parsed = parseArgs([
    '--registry',
    'http://localhost:4873',
    '--scratch-dir',
    path.join(os.homedir(), '.cache/ultramodern-proof'),
  ]);
  assert.equal(parsed.registry.href, 'http://localhost:4873/');
  assert.equal(parsed.keep, false);
});

test('the scratch root is caller-owned, outside the repo, and never a shared temp root', async () => {
  const { assertOwnedScratchRoot } = await importConsumerProof();
  const owned = value => assertOwnedScratchRoot(value, { tmpdir: fakeTmpdir });

  assert.throws(() => owned(undefined), /--scratch-dir is required/u);
  assert.throws(
    () => owned(path.join(repoRoot, '.cache/proof')),
    /must be outside the repository/u,
  );
  assert.equal(
    owned(path.join(os.homedir(), '.cache/ultramodern-proof')),
    path.join(os.homedir(), '.cache/ultramodern-proof'),
  );

  // Shared temp roots are never themselves a scratch root...
  for (const shared of ['/tmp', '/var/tmp', '/private/tmp', fakeTmpdir]) {
    assert.throws(
      () => owned(shared),
      /must not be the shared temp root/u,
      `${shared} must be refused as a scratch root`,
    );
  }
  // ...and the generic ones are out of bounds entirely.
  assert.throws(() => owned('/tmp/proof'), /must not live under \/tmp/u);
  assert.throws(
    () => owned(path.join(fakeTmpdir, 'proof')),
    /must not live under /u,
  );

  // A deep, explicitly named directory under /private/tmp IS allowed: that is
  // where a session hands this proof its scratch root. Shallow ones are not.
  assert.throws(
    () => owned('/private/tmp/proof'),
    /is too shallow under \/private\/tmp/u,
  );
  const sessionScratch =
    '/private/tmp/claude-501/-Users-example-repo/session-id/scratchpad';
  assert.equal(owned(sessionScratch), sessionScratch);
});

test('only the unique run directory is removable, and signals clean it up', async () => {
  const { assertRemovableWorkDir, createScratchCleanup } =
    await importConsumerProof();

  const scratchRoot = path.join(os.homedir(), '.cache/ultramodern-proof');
  const workDir = path.join(scratchRoot, 'sidecar-consumer-proof-1-abcd');
  assert.equal(assertRemovableWorkDir(workDir, scratchRoot), workDir);
  assert.throws(
    () => assertRemovableWorkDir(scratchRoot, scratchRoot),
    /Refusing to remove the caller-owned scratch root/u,
  );
  assert.throws(
    () =>
      assertRemovableWorkDir(path.join(os.homedir(), 'elsewhere'), scratchRoot),
    /is not inside the scratch root/u,
  );

  const fakeProcess = () => {
    const listeners = new Map();
    return {
      kills: [],
      kill(pid, signal) {
        this.kills.push({ pid, signal });
      },
      listeners,
      off: (signal, handler) => {
        if (listeners.get(signal) === handler) {
          listeners.delete(signal);
        }
      },
      on: (signal, handler) => listeners.set(signal, handler),
      pid: 4242,
    };
  };

  const processRef = fakeProcess();
  const removed = [];
  const cleanup = createScratchCleanup(workDir, {
    processRef,
    remove: dir => removed.push(dir),
    scratchRoot,
  });
  assert.deepEqual(cleanup.signals, ['SIGINT', 'SIGTERM']);
  assert.deepEqual([...processRef.listeners.keys()], ['SIGINT', 'SIGTERM']);

  // A signal removes the run directory once, unregisters, and re-raises so the
  // caller still observes a signal death.
  processRef.listeners.get('SIGINT')();
  assert.deepEqual(removed, [workDir]);
  assert.deepEqual(processRef.kills, [{ pid: 4242, signal: 'SIGINT' }]);
  assert.equal(processRef.listeners.size, 0);
  assert.equal(cleanup.finish(), false, 'cleanup must never remove twice');
  assert.deepEqual(removed, [workDir]);

  // --keep leaves the directory but still detaches the handlers.
  const keepProcess = fakeProcess();
  const keptRemovals = [];
  const kept = createScratchCleanup(workDir, {
    keep: true,
    processRef: keepProcess,
    remove: dir => keptRemovals.push(dir),
    scratchRoot,
  });
  assert.equal(kept.finish(), false);
  assert.deepEqual(keptRemovals, []);
  assert.equal(keepProcess.listeners.size, 0);
});

test('nothing is published while a public registry could still win', async () => {
  const { assertRegistryConfigValue, registryConfigKeys, writeScratchNpmrc } =
    await importConsumerProof();

  // Both the default registry AND the scoped registry are pinned: the scoped
  // one is what actually decides where an @bleedingdev/* package publishes.
  assert.deepEqual(registryConfigKeys, ['registry', '@bleedingdev:registry']);

  const dir = makeTempDir();
  const registry = new URL('http://127.0.0.1:4873/');
  const npmrcPath = writeScratchNpmrc(dir, registry, 'proof-token');
  const npmrc = fs.readFileSync(npmrcPath, 'utf8');
  assert.match(npmrc, /^registry=http:\/\/127\.0\.0\.1:4873\/$/mu);
  assert.match(npmrc, /^@bleedingdev:registry=http:\/\/127\.0\.0\.1:4873\/$/mu);
  assert.match(
    npmrc,
    /^\/\/127\.0\.0\.1:4873\/:_authToken=proof-token$/mu,
    'the scratch npmrc must carry auth for the local registry it pins',
  );
  assert.ok(!/registry\.npmjs\.org/u.test(npmrc));

  // The effective-config assertion is what makes the pin non-bypassable.
  assert.equal(
    assertRegistryConfigValue(
      'registry',
      '  http://127.0.0.1:4873  \n',
      registry.href,
    ),
    registry.href,
  );
  assert.throws(
    () =>
      assertRegistryConfigValue(
        '@bleedingdev:registry',
        'https://registry.npmjs.org/',
        registry.href,
      ),
    /resolves to https:\/\/registry\.npmjs\.org\/, not the approved local registry/u,
  );
  assert.throws(
    () =>
      assertRegistryConfigValue(
        '@bleedingdev:registry',
        'undefined',
        registry.href,
      ),
    /is undefined, not a registry URL/u,
  );
});

test('the three npm config roles get distinct files, so npm never double-loads one', async () => {
  const {
    extractNpmConfigValue,
    assertRegistryConfigValue,
    scratchNpmrcFileNames,
    writeScratchNpmrcSet,
  } = await importConsumerProof();

  const dir = makeTempDir();
  const registry = new URL('http://127.0.0.1:4873/');
  const written = writeScratchNpmrcSet(dir, registry, 'proof-token');
  const paths = [written.projectPath, written.userPath, written.globalPath];

  // The live failure: one file used for two roles makes npm emit
  // `double-loading config ... as "global", previously loaded as "user"` into
  // `npm config get` output, which corrupts the pre-publish registry check.
  assert.equal(
    new Set(paths).size,
    3,
    'project, user, and global config must be three distinct files',
  );
  // Only the project role may be named .npmrc; npm picks that name up from the
  // cwd on its own, so reusing it for another role reintroduces the collision.
  assert.equal(path.basename(written.projectPath), '.npmrc');
  assert.equal(
    [written.userPath, written.globalPath].some(
      file => path.basename(file) === scratchNpmrcFileNames.project,
    ),
    false,
  );

  // Identical pins in all three, so whichever role npm resolves a key from, the
  // answer is the approved local registry.
  const contents = paths.map(file => fs.readFileSync(file, 'utf8'));
  assert.equal(new Set(contents).size, 1, 'all three roles must pin the same');
  for (const content of contents) {
    assert.match(content, /^registry=http:\/\/127\.0\.0\.1:4873\/$/mu);
    assert.match(
      content,
      /^@bleedingdev:registry=http:\/\/127\.0\.0\.1:4873\/$/mu,
    );
  }

  // And if npm ever emits a diagnostic there anyway, it is dropped rather than
  // parsed - and anything ambiguous fails closed instead of passing.
  assert.equal(
    extractNpmConfigValue('http://127.0.0.1:4873/'),
    'http://127.0.0.1:4873/',
  );
  const doubleLoaded = [
    `npm warn double-loading config "${written.projectPath}" as "global", previously loaded as "user"`,
    'http://127.0.0.1:4873/',
  ].join('\n');
  assert.equal(
    extractNpmConfigValue(doubleLoaded),
    'http://127.0.0.1:4873/',
    'an npm diagnostic line must not be mistaken for the value',
  );
  assert.equal(
    assertRegistryConfigValue('registry', doubleLoaded, registry.href),
    registry.href,
  );
  // Two candidate values is ambiguity, and ambiguity must never publish.
  assert.equal(
    extractNpmConfigValue(
      'http://127.0.0.1:4873/\nhttps://registry.npmjs.org/',
    ),
    null,
  );
  assert.equal(extractNpmConfigValue(''), null);
  assert.throws(
    () =>
      assertRegistryConfigValue(
        'registry',
        'http://127.0.0.1:4873/\nhttps://registry.npmjs.org/',
        registry.href,
      ),
    /not a registry URL/u,
  );
});

test('a tarball that keeps a public publishConfig.registry is never published', async () => {
  const { assertPackedManifestHasNoRegistry, sanitizePublishManifest } =
    await importConsumerProof();

  const manifest = {
    name: '@bleedingdev/sidecar-publish-target-fixture',
    version: '1.0.0',
    publishConfig: {
      access: 'public',
      registry: 'https://registry.npmjs.org/',
    },
  };

  // Only the registry is removed; access - which npm needs for a scoped
  // package - survives, and so does everything else.
  const sanitized = sanitizePublishManifest(manifest, 'fixture');
  assert.deepEqual(sanitized.publishConfig, { access: 'public' });
  assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/');
  assert.throws(
    () =>
      sanitizePublishManifest(
        {
          ...manifest,
          publishConfig: { registry: manifest.publishConfig.registry },
        },
        'fixture',
      ),
    /must keep publishConfig\.access "public"/u,
  );

  // The real gate: pack both manifests and read the tarballs back, because npm
  // honours a packed publishConfig.registry over --registry.
  const dir = makeTempDir();
  const packOnce = (packageJson, name) => {
    const packageDir = path.join(dir, name);
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
    const stdout = String(
      execFileSync(
        'npm',
        [
          'pack',
          packageDir,
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          dir,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    );
    return path.join(dir, JSON.parse(stdout)[0].filename);
  };

  assert.throws(
    () =>
      assertPackedManifestHasNoRegistry(
        packOnce(manifest, 'unsafe'),
        'fixture',
      ),
    /still declares publishConfig\.registry https:\/\/registry\.npmjs\.org\/[\s\S]*Refusing to publish it/u,
  );
  const safeManifest = assertPackedManifestHasNoRegistry(
    packOnce(sanitized, 'safe'),
    'fixture',
  );
  assert.equal(safeManifest.publishConfig.access, 'public');
  assert.equal(Object.hasOwn(safeManifest.publishConfig, 'registry'), false);
});

test('the packed-consumer proof binds registry reuse to exact tarball bytes', async () => {
  const { packDirectory } = await importConsumerProof();
  const dir = makeTempDir();
  const packageDir = path.join(dir, 'package');
  const tarballsDir = path.join(dir, 'tarballs');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@bleedingdev/sidecar-digest-fixture',
        version: '1.0.0',
        publishConfig: { access: 'public' },
      },
      null,
      2,
    )}\n`,
  );

  const packed = packDirectory(
    packageDir,
    tarballsDir,
    'sidecar digest fixture',
    process.env,
  );

  assert.ok(Buffer.isBuffer(packed.bytes));
  assert.deepEqual(packed.bytes, fs.readFileSync(packed.tarball));
  assert.equal(
    packed.integrity,
    `sha512-${crypto
      .createHash('sha512')
      .update(packed.bytes)
      .digest('base64')}`,
  );
  assert.equal(
    packed.shasum,
    crypto.createHash('sha1').update(packed.bytes).digest('hex'),
  );
  assert.equal(packed.packageJson.name, '@bleedingdev/sidecar-digest-fixture');
});

test('the packed-consumer proof stages the cohort image with its aliases intact', async () => {
  const { cohortImageTargetName, proofImageVersion, stageCohortImagePackage } =
    await importConsumerProof();
  const { collectSidecarPackages, validateAliasConsistency } = await import(
    '../lib/prepare-bleedingdev-packages/sidecars.mjs'
  );
  const semver = requireFromPrebundle(
    path.join(repoRoot, 'packages/toolkit/utils/compiled/semver/index.js'),
  );

  // The cohort image is rebuilt from the working tree every run, so its proof
  // version is unique per run: an immutable local-registry version can never be
  // republished with different bytes. The SIDECAR versions stay exact.
  const first = proofImageVersion();
  const second = proofImageVersion();
  assert.notEqual(first, second);
  assert.ok(semver.valid(first), `${first} must be valid semver`);
  assert.ok(
    semver.lt(first, '0.0.0'),
    'the proof version must be a prerelease',
  );
  assert.match(first, /^0\.0\.0-sidecar-consumer-proof\./u);

  const stageDir = path.join(makeTempDir(), 'image');
  const { packageJson, version } = stageCohortImagePackage(stageDir, {
    version: first,
  });

  assert.equal(packageJson.name, cohortImageTargetName);
  assert.equal(packageJson.version, first);
  assert.equal(version, first);
  assert.equal(packageJson.publishConfig.access, 'public');
  assert.equal(
    Object.hasOwn(packageJson.publishConfig, 'registry'),
    false,
    'the staged cohort image must carry no publish target',
  );
  assert.equal(packageJson.devDependencies, undefined);
  assert.equal(packageJson.scripts, undefined);
  // The npm: alias literals are what this whole lane exists to make
  // resolvable; the proof must publish them unchanged, pinned at the exact
  // stable sidecar versions even though the image version floats per run.
  assert.match(
    packageJson.dependencies['@rsbuild-image/core'],
    /^npm:@bleedingdev\/rsbuild-image-core@\d+\.\d+\.\d+$/u,
  );
  assert.match(
    packageJson.dependencies.ipx,
    /^npm:@bleedingdev\/ipx@\d+\.\d+\.\d+$/u,
  );
  assert.doesNotThrow(() =>
    validateAliasConsistency(
      [{ name: cohortImageTargetName, packageJson }],
      collectSidecarPackages(repoRoot),
    ),
  );
  // Staged out of tree: the repository copy keeps its own identity.
  const sourceManifest = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'packages/runtime/plugin-image/package.json'),
      'utf8',
    ),
  );
  assert.equal(sourceManifest.name, '@modern-js/image');
});

test('the consumer proof resolves packages by walking up from a public entry', async () => {
  const { resolvePackageFromEntry } = await importConsumerProof();
  const io = { fs, path };

  // `<pkg>/package.json` is blocked by an exports map without that subpath -
  // the defect this walk exists to avoid - so the walk starts at a real entry.
  const root = makeTempDir();
  const packageDir = path.join(root, 'node_modules', '@bleedingdev', 'ipx');
  const distDir = path.join(packageDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: '@bleedingdev/ipx', version: '3.2.0' }),
  );
  // A nested, NAMELESS package.json marker must not stop the walk.
  fs.writeFileSync(
    path.join(distDir, 'package.json'),
    JSON.stringify({ type: 'commonjs' }),
  );
  const entry = path.join(distDir, 'index.cjs');
  fs.writeFileSync(entry, '');

  const resolved = resolvePackageFromEntry(entry, '@bleedingdev/ipx', io);
  assert.equal(resolved.dir, packageDir);
  assert.equal(resolved.manifest.version, '3.2.0');

  // The alias must land on the FORK; the upstream name is a failure.
  assert.throws(
    () => resolvePackageFromEntry(entry, 'ipx', io),
    /resolved into package @bleedingdev\/ipx, expected ipx/u,
  );
  // A walk that escapes the package without finding an owner fails loudly.
  const orphan = path.join(root, 'node_modules', 'orphan.js');
  fs.writeFileSync(orphan, '');
  assert.throws(
    () => resolvePackageFromEntry(orphan, 'orphan', io),
    /Could not find the package\.json owning/u,
  );
});

test('the generated consumer proof never resolves a package.json subpath', async () => {
  const { buildConsumerProofSource } = await importConsumerProof();
  const source = buildConsumerProofSource({
    coreName: '@bleedingdev/rsbuild-image-core',
    imageName: '@bleedingdev/modern-js-image',
    imageSizeName: '@bleedingdev/image-size',
    imageVersion: '0.0.0-sidecar-consumer-proof.1.rabcdef01',
    ipxName: '@bleedingdev/ipx',
    sharpVersionPattern: '^0\\.35\\.',
  });

  // The root defect: exports maps block `require.resolve('<pkg>/package.json')`
  // for the image package and both forks.
  assert.ok(
    !/\.resolve\(\s*['"][^'"]*\/package\.json['"]/u.test(source),
    'the proof must not resolve any <package>/package.json subpath',
  );
  assert.ok(source.includes('function resolvePackageFromEntry'));
  assert.ok(source.includes('async function consumerProofMain'));
  // The config is injected as a literal, so the proof asserts the version it
  // actually published rather than a placeholder.
  assert.ok(
    source.includes('"imageName": "@bleedingdev/modern-js-image"'),
    'the proof config must be embedded as a JSON literal',
  );
  assert.ok(
    source.includes(
      '"imageVersion": "0.0.0-sidecar-consumer-proof.1.rabcdef01"',
    ),
  );
  assert.ok(!source.includes('[object Object]'));

  // sharp is asserted on the 0.35 LINE, not an exact patch.
  assert.ok(source.includes('"sharpVersionPattern": "^0\\\\.35\\\\."'));
  assert.ok(!/0\.35\.3/u.test(source));

  // Both module systems, for both of the packages whose exports maps matter.
  for (const marker of [
    "imageRequire('ipx')",
    "imageRequire('@rsbuild-image/core/shared')",
    "export * as ipx from 'ipx';",
    "export * as coreShared from '@rsbuild-image/core/shared';",
  ]) {
    assert.ok(source.includes(marker), `proof source must contain ${marker}`);
  }
  // Transitive aliases come off the image entry; image-size off the core entry.
  assert.ok(source.includes('const imageRequire = createRequire(imageEntry)'));
  assert.ok(source.includes('const coreRequire = createRequire(coreEntry)'));

  // The generated file must at least parse as the CommonJS script it is.
  const scriptPath = path.join(makeTempDir(), 'sidecar-consumer-proof.cjs');
  fs.writeFileSync(scriptPath, source);
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, ['--check', scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
});
