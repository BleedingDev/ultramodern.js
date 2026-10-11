const assert = require('node:assert/strict');
const test = require('node:test');
const source = {
  repository: 'BleedingDev/ultramodern.js',
  commit: 'a'.repeat(40),
};
const env = {
  GITHUB_REPOSITORY: source.repository,
  GITHUB_REF: 'refs/heads/main-ultramodern',
  GITHUB_RUN_ID: '12345',
  GITHUB_RUN_ATTEMPT: '2',
};
const item = {
  targetName: '@bleedingdev/braces',
  version: '3.0.4',
  integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
};

async function verify(
  attempt,
  { exact = false, change = value => value, fetchStatus = 200 } = {},
) {
  const {
    createRegistryProvenanceExpectation,
    verifyRegistryProvenance,
    npmPackagePurl,
    slsaProvenanceV1,
    githubActionsBuildType,
  } = await import('../lib/prepare-bleedingdev-packages/provenance.mjs');
  const expectation = createRegistryProvenanceExpectation({ source }, env);
  if (exact !== undefined) expectation.invocation.exactAttempt = exact;
  const statement = change({
    _type: 'https://in-toto.io/Statement/v1',
    predicateType: slsaProvenanceV1,
    subject: [
      {
        name: npmPackagePurl(item.targetName, item.version),
        digest: { sha512: Buffer.alloc(64, 1).toString('hex') },
      },
    ],
    predicate: {
      buildDefinition: {
        buildType: githubActionsBuildType,
        externalParameters: {
          workflow: {
            repository: `https://github.com/${source.repository}`,
            path: '.github/workflows/publish-bleedingdev.yml',
            ref: env.GITHUB_REF,
          },
        },
        resolvedDependencies: [
          {
            uri: `git+https://github.com/${source.repository}@${env.GITHUB_REF}`,
            digest: { gitCommit: source.commit },
          },
        ],
      },
      runDetails: {
        metadata: {
          invocationId: `https://github.com/${source.repository}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${attempt}`,
        },
      },
    },
  });
  const document = {
    attestations: [
      {
        predicateType: slsaProvenanceV1,
        bundle: {
          dsseEnvelope: {
            payloadType: 'application/vnd.in-toto+json',
            payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
          },
        },
      },
    ],
  };
  return verifyRegistryProvenance(
    item,
    { attestations: { provenance: { predicateType: slsaProvenanceV1 } } },
    expectation,
    async () => ({
      ok: fetchStatus === 200,
      status: fetchStatus,
      json: async () => document,
    }),
    async (_bundle, authenticated) => {
      assert.equal(authenticated.source.commit, source.commit);
      assert.equal(
        authenticated.issuer,
        'https://token.actions.githubusercontent.com',
      );
      assert.equal(
        authenticated.certificateIdentity,
        'https://github.com/BleedingDev/ultramodern.js/.github/workflows/publish-bleedingdev.yml@refs/heads/main-ultramodern',
      );
      return {
        certificateIdentity: authenticated.certificateIdentity,
        issuer: authenticated.issuer,
        verifierVersion: 'unit-fixture',
      };
    },
  );
}

test('fresh sidecars require their exact producing attempt while historical reuse keeps earlier-attempt behavior', async () => {
  await verify('2', { exact: true });
  await verify('1', { exact: false });
  await assert.rejects(
    verify('1', { exact: true }),
    /fresh producer attempt 2/,
  );
  await assert.rejects(
    verify('3', { exact: false }),
    /newer than current run attempt/,
  );
  await assert.rejects(verify('2', { exact: 'yes' }), /must be Boolean/);
});

test('strict sidecar attempts retain source, workflow, run, and subject binding', async () => {
  await assert.rejects(
    verify('2', {
      exact: true,
      change: statement => {
        statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit =
          'b'.repeat(40);
        return statement;
      },
    }),
    /source commit/,
  );
  await assert.rejects(
    verify('2', {
      exact: true,
      change: statement => {
        statement.predicate.buildDefinition.externalParameters.workflow.path =
          '.github/workflows/untrusted.yml';
        return statement;
      },
    }),
    /workflow path/,
  );
  await assert.rejects(
    verify('2', {
      exact: true,
      change: statement => {
        statement.predicate.runDetails.metadata.invocationId =
          statement.predicate.runDetails.metadata.invocationId.replace(
            '/12345/',
            '/98765/',
          );
        return statement;
      },
    }),
    /expected 12345/,
  );
  await assert.rejects(
    verify('2', {
      exact: true,
      change: statement => {
        statement.subject[0].digest.sha512 = 'b'.repeat(128);
        return statement;
      },
    }),
    /subject SHA-512/,
  );
});

test('only an absent attestation endpoint is classified as provenance propagation', async () => {
  const { RegistryProvenancePendingError } = await import(
    '../lib/prepare-bleedingdev-packages/provenance.mjs'
  );
  await assert.rejects(
    verify('2', { exact: true, fetchStatus: 404 }),
    error =>
      error instanceof RegistryProvenancePendingError &&
      /HTTP 404/u.test(error.message),
  );
  await assert.rejects(
    verify('2', { exact: true, fetchStatus: 503 }),
    error =>
      !(error instanceof RegistryProvenancePendingError) &&
      /HTTP 503/u.test(error.message),
  );
});
