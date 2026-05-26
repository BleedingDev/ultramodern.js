const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readJsonFile,
  validateEnvironmentOverlays,
  validateRevocationPrecedence,
  validateSourceConstraints,
  validateTopologyManifest,
  validateWithZephyrPlacement,
  validateZephyrProfile,
} = require('../validate-zephyr-profile');

const fixturesDir = path.join(__dirname, '..', '__fixtures__');
const validDir = path.join(fixturesDir, 'valid');
const invalidDir = path.join(fixturesDir, 'invalid');

const readFixture = relativePath =>
  fs.readFileSync(path.join(fixturesDir, relativePath), 'utf8');

const clone = value => JSON.parse(JSON.stringify(value));

test('validateWithZephyrPlacement accepts the Zephyr Rspack bridge shape', () => {
  const violations = validateWithZephyrPlacement({
    configPath: 'modern.config.js',
    content: readFixture('valid/modern.config.js'),
  });

  assert.deepEqual(violations, []);
});

test('validateWithZephyrPlacement rejects Zephyr config wrapper shape', () => {
  const violations = validateWithZephyrPlacement({
    configPath: 'modern.config.js',
    content: readFixture('invalid/nested.config.js'),
  });

  assert.equal(
    violations.some(
      violation =>
        violation.rule === 'with-zephyr-placement' &&
        /plugin|wrapper|nested/.test(violation.message),
    ),
    true,
  );
});

test('validateWithZephyrPlacement rejects inactive Modern.js Zephyr packages', () => {
  const violations = validateWithZephyrPlacement({
    configPath: 'modern.config.js',
    content: `
      const { appTools, defineConfig } = require('@modern-js/app-tools');
      const { withZephyr } = require('zephyr-modernjs-plugin');

      const zephyrRspackPlugin = () => ({
        setup(api) {
          api.modifyRspackConfig(config => withZephyr()(config));
        },
      });
      module.exports = defineConfig({
        plugins: [appTools(), zephyrRspackPlugin()],
        output: { distPath: { html: './' } },
        html: { outputStructure: 'flat' },
        source: { mainEntryName: 'index' },
      });
    `,
  });

  assert.equal(
    violations.some(
      violation =>
        violation.rule === 'with-zephyr-package' &&
        /zephyr-rspack-plugin|wrapper/.test(violation.message),
    ),
    true,
  );
});

test('validateWithZephyrPlacement rejects withZephyr outside plugins array', () => {
  const violations = validateWithZephyrPlacement({
    configPath: 'modern.config.js',
    content: `
      const { appTools, defineConfig } = require('@modern-js/app-tools');
      const { withZephyr } = require('zephyr-rspack-plugin');

      const zephyr = withZephyr();
      module.exports = defineConfig({
        plugins: [appTools()],
        output: { distPath: { html: './' } },
        html: { outputStructure: 'flat' },
        source: { mainEntryName: 'index' },
      });
    `,
  });

  assert.equal(
    violations.some(violation => violation.rule === 'with-zephyr-placement'),
    true,
  );
});

test('validateSourceConstraints rejects hardcoded URLs and boot hacks', () => {
  const report = validateSourceConstraints({
    sourceRoot: path.join(invalidDir, 'src'),
  });

  assert.equal(
    report.violations.some(item => item.rule === 'hardcoded-url'),
    true,
  );
  assert.equal(
    report.violations.some(item => item.hack === 'window_remote_overwrite'),
    true,
  );
  assert.equal(
    report.violations.some(item => item.hack === 'document_write_remote_entry'),
    true,
  );
  assert.equal(
    report.violations.some(
      item => item.hack === 'runtime_public_path_mutation',
    ),
    true,
  );
});

test('validateSourceConstraints accepts topology reference based source', () => {
  const report = validateSourceConstraints({
    sourceRoot: path.join(validDir, 'src'),
  });

  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.scannedFiles, ['bootstrap.js']);
});

test('validateTopologyManifest accepts valid Zephyr topology fixture', () => {
  const topology = readJsonFile(path.join(validDir, 'topology.json'));
  const report = validateTopologyManifest(topology);

  assert.equal(report.passed, true);
  assert.deepEqual(report.violations, []);
});

test('validateTopologyManifest rejects disabled LKG and bad dynamic URL source', () => {
  const topology = clone(readJsonFile(path.join(validDir, 'topology.json')));
  topology.profile.constraints.runtime.dynamicRemoteUrlSource =
    'service-response';
  topology.policies.lkg.enabled = false;
  topology.policies.lkg.fallbackOrder = ['current', 'lkg'];

  const report = validateTopologyManifest(topology);

  assert.equal(report.passed, false);
  assert.equal(
    report.violations.some(item => item.rule === 'dynamic-remote-url-source'),
    true,
  );
  assert.equal(
    report.violations.some(item => item.rule === 'lkg-policy'),
    true,
  );
});

test('validateEnvironmentOverlays rejects missing trust metadata in overrides', () => {
  const topology = clone(readJsonFile(path.join(validDir, 'topology.json')));
  delete topology.environments.preview.remoteOverrides.catalog.integrity;
  delete topology.environments.preview.remoteOverrides.catalog.attestation;
  delete topology.environments.preview.serviceOverrides['inventory-api'].digest;

  const violations = validateEnvironmentOverlays(topology);

  assert.equal(violations.length >= 3, true);
  assert.equal(
    violations.every(item => item.rule === 'environment-overlay'),
    true,
  );
});

test('validateRevocationPrecedence rejects selectable revoked artifact digest', () => {
  const topology = clone(readJsonFile(path.join(validDir, 'topology.json')));
  topology.policies.revocation.revokedArtifacts.push({
    id: 'catalog:manifest-compromised',
    digest: topology.topology.remotes[0].manifest.digest,
    reason: 'compromised',
    revokedAt: '2026-04-29T00:00:00.000Z',
  });

  const violations = validateRevocationPrecedence(topology);

  assert.equal(
    violations.some(item => /Revoked digest/.test(item.message)),
    true,
  );
});

test('validateZephyrProfile combines config, source, and topology checks', () => {
  const report = validateZephyrProfile({
    configPath: path.join(validDir, 'modern.config.js'),
    sourceRoot: path.join(validDir, 'src'),
    topologyPath: path.join(validDir, 'topology.json'),
  });

  assert.equal(report.passed, true);
  assert.deepEqual(report.violations, []);
});

test('validateZephyrProfile reports failures without requiring Zephyr runtime', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-profile-'));
  try {
    const topology = clone(readJsonFile(path.join(validDir, 'topology.json')));
    topology.policies.killSwitch.hooks[0].fallback.telemetryRequired = false;
    const topologyPath = path.join(tempDir, 'topology.json');
    fs.writeFileSync(topologyPath, `${JSON.stringify(topology, null, 2)}\n`);

    const report = validateZephyrProfile({
      configPath: path.join(invalidDir, 'nested.config.js'),
      sourceRoot: path.join(invalidDir, 'src'),
      topologyPath,
    });

    assert.equal(report.passed, false);
    assert.equal(
      report.violations.some(item => item.rule === 'with-zephyr-placement'),
      true,
    );
    assert.equal(
      report.violations.some(item => item.rule === 'hardcoded-url'),
      true,
    );
    assert.equal(
      report.violations.some(item => item.rule === 'kill-switch-policy'),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
