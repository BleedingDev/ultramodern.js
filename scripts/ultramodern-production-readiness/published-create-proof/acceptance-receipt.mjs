import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const acceptanceReceiptSchema =
  'bleedingdev.ultramodern.release-acceptance-receipt';
const acceptanceReceiptSchemaVersion = 2;
const acceptanceProfileVersion = 2;
const requiredAcceptanceResultIds = Object.freeze([
  'registry-cohort-integrity',
  'native-create',
  'vertical-additions',
  'generate-lockfile',
  'dependency-closure-audit',
  'install',
  'pnpm-check',
  'build',
  'cloudflare-build',
  'topology',
  'module-federation',
  'api',
  'backend',
  'browser-runtime',
]);
const finalResultStatuses = new Set(['pass', 'fail', 'not-run']);
const digestPattern = /^[a-f0-9]{64}$/u;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, keys, label) {
  assertCondition(isPlainObject(value), `${label} must be a JSON object`);
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right),
  );
  const expected = [...keys].sort((left, right) => left.localeCompare(right));
  assertCondition(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} has unknown or missing fields: expected ${expected.join(
      ', ',
    )}; found ${actual.join(', ')}`,
  );
}

function hasSkippedProof(value) {
  if (value === 'skipped') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasSkippedProof);
  }
  if (!isPlainObject(value)) {
    return false;
  }
  if (value.skipped === true || value.status === 'skipped') {
    return true;
  }
  return Object.values(value).some(hasSkippedProof);
}

function pendingSupplyChainBinding(release) {
  return {
    closureSha256: null,
    exceptionPolicySha256: null,
    lockSha256: null,
    registryMetadataSha256: null,
    releaseManifestSha256: release.manifestSha256,
  };
}

function createAcceptanceReceipt({
  release,
  mode,
  profile,
  createPackage,
  runtime,
  registry,
  runIdentity,
  now = Date,
}) {
  return {
    schema: acceptanceReceiptSchema,
    schemaVersion: acceptanceReceiptSchemaVersion,
    generatedAt: new now().toISOString(),
    status: 'running',
    passed: false,
    mode,
    binding: {
      source: { ...release.source },
      release: { ...release.release },
      manifest: {
        sha256: release.manifestSha256,
        cohortDigest: release.cohortDigest,
        packageCount: release.packages.length,
      },
      create: {
        sourceName: release.createPackage.sourceName,
        targetName: createPackage.packageName,
        version: createPackage.version,
        exactSpecifier: createPackage.exactSpecifier,
        integrity: release.createPackage.integrity,
      },
      profile: {
        id: profile.id,
        version: acceptanceProfileVersion,
      },
      runIdentity,
      supplyChain: pendingSupplyChainBinding(release),
    },
    profile: {
      id: profile.id,
      version: acceptanceProfileVersion,
      verticalCount: profile.verticalCount,
      requiredResults: [...requiredAcceptanceResultIds],
    },
    runtime,
    registry,
    results: requiredAcceptanceResultIds.map(id => ({
      id,
      status: 'pending',
    })),
    optionalResults: [],
    error: null,
  };
}

function bindSupplyChainEvidence(receipt, digests) {
  assertExactKeys(
    digests,
    [
      'closureSha256',
      'exceptionPolicySha256',
      'lockSha256',
      'registryMetadataSha256',
      'releaseManifestSha256',
    ],
    'Supply-chain digest binding',
  );
  assertCondition(
    Object.values(receipt.binding.supplyChain).some(value => value === null),
    'Acceptance receipt supply-chain evidence was already bound',
  );
  for (const [name, digest] of Object.entries(digests)) {
    assertCondition(
      digestPattern.test(digest),
      `Supply-chain digest ${name} must be a SHA-256 hex digest`,
    );
  }
  assertCondition(
    digests.releaseManifestSha256 === receipt.binding.manifest.sha256,
    'Supply-chain release manifest digest does not match the receipt manifest',
  );
  receipt.binding.supplyChain = { ...digests };
}

async function recordAcceptanceResult(receipt, id, action) {
  const result = receipt.results.find(candidate => candidate.id === id);
  assertCondition(result, `Unknown acceptance result id: ${id}`);
  assertCondition(
    result.status === 'pending',
    `Acceptance result ${id} was recorded more than once`,
  );
  try {
    const details = await action();
    assertCondition(
      isPlainObject(details) && Object.keys(details).length > 0,
      `Acceptance result ${id} must return non-empty proof details`,
    );
    assertCondition(
      !hasSkippedProof(details),
      `Required acceptance result ${id} returned skipped proof`,
    );
    Object.assign(result, { status: 'pass', details });
    return details;
  } catch (error) {
    Object.assign(result, { status: 'fail', error: errorMessage(error) });
    throw error;
  }
}

function finalizeAcceptanceReceipt(receipt, error) {
  for (const result of receipt.results) {
    if (result.status === 'pending') {
      result.status = 'not-run';
      result.reason = error
        ? 'A preceding required acceptance result failed.'
        : 'The required acceptance result was not executed.';
    }
  }
  const allPassed = receipt.results.every(result => result.status === 'pass');
  receipt.status = allPassed ? 'passed' : 'failed';
  receipt.passed = allPassed;
  receipt.error = error ? errorMessage(error) : null;
  return receipt;
}

function assertTool(tool, label) {
  assertExactKeys(tool, ['integrity', 'name', 'version'], label);
  assertCondition(
    typeof tool.name === 'string' && tool.name.length > 0,
    `${label}.name is missing`,
  );
  for (const field of ['version', 'integrity']) {
    assertCondition(
      tool[field] === null ||
        (typeof tool[field] === 'string' && tool[field].length > 0),
      `${label}.${field} must be a non-empty string or null`,
    );
  }
}

function assertRuntime(runtime) {
  assertExactKeys(
    runtime,
    [
      'arch',
      'node',
      'npm',
      'platform',
      'playwright',
      'pnpm',
      'registry',
      'yaml',
    ],
    'Acceptance receipt runtime',
  );
  for (const field of [
    'arch',
    'node',
    'npm',
    'platform',
    'playwright',
    'pnpm',
  ]) {
    assertCondition(
      typeof runtime[field] === 'string' && runtime[field].length > 0,
      `Acceptance receipt runtime.${field} is missing`,
    );
  }
  assertTool(runtime.registry, 'Acceptance receipt runtime.registry');
  assertTool(runtime.yaml, 'Acceptance receipt runtime.yaml');
}

function expectedBinding(release, profileId, runIdentity, supplyChain) {
  return {
    source: { ...release.source },
    release: { ...release.release },
    manifest: {
      sha256: release.manifestSha256,
      cohortDigest: release.cohortDigest,
      packageCount: release.packages.length,
    },
    create: {
      sourceName: release.createPackage.sourceName,
      targetName: release.createPackage.targetName,
      version: release.createPackage.version,
      exactSpecifier: `${release.createPackage.targetName}@${release.createPackage.version}`,
      integrity: release.createPackage.integrity,
    },
    profile: { id: profileId, version: acceptanceProfileVersion },
    runIdentity,
    supplyChain,
  };
}

function assertAcceptanceReceipt(
  receipt,
  {
    release,
    profileId = 'erp-10',
    runIdentity,
    expectedMode,
    requirePassed = true,
  } = {},
) {
  assertExactKeys(
    receipt,
    [
      'binding',
      'error',
      'generatedAt',
      'mode',
      'optionalResults',
      'passed',
      'profile',
      'registry',
      'results',
      'runtime',
      'schema',
      'schemaVersion',
      'status',
    ],
    'Acceptance receipt',
  );
  assertCondition(
    receipt.schema === acceptanceReceiptSchema &&
      receipt.schemaVersion === acceptanceReceiptSchemaVersion,
    `Unknown acceptance receipt schema ${String(receipt.schema)}@${String(
      receipt.schemaVersion,
    )}`,
  );
  assertCondition(
    Number.isFinite(Date.parse(receipt.generatedAt)),
    'Acceptance receipt generatedAt is invalid',
  );
  assertCondition(
    ['source', 'published'].includes(receipt.mode),
    `Acceptance receipt mode is invalid: ${String(receipt.mode)}`,
  );
  if (expectedMode) {
    assertCondition(
      receipt.mode === expectedMode,
      `Acceptance receipt mode must be ${expectedMode}, found ${receipt.mode}`,
    );
  }
  assertExactKeys(
    receipt.profile,
    ['id', 'requiredResults', 'version', 'verticalCount'],
    'Acceptance receipt profile',
  );
  assertCondition(
    receipt.profile.id === profileId,
    `Acceptance receipt profile must be ${profileId}, found ${String(
      receipt.profile.id,
    )}`,
  );
  assertCondition(
    receipt.profile.version === acceptanceProfileVersion &&
      receipt.profile.verticalCount === 10,
    'Acceptance receipt ERP-10 profile identity is invalid',
  );
  assertCondition(
    JSON.stringify(receipt.profile.requiredResults) ===
      JSON.stringify(requiredAcceptanceResultIds),
    'Acceptance receipt required result contract does not match ERP-10',
  );

  assertExactKeys(
    receipt.binding,
    [
      'create',
      'manifest',
      'profile',
      'release',
      'runIdentity',
      'source',
      'supplyChain',
    ],
    'Acceptance receipt binding',
  );
  assertExactKeys(
    receipt.binding.source,
    ['commit', 'repository'],
    'Acceptance receipt binding.source',
  );
  assertExactKeys(
    receipt.binding.release,
    ['tag', 'version'],
    'Acceptance receipt binding.release',
  );
  assertExactKeys(
    receipt.binding.manifest,
    ['cohortDigest', 'packageCount', 'sha256'],
    'Acceptance receipt binding.manifest',
  );
  assertExactKeys(
    receipt.binding.create,
    ['exactSpecifier', 'integrity', 'sourceName', 'targetName', 'version'],
    'Acceptance receipt binding.create',
  );
  assertExactKeys(
    receipt.binding.profile,
    ['id', 'version'],
    'Acceptance receipt binding.profile',
  );
  assertExactKeys(
    receipt.binding.supplyChain,
    [
      'closureSha256',
      'exceptionPolicySha256',
      'lockSha256',
      'registryMetadataSha256',
      'releaseManifestSha256',
    ],
    'Acceptance receipt binding.supplyChain',
  );
  assertCondition(
    typeof receipt.binding.runIdentity === 'string' &&
      receipt.binding.runIdentity.length > 0,
    'Acceptance receipt run identity is missing',
  );
  for (const [name, digest] of Object.entries(receipt.binding.supplyChain)) {
    assertCondition(
      digestPattern.test(digest ?? ''),
      `Acceptance receipt supply-chain digest ${name} is invalid`,
    );
  }
  assertCondition(
    receipt.binding.supplyChain.releaseManifestSha256 ===
      receipt.binding.manifest.sha256,
    'Acceptance receipt supply-chain manifest digest is mixed',
  );
  assertCondition(
    receipt.binding.create.exactSpecifier ===
      `${receipt.binding.create.targetName}@${receipt.binding.create.version}`,
    'Acceptance receipt create package is not exact name@version',
  );
  assertCondition(
    JSON.stringify(receipt.binding.profile) ===
      JSON.stringify({
        id: receipt.profile.id,
        version: receipt.profile.version,
      }),
    'Acceptance receipt profile binding is mixed',
  );

  assertRuntime(receipt.runtime);
  assertExactKeys(
    receipt.registry,
    ['cohortPackages', 'externalDependencies', 'resolution', 'url'],
    'Acceptance receipt registry',
  );
  for (const field of Object.keys(receipt.registry)) {
    assertCondition(
      typeof receipt.registry[field] === 'string' &&
        receipt.registry[field].length > 0,
      `Acceptance receipt registry.${field} is missing`,
    );
  }

  const resultIds = Array.isArray(receipt.results)
    ? receipt.results.map(result => result.id)
    : [];
  assertCondition(
    JSON.stringify(resultIds) === JSON.stringify(requiredAcceptanceResultIds),
    'Acceptance receipt must contain every required result exactly once and in ERP-10 order',
  );
  for (const result of receipt.results) {
    assertCondition(
      result.status !== 'skipped',
      `Required acceptance result ${result.id} must not be skipped`,
    );
    assertCondition(
      finalResultStatuses.has(result.status),
      `Required acceptance result ${result.id} has invalid final status ${String(
        result.status,
      )}`,
    );
    if (result.status === 'pass') {
      assertExactKeys(
        result,
        ['details', 'id', 'status'],
        `Result ${result.id}`,
      );
      assertCondition(
        isPlainObject(result.details) &&
          Object.keys(result.details).length > 0 &&
          !hasSkippedProof(result.details),
        `Required acceptance result ${result.id} has empty or skipped proof details`,
      );
    }
  }
  assertCondition(
    Array.isArray(receipt.optionalResults) &&
      receipt.optionalResults.length === 0,
    'ERP-10 acceptance receipt must not mix optional results into the profile',
  );

  if (release) {
    assertCondition(
      JSON.stringify(receipt.binding) ===
        JSON.stringify(
          expectedBinding(
            release,
            profileId,
            runIdentity ?? receipt.binding.runIdentity,
            receipt.binding.supplyChain,
          ),
        ),
      'Acceptance receipt binding does not match the strict release manifest',
    );
  }
  if (runIdentity) {
    assertCondition(
      receipt.binding.runIdentity === runIdentity,
      `Acceptance receipt run identity must be ${runIdentity}, found ${receipt.binding.runIdentity}`,
    );
  }
  if (requirePassed) {
    assertCondition(
      receipt.status === 'passed' &&
        receipt.passed === true &&
        receipt.error === null,
      'Acceptance receipt is not passed',
    );
    assertCondition(
      receipt.results.every(result => result.status === 'pass'),
      'Acceptance receipt has a required result that did not pass',
    );
  }
  return receipt;
}

function readAcceptanceReceipt(receiptPath) {
  const resolved = path.resolve(receiptPath);
  const stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
  assertCondition(
    stat?.isFile() && !stat.isSymbolicLink(),
    `Acceptance receipt is missing or is not a regular file: ${resolved}`,
  );
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(
      `Acceptance receipt is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function readRegularJson(filePath, label) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
  assertCondition(
    stat?.isFile() && !stat.isSymbolicLink(),
    `${label} is missing or is not a regular file: ${resolved}`,
  );
  try {
    return {
      path: resolved,
      value: JSON.parse(fs.readFileSync(resolved, 'utf8')),
    };
  } catch (error) {
    throw new Error(
      `${label} is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertAcceptanceReceiptIdentity(receipt, { manifest, runIdentity }) {
  assertExactKeys(
    manifest.source,
    ['commit', 'repository'],
    'Release manifest source',
  );
  assertExactKeys(
    manifest.release,
    ['tag', 'version'],
    'Release manifest release',
  );
  assertCondition(
    digestPattern.test(manifest.sha256),
    'Release manifest SHA-256 is invalid',
  );
  assertCondition(
    digestPattern.test(manifest.cohortDigest),
    'Release manifest cohort digest is invalid',
  );
  assertCondition(
    Number.isSafeInteger(manifest.packageCount) && manifest.packageCount > 0,
    'Release manifest package count is invalid',
  );
  for (const [label, value] of Object.entries({
    'Release manifest source commit': manifest.source.commit,
    'Release manifest source repository': manifest.source.repository,
    'Release manifest tag': manifest.release.tag,
    'Release manifest version': manifest.release.version,
    'Release run identity': runIdentity,
  })) {
    assertCondition(
      typeof value === 'string' && value.length > 0,
      `${label} is missing`,
    );
  }

  assertAcceptanceReceipt(receipt, {
    profileId: 'erp-10',
    runIdentity,
    expectedMode: 'source',
  });
  assertCondition(
    receipt.binding.source.commit === manifest.source.commit &&
      receipt.binding.source.repository === manifest.source.repository &&
      receipt.binding.release.tag === manifest.release.tag &&
      receipt.binding.release.version === manifest.release.version &&
      receipt.binding.manifest.sha256 === manifest.sha256 &&
      receipt.binding.manifest.cohortDigest === manifest.cohortDigest &&
      receipt.binding.manifest.packageCount === manifest.packageCount &&
      receipt.binding.supplyChain.releaseManifestSha256 === manifest.sha256,
    'Acceptance receipt does not match the release manifest identity',
  );
  return receipt;
}

function readAcceptanceReceiptManifest(manifestPath) {
  const { path: resolvedPath, value } = readRegularJson(
    manifestPath,
    'Release manifest',
  );
  assertCondition(
    isPlainObject(value),
    'Release manifest must be a JSON object',
  );
  assertExactKeys(
    value.source,
    ['commit', 'repository'],
    'Release manifest source',
  );
  assertExactKeys(
    value.release,
    ['tag', 'version'],
    'Release manifest release',
  );
  assertCondition(
    Array.isArray(value.packages) && value.packages.length > 0,
    'Release manifest packages are invalid',
  );
  return {
    cohortDigest: value.cohortDigest,
    packageCount: value.packages.length,
    release: value.release,
    sha256: crypto
      .createHash('sha256')
      .update(fs.readFileSync(resolvedPath))
      .digest('hex'),
    source: value.source,
  };
}

function parseVerificationArgs(argv) {
  const values = new Map();
  let verify = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--verify') {
      if (verify) {
        throw new Error('Duplicate argument: --verify');
      }
      verify = true;
      continue;
    }
    if (!['--manifest', '--receipt', '--run-identity'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (values.has(argument)) {
      throw new Error(`Duplicate argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    values.set(argument, value);
    index += 1;
  }
  for (const argument of ['--manifest', '--receipt', '--run-identity']) {
    if (!values.has(argument)) {
      throw new Error(`${argument} is required`);
    }
  }
  if (!verify) {
    throw new Error('--verify is required');
  }
  return {
    manifestPath: values.get('--manifest'),
    receiptPath: values.get('--receipt'),
    runIdentity: values.get('--run-identity'),
  };
}

function verifyAcceptanceReceiptCli(argv = process.argv.slice(2)) {
  const options = parseVerificationArgs(argv);
  const manifest = readAcceptanceReceiptManifest(options.manifestPath);
  const receipt = readAcceptanceReceipt(options.receiptPath);
  assertAcceptanceReceiptIdentity(receipt, {
    manifest,
    runIdentity: options.runIdentity,
  });
  process.stdout.write(
    `Verified ERP-10 acceptance receipt for ${manifest.release.version}.\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    verifyAcceptanceReceiptCli();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

export {
  acceptanceProfileVersion,
  acceptanceReceiptSchema,
  acceptanceReceiptSchemaVersion,
  assertAcceptanceReceipt,
  assertAcceptanceReceiptIdentity,
  bindSupplyChainEvidence,
  createAcceptanceReceipt,
  finalizeAcceptanceReceipt,
  readAcceptanceReceipt,
  readAcceptanceReceiptManifest,
  recordAcceptanceResult,
  requiredAcceptanceResultIds,
  verifyAcceptanceReceiptCli,
};
