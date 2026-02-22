const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readJsonFile,
  validateContractShape,
  validateManifestShape,
  validateManifests,
} = require('../validator');

const CONTRACT_PATH = path.resolve(
  __dirname,
  '../../../docs/super-app-rfc-adr/contracts/module-sdk-contracts.json',
);

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-module-sdk-'));

const removeDir = directory => {
  fs.rmSync(directory, { recursive: true, force: true });
};

const createValidManifest = () => ({
  moduleId: 'crm-sales',
  family: 'crm',
  version: '1.0.0',
  runtime: 'effect-first',
  sourceDir: 'packages/modules/crm-sales',
  lifecycleHooks: [
    'registerRoutes',
    'registerCapabilities',
    'registerMigrations',
  ],
  policyHooks: ['authorize', 'enforceTenantScope', 'validateOperationContext'],
  observability: {
    signals: ['metrics', 'audit', 'trace'],
    hooks: ['emitBusinessMetric', 'emitAuditEvent', 'emitTraceContext'],
  },
  compliance: {
    usesSdkContracts: true,
    usesPolicyMiddleware: true,
    usesObservabilityHooks: true,
  },
});

test('validateContractShape accepts canonical module SDK contract', () => {
  const contract = readJsonFile(CONTRACT_PATH);
  assert.doesNotThrow(() => validateContractShape(contract));
});

test('validateContractShape rejects missing required family', () => {
  const contract = readJsonFile(CONTRACT_PATH);
  delete contract.families.chat;

  assert.throws(() => validateContractShape(contract), /required family "chat"/);
});

test('validateManifestShape accepts compliant manifest', () => {
  const contract = readJsonFile(CONTRACT_PATH);
  const manifest = createValidManifest();

  assert.doesNotThrow(() =>
    validateManifestShape({
      manifest,
      contract,
      manifestPath: 'memory://manifest.json',
    }),
  );
});

test('validateManifestShape rejects non-compliant manifest', () => {
  const contract = readJsonFile(CONTRACT_PATH);
  const manifest = createValidManifest();
  manifest.policyHooks = ['authorize', 'enforceTenantScope'];

  assert.throws(
    () =>
      validateManifestShape({
        manifest,
        contract,
        manifestPath: 'memory://manifest.json',
      }),
    /required value "validateOperationContext"/,
  );
});

test('validateManifests validates directory manifests', () => {
  const dir = makeTempDir();
  try {
    const contract = readJsonFile(CONTRACT_PATH);
    const manifestPath = path.join(dir, 'crm-sales.json');
    fs.writeFileSync(manifestPath, JSON.stringify(createValidManifest(), null, 2));

    const report = validateManifests({
      contract,
      manifestsDir: dir,
      allowEmpty: false,
    });

    assert.equal(report.validated.length, 1);
    assert.equal(report.validated[0].moduleId, 'crm-sales');
  } finally {
    removeDir(dir);
  }
});

test('validateManifests allows empty set when explicitly enabled', () => {
  const dir = makeTempDir();
  try {
    const contract = readJsonFile(CONTRACT_PATH);
    const report = validateManifests({
      contract,
      manifestsDir: dir,
      allowEmpty: true,
    });
    assert.equal(report.validated.length, 0);
  } finally {
    removeDir(dir);
  }
});
