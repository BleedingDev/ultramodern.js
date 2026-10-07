// Consumer: independent sidecar artifact and qualification acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const load = () => import('../sidecar-bundle.mjs');
const artifacts = () =>
  import('../lib/prepare-bleedingdev-packages/release-artifacts.mjs');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = await load();
  const { canonicalJson, resolveSourceIdentity, resolveToolVersions } =
    await artifacts();
  const { writeSidecarStagingManifest } = await import(
    '../lib/prepare-bleedingdev-packages/sidecars.mjs'
  );
  const source = resolveSourceIdentity();
  const tools = resolveToolVersions();
  // These are synthetic unit-test invocation IDs, never uploaded as production receipts.
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: source.repository,
    GITHUB_SHA: source.commit,
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '1',
  };
  const output = path.join(root, 'bundle');
  fs.mkdirSync(output);
  const inputs = bundle.readSidecarBundleInputs();
  const staged = inputs.map(input => {
    const stagedDir = path.join(root, input.id);
    fs.mkdirSync(stagedDir);
    fs.writeFileSync(
      path.join(stagedDir, 'index.js'),
      'module.exports = {};\n',
    );
    const packageJson = {
      name: input.name,
      version: input.version,
      main: 'index.js',
      license: 'MIT',
      publishConfig: {
        access: 'public',
        registry: 'https://registry.npmjs.org/',
      },
    };
    fs.writeFileSync(
      path.join(stagedDir, 'package.json'),
      `${JSON.stringify(packageJson)}\n`,
    );
    return {
      name: input.name,
      version: input.version,
      root: `packages/sidecar/${input.id}`,
      stagedDir,
      packageJson,
    };
  });
  const { descriptor } = writeSidecarStagingManifest(output, staged, {
    publishBefore: bundle.sidecarPublishBefore,
  });
  const accepted = bundle.writeSidecarBundle(output, {
    descriptor,
    source,
    tools,
    env,
  });
  const options = { source, tools, env };
  const receiptPath = path.join(root, 'qualification.json');
  const probes = Object.fromEntries(
    bundle.sidecarQualificationProbeKeys.map(key => [key, true]),
  );
  bundle.writeSidecarQualification(output, probes, { env, receiptPath });
  const rewrite = (file, transform) => {
    const before = fs.readFileSync(file);
    const next = transform(JSON.parse(before));
    fs.writeFileSync(file, `${canonicalJson(next, 2)}\n`);
    return () => fs.writeFileSync(file, before);
  };
  return { ...bundle, output, accepted, options, receiptPath, probes, rewrite };
}

test('independent bundle accepts only its unchanged v2 artifact and exact same-run qualification', async t => {
  const f = await fixture(t);
  assert.equal(f.accepted.sidecars.packages.length, 9);
  assert.equal(f.accepted.sidecars.manifest.schemaVersion, 2);
  assert.equal(
    f.accepted.sidecars.manifest.publishBefore,
    '@bleedingdev/modern-js-utils',
  );
  assert.equal(
    f.verifySidecarQualification(f.output, f.receiptPath, f.options)
      .bundleSha256,
    f.accepted.bundleSha256,
  );
  assert.throws(
    () =>
      f.verifySidecarBundle(f.output, {
        ...f.options,
        env: { ...f.options.env, GITHUB_RUN_ATTEMPT: '2' },
      }),
    /run and attempt/,
  );
  assert.throws(
    () =>
      f.verifySidecarBundle(f.output, {
        ...f.options,
        env: { ...f.options.env, GITHUB_RUN_ID: '98765' },
      }),
    /run and attempt/,
  );
  assert.throws(
    () =>
      f.verifySidecarBundle(f.output, {
        ...f.options,
        env: { ...f.options.env, GITHUB_SHA: 'f'.repeat(40) },
      }),
    /workflow source/,
  );
  assert.throws(
    () =>
      f.writeSidecarQualification(f.output, f.probes, {
        env: {},
        receiptPath: path.join(f.output, 'bad.json'),
      }),
    /GitHub workflow/,
  );
});

test('bundle rejects schema widening, checkout/tool/input drift, extra files and symlinks', async t => {
  const f = await fixture(t);
  const file = path.join(f.output, f.sidecarBundleFile);
  for (const [transform, message] of [
    [
      value => ({ ...value, cohortVersion: '3.8.2-ultramodern.29' }),
      /unknown or missing/,
    ],
    [value => ({ ...value, mode: 'cohort' }), /schema or mode/],
    [
      value => ({
        ...value,
        sidecars: { ...value.sidecars, manifestPath: '../sidecars.json' },
      }),
      /Unsafe/,
    ],
    [
      value => ({ ...value, tools: { ...value.tools, npm: '99.0.0' } }),
      /toolchain/,
    ],
    [value => ({ ...value, inputs: value.inputs.slice(1) }), /recipe or patch/],
    [
      value => ({
        ...value,
        source: { ...value.source, commit: 'f'.repeat(40) },
      }),
      /workflow source/,
    ],
  ]) {
    const restore = f.rewrite(file, transform);
    assert.throws(() => f.verifySidecarBundle(f.output, f.options), message);
    restore();
  }
  const extra = path.join(f.output, 'manifest.json');
  fs.writeFileSync(extra, '{}');
  assert.throws(() => f.verifySidecarBundle(f.output, f.options), /file set/);
  fs.rmSync(extra);
  const tarball = path.join(
    f.output,
    f.accepted.sidecars.manifest.packages[0].tarballPath,
  );
  const bytes = fs.readFileSync(tarball);
  fs.writeFileSync(tarball, Buffer.concat([bytes, Buffer.from('drift')]));
  assert.throws(
    () => f.verifySidecarBundle(f.output, f.options),
    /size mismatch/,
  );
  fs.writeFileSync(tarball, bytes);
  const renamed = `${tarball}.original`;
  fs.renameSync(tarball, renamed);
  fs.symlinkSync(renamed, tarball);
  assert.throws(
    () => f.verifySidecarBundle(f.output, f.options),
    /regular file/,
  );
});

test('qualification cannot substitute probes, producer, source or accepted packed digest', async t => {
  const f = await fixture(t);
  for (const transform of [
    value => ({
      ...value,
      probes: { ...value.probes, 'packed-install': false },
    }),
    value => ({ ...value, probes: { ...value.probes, extra: true } }),
    value => ({ ...value, producer: { ...value.producer, runAttempt: '2' } }),
    value => ({ ...value, bundleSha256: 'f'.repeat(64) }),
    value => ({
      ...value,
      source: { ...value.source, commit: 'f'.repeat(40) },
    }),
    value => ({
      ...value,
      sidecars: { ...value.sidecars, sha256: 'f'.repeat(64) },
    }),
  ]) {
    const restore = f.rewrite(f.receiptPath, transform);
    assert.throws(
      () => f.verifySidecarQualification(f.output, f.receiptPath, f.options),
      /does not bind/,
    );
    restore();
  }
  assert.throws(
    () =>
      f.writeSidecarQualification(
        f.output,
        { ...f.probes, 'packed-install': false },
        { env: f.options.env, receiptPath: path.join(f.output, 'bad.json') },
      ),
    /required probe/,
  );
});

test('independent CLI arguments fail closed on cross-mode inputs and unsafe output roots', async () => {
  const { parseArgs } = await import('../publish-sidecars.mjs');
  const { resolveSidecarOutput } = await load();
  assert.throws(() => parseArgs(['--mode', 'unknown']), /cohort or sidecars/);
  assert.throws(() => parseArgs(['--mode', 'sidecars']), /--qualification/);
  assert.throws(
    () => parseArgs(['--qualification', 'x']),
    /independent-sidecar-only/,
  );
  assert.throws(
    () => parseArgs(['--mode', 'sidecars', '--check-registry']),
    /cohort-only/,
  );
  assert.throws(
    () => resolveSidecarOutput('/tmp/sidecar-bundle'),
    /must be inside/,
  );
});
