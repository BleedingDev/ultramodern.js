// Consumer: clean installed SDK qualification; these tests cover probe isolation.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function probeSource(format) {
  const { packedMfSdkProbeMain } = await import('../packed-mf-sdk-probe.mjs');
  return `await (${packedMfSdkProbeMain.toString()})(${JSON.stringify(format)});\n`;
}

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'packed-mf-sdk-probe-test-',
      ),
    ),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'consumer');
  fs.mkdirSync(workspace);
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    '{"private":true,"type":"module"}\n',
  );
  return { root, workspace };
}

function packageFixture(
  directory,
  importEntry = './index.js',
  type = 'module',
) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({
      name: '@bleedingdev/mf-sdk',
      type,
      exports: { '.': { import: importEntry, require: './index.cjs' } },
    }),
  );
  for (const file of ['index.cjs', 'index.js'])
    fs.writeFileSync(
      path.join(directory, file),
      'throw new Error("The SDK API must not load before isolation checks");\n',
    );
}

function runProbe(workspace, source) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return spawnSync(
    process.execPath,
    ['--experimental-vm-modules', '--input-type=module', '--eval', source],
    { cwd: workspace, env, encoding: 'utf8', timeout: 10_000 },
  );
}

test('the exported function serializes into a standalone module', async t => {
  const { workspace } = fixture(t);
  const source = await probeSource();
  const checked = spawnSync(
    process.execPath,
    ['--input-type=module', '--check'],
    { cwd: workspace, input: source, encoding: 'utf8', timeout: 5_000 },
  );
  assert.equal(checked.status, 0, checked.stderr);
  const result = runProbe(workspace, source);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Cannot find module '@bleedingdev\/mf-sdk'/u);
  assert.doesNotMatch(result.stderr, /packedMfSdkProbeMain is not defined/u);
});

test('unknown export conditions fail before package loading', async t => {
  const { workspace } = fixture(t);
  const result = runProbe(workspace, await probeSource('source'));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Unknown SDK export condition/u);
  assert.doesNotMatch(result.stderr, /Cannot find module/u);
});

test('an import condition cannot qualify the CommonJS entry', async t => {
  const { workspace } = fixture(t);
  packageFixture(
    path.join(workspace, 'node_modules/@bleedingdev/mf-sdk'),
    './index.cjs',
  );
  const result = runProbe(workspace, await probeSource('ESM'));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /SDK import condition resolved to CJS/u);
  assert.doesNotMatch(result.stderr, /The SDK API must not load/u);
});

test('a different CommonJS .js file cannot qualify as native ESM', async t => {
  const { workspace } = fixture(t);
  packageFixture(
    path.join(workspace, 'node_modules/@bleedingdev/mf-sdk'),
    './index.js',
    'commonjs',
  );
  const result = runProbe(workspace, await probeSource('ESM'));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /SDK import condition is not native ESM/u);
  assert.doesNotMatch(result.stderr, /The SDK API must not load/u);
});

test('a linked external SDK cannot satisfy clean installed qualification', async t => {
  const { root, workspace } = fixture(t);
  const external = path.join(root, 'external-sdk');
  packageFixture(external);
  fs.mkdirSync(path.join(workspace, 'node_modules/@bleedingdev'), {
    recursive: true,
  });
  fs.symlinkSync(
    external,
    path.join(workspace, 'node_modules/@bleedingdev/mf-sdk'),
  );
  for (const format of ['CJS', 'ESM']) {
    const result = runProbe(workspace, await probeSource(format));
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /SDK export escaped the clean installed workspace/u,
    );
    assert.doesNotMatch(result.stderr, /The SDK API must not load/u);
  }
});
