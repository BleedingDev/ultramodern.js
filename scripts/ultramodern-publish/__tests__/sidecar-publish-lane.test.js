// Consumer: the publish-sidecars CLI and its registry decision helpers.
//
// Each case here guards an unrecoverable registry outcome: npm versions are
// immutable, so publishing different bytes over an existing sidecar version,
// or moving the `latest` alias the cohort resolves through, cannot be undone.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../../..');
const cohortAliasConsumer = '@bleedingdev/modern-js-image';
const imageSidecarRoots = [
  'packages/sidecar/ipx',
  'packages/sidecar/rsbuild-image-core',
];

const importPublication = () =>
  import('../lib/prepare-bleedingdev-packages/sidecar-publication.mjs');
const importCli = () => import('../publish-sidecars.mjs');
const importSidecars = () =>
  import('../lib/prepare-bleedingdev-packages/sidecars.mjs');

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-sidecar-lane-'));

// Stage the repository sidecars into a release-bundle shape the CLI reads.
const stageRelease = async () => {
  const {
    collectSidecarPackages,
    stageSidecarPackage,
    writeSidecarStagingManifest,
  } = await importSidecars();
  const releaseDir = makeTempDir();
  const stageDir = path.join(releaseDir, 'sidecars');
  fs.mkdirSync(stageDir, { recursive: true });
  const staged = await Promise.all(
    collectSidecarPackages(repoRoot, { roots: imageSidecarRoots }).map(
      sidecar =>
        stageSidecarPackage(sidecar, stageDir, { repoRoot: releaseDir }),
    ),
  );
  const { descriptor } = writeSidecarStagingManifest(releaseDir, staged, {
    publishBefore: cohortAliasConsumer,
  });
  return { descriptor, releaseDir };
};

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
    /already published from different tarball bytes/u,
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

  // The dist-tag must land on the version the cohort aliases.
  assert.throws(
    () =>
      sidecarRegistryDecision(sidecar, packumentFor(sidecar, { tag: '3.3.0' })),
    /dist-tag latest points at 3\.3\.0, expected the already-published 3\.2\.0/u,
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
});

test('immutable sidecar verification rejects manifest and archive tampering', async () => {
  const { verifySidecarArtifacts } = await import(
    '../lib/prepare-bleedingdev-packages/release-artifacts.mjs'
  );
  const { descriptor, releaseDir } = await stageRelease();
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

  try {
    assert.doesNotThrow(() => verifySidecarArtifacts(releaseDir, descriptor));

    fs.appendFileSync(manifestPath, ' ');
    assert.throws(
      () => verifySidecarArtifacts(releaseDir, descriptor),
      /Sidecar manifest SHA-256 mismatch/u,
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

    // A re-signed manifest still cannot claim bytes the tarball does not hold.
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

test('the CLI reads the staged lane from the release bundle and fails closed on drift', async t => {
  const { readStagedSidecars } = await importCli();
  const { releaseDir } = await stageRelease();
  t.after(() => fs.rmSync(releaseDir, { recursive: true, force: true }));
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
              packageJson: { ...item.packageJson, version: '999.0.0' },
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
    /Accepted sidecar @bleedingdev\/ipx@[\d.]+ contains @bleedingdev\/ipx@999\.0\.0/u,
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
  assert.ok(waits.length > 0, 'each pending read must wait');

  assert.equal(
    classifySidecarPropagation(sidecar, untaggedPackument(sidecar), {
      tag: 'latest',
    }).state,
    propagationPendingStates.tagAbsent,
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
  assert.deepEqual(waits, [], 'no terminal state may sleep');
});

test('the trusted-publishing lane refuses to bootstrap a package npm cannot create', async t => {
  const { publishSidecars } = await importCli();
  const { releaseDir } = await stageRelease();
  t.after(() => fs.rmSync(releaseDir, { recursive: true, force: true }));
  const accepted = await acceptedSidecarRelease(releaseDir);
  const unavailable = {
    readPackument: async () => null,
    readSidecars: () => ({
      manifest: accepted.sidecars.manifest,
      release: accepted,
      sidecars: accepted.sidecars.packages,
    }),
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

test('the packed-consumer proof publishes to loopback registries only', async () => {
  const { assertLocalRegistry } = await import(
    '../verify-sidecar-consumer.mjs'
  );

  assert.equal(
    assertLocalRegistry('http://127.0.0.1:4873').href,
    'http://127.0.0.1:4873/',
  );
  assert.throws(
    () => assertLocalRegistry('https://registry.npmjs.org/'),
    /Refusing to run the packed-consumer proof against the public registry/u,
  );
  assert.throws(
    () => assertLocalRegistry('https://npm.example.com/'),
    /is not a loopback address/u,
  );
});
