const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createEvidenceBundle,
  redact,
  writeEvidenceBundle,
} = require('../run-zephyr-live-evidence');

const generatedAt = '2026-05-26T00:00:00.000Z';

function completeConfig() {
  const remoteTarget = (domain, version) => ({
    appUid: `app_uid_remote_${domain}_${version}`,
    selector: {
      kind: version === 'v1' ? 'version' : 'tag',
      value: version === 'v1' ? '@1.2.3' : '@latest',
    },
    manifestUrl: `https://${domain}-${version}.example.test/mf-manifest.json`,
    runtimeUrl: `https://${domain}-${version}.example.test/`,
    apiUrl: `https://${domain}-${version}.example.test/${domain}-api/effect/${domain}/readiness`,
  });

  return {
    workspaceDir: '/tmp/generated-workspace',
    zephyr: { environment: 'staging' },
    credentials: {
      userEmail: 'builder@example.com',
      serverToken: 'server-token-value',
    },
    targets: {
      exploreV1: remoteTarget('explore', 'v1'),
      exploreV2: remoteTarget('explore', 'v2'),
      decideV1: remoteTarget('decide', 'v1'),
      decideV2: remoteTarget('decide', 'v2'),
      checkoutV1: remoteTarget('checkout', 'v1'),
      checkoutV2: remoteTarget('checkout', 'v2'),
      shell: {
        appUid: 'app_uid_shell',
        selector: { kind: 'environment', value: 'staging' },
        manifestUrl: 'https://shell.example.test/mf-manifest.json',
        runtimeUrl: 'https://shell.example.test/',
      },
    },
  };
}

test('live mode reports missing credentials and config as blocked', async () => {
  const bundle = await createEvidenceBundle({
    mode: 'live',
    env: {},
    config: {},
    generatedAt,
  });

  assert.equal(bundle.status, 'blocked');
  assert.equal(
    bundle.requirements.some(
      item => item.id === 'zephyr-token' && item.status === 'blocked',
    ),
    true,
  );
  assert.equal(
    bundle.requirements.some(
      item =>
        item.id === 'zephyr-environment-selector' && item.status === 'blocked',
    ),
    true,
  );
  assert.equal(
    bundle.assertions.every(assertion => assertion.status === 'skipped'),
    true,
  );
  assert.equal(
    bundle.targets.every(target => Object.hasOwn(target, 'manifestUrl')),
    true,
  );
  assert.equal(bundle.targets[0].manifestUrl, null);
});

test('dry-run mode marks missing live inputs as skipped instead of blocked', async () => {
  const bundle = await createEvidenceBundle({
    mode: 'dry-run',
    env: {},
    config: {},
    generatedAt,
  });

  assert.equal(bundle.status, 'dry-run');
  assert.equal(
    bundle.requirements.some(
      item => item.id === 'zephyr-token' && item.status === 'skipped',
    ),
    true,
  );
});

test('redaction removes secrets and credential identity values', async () => {
  const redacted = redact({
    ZE_SERVER_TOKEN: 'super-secret-token',
    ZE_USER_EMAIL: 'builder@example.com',
    nested: {
      secretToken: 'another-secret',
      harmless: 'visible-value',
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.equal(serialized.includes('super-secret-token'), false);
  assert.equal(serialized.includes('builder@example.com'), false);
  assert.equal(serialized.includes('another-secret'), false);
  assert.equal(serialized.includes('visible-value'), true);
  assert.equal(redacted.ZE_SERVER_TOKEN, '[REDACTED]');
});

test('happy dry-run writes a machine-readable evidence bundle', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-evidence-'));
  const outputPath = path.join(tempDir, 'evidence.json');
  try {
    const bundle = await createEvidenceBundle({
      mode: 'dry-run',
      env: {},
      config: completeConfig(),
      generatedAt,
      outputPath,
    });
    const writtenPath = writeEvidenceBundle(bundle, outputPath);
    const writtenBundle = JSON.parse(fs.readFileSync(writtenPath, 'utf8'));
    const allCommands = writtenBundle.commandPlan.flatMap(item =>
      item.commands.map(command => command.command),
    );

    assert.equal(writtenBundle.status, 'dry-run');
    assert.equal(writtenBundle.schemaVersion, 1);
    assert.equal(writtenBundle.evidencePath, outputPath);
    assert.equal(
      writtenBundle.docsEvidence.zephyrRspackPlugin,
      'zephyr-rspack-plugin',
    );
    assert.equal(
      writtenBundle.docsEvidence.packageJsonDependencyKey,
      'zephyr:dependencies',
    );
    assert.equal(writtenBundle.targets.length, 7);
    assert.equal(writtenBundle.switchingScenarios.length, 6);
    assert.equal(
      writtenBundle.targets.some(
        target =>
          target.id === 'remote-explore-v1' &&
          target.appUid === 'app_uid_remote_explore_v1' &&
          target.markers.uiExpected === 'explore-ui-version:v1' &&
          target.markers.apiExpected === 'explore-api-version:v1' &&
          target.markers.cssExpected === 'explore-css-version:v1' &&
          target.markers.i18nExpected === 'explore-i18n-version:v1',
      ),
      true,
    );
    assert.equal(
      allCommands.some(command => /zephyr:/.test(command)),
      false,
    );
    assert.equal(
      allCommands.some(command => /pnpm .*build/.test(command)),
      true,
    );
    assert.equal(
      writtenBundle.assertions.every(
        assertion => assertion.status === 'skipped',
      ),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
