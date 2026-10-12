import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTrustedPublishRepositoryContext,
  packageMetadataRepository,
  trustedPublishRepositories,
  trustedPublishRepositoryId,
} from '../lib/prepare-bleedingdev-packages/constants.mjs';
import { parseArgs } from '../lib/prepare-bleedingdev-packages/options.mjs';
import {
  createRegistryProvenanceExpectation,
  historicalRegistryProvenanceExpectations,
  verifySigstoreBundle,
} from '../lib/prepare-bleedingdev-packages/provenance.mjs';

const commit = 'a'.repeat(40);
const ref = 'refs/heads/main-ultramodern';
const expectationFor = repository =>
  createRegistryProvenanceExpectation(
    { source: { repository, commit } },
    {
      GITHUB_REPOSITORY: repository,
      GITHUB_REPOSITORY_ID: trustedPublishRepositoryId,
      GITHUB_REF: ref,
    },
  );

test('organization transfer permits only the original immutable repository at the two pinned paths', () => {
  for (const repository of trustedPublishRepositories) {
    const env = {
      GITHUB_REPOSITORY: repository,
      GITHUB_REPOSITORY_ID: trustedPublishRepositoryId,
    };
    assert.equal(isTrustedPublishRepositoryContext(env), true);
    assert.equal(
      isTrustedPublishRepositoryContext({ ...env, GITHUB_REPOSITORY_ID: '1' }),
      false,
    );
    assert.equal(
      isTrustedPublishRepositoryContext({ GITHUB_REPOSITORY: repository }),
      false,
    );
    const expectation = expectationFor(repository);
    assert.equal(expectation.source.repository, repository);
    assert.equal(expectation.workflow.repository, repository);
    assert.ok(expectation.certificateIdentity.includes(`/${repository}/`));
    assert.throws(
      () =>
        createRegistryProvenanceExpectation(
          { source: { repository, commit } },
          { ...env, GITHUB_REPOSITORY_ID: '1' },
        ),
      /repository ID/,
    );
  }
  assert.equal(
    isTrustedPublishRepositoryContext({
      GITHUB_REPOSITORY: 'attacker/ultramodern.js',
      GITHUB_REPOSITORY_ID: trustedPublishRepositoryId,
    }),
    false,
  );
  assert.throws(
    () => expectationFor('attacker/ultramodern.js'),
    /trusted publish repository/,
  );
});

test('live provenance cannot interchange old and new paths even when the repository ID matches', () => {
  assert.throws(
    () =>
      createRegistryProvenanceExpectation(
        { source: { repository: trustedPublishRepositories[1], commit } },
        {
          GITHUB_REPOSITORY: trustedPublishRepositories[0],
          GITHUB_REPOSITORY_ID: trustedPublishRepositoryId,
        },
      ),
    /Trusted publish repository/,
  );
});

test('historical identities preserve exact SAN and ref without binding old releases to a current run', () => {
  const live = createRegistryProvenanceExpectation(
    { source: { repository: trustedPublishRepositories[0], commit } },
    { GITHUB_RUN_ID: '2', GITHUB_RUN_ATTEMPT: '1' },
  );
  const historical = historicalRegistryProvenanceExpectations(live);
  assert.deepEqual(
    historical.map(candidate => candidate.source.repository),
    trustedPublishRepositories,
  );
  for (const candidate of historical) {
    assert.equal(candidate.source.commit, undefined);
    assert.equal(candidate.invocation, undefined);
    assert.equal(candidate.workflow.ref, ref);
    assert.equal(
      candidate.certificateIdentity,
      `https://github.com/${candidate.source.repository}/.github/workflows/publish-bleedingdev.yml@${ref}`,
    );
  }
});

test('Sigstore verifies the signed immutable repository ID as DER UTF8String for both paths', async () => {
  for (const repository of trustedPublishRepositories) {
    const expectation = expectationFor(repository);
    let calls = 0;
    await verifySigstoreBundle({}, expectation, () => ({
      version: 'test-verifier',
      verify: async (_bundle, options) => {
        calls += 1;
        assert.deepEqual(
          options.certificateOIDs['1.3.6.1.4.1.57264.1.15'],
          Buffer.concat([
            Buffer.from([0x0c, trustedPublishRepositoryId.length]),
            Buffer.from(trustedPublishRepositoryId),
          ]),
        );
        assert.equal(
          options.certificateOIDs['1.3.6.1.4.1.57264.1.5'],
          repository,
        );
        assert.equal(options.ctLogThreshold, 1);
        assert.equal(options.tlogThreshold, 1);
        return {
          identity: {
            subjectAlternativeName: expectation.certificateIdentity,
            extensions: { issuer: expectation.issuer },
          },
        };
      },
    }));
    assert.equal(calls, 1);
  }
});

test('a reclaimed old path with a different signed repository ID fails closed', async () => {
  const expectation = expectationFor(trustedPublishRepositories[1]);
  await assert.rejects(
    verifySigstoreBundle({}, expectation, () => ({
      verify: async (_bundle, options) => {
        const actualId = Buffer.concat([
          Buffer.from([0x0c, 1]),
          Buffer.from('1'),
        ]);
        if (!actualId.equals(options.certificateOIDs['1.3.6.1.4.1.57264.1.15']))
          throw new Error(
            'invalid certificate extension - missing OID 1.3.6.1.4.1.57264.1.15',
          );
      },
    })),
    /Sigstore\/Fulcio\/Rekor verification failed/,
  );
});

test('package source URLs match the active repository before and after transfer', () => {
  const keys = ['GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_ID'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const repository of trustedPublishRepositories) {
      process.env.GITHUB_REPOSITORY = repository;
      process.env.GITHUB_REPOSITORY_ID = trustedPublishRepositoryId;
      const options = parseArgs(['--version', '3.9.0-ultramodern.29']);
      assert.equal(
        options.repositoryUrl,
        `git+https://github.com/${repository}.git`,
      );
      assert.equal(options.homepage, `https://github.com/${repository}#readme`);
      assert.equal(options.bugsUrl, `https://github.com/${repository}/issues`);
    }
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY_ID;
    assert.equal(packageMetadataRepository(), trustedPublishRepositories[0]);
    assert.throws(
      () =>
        packageMetadataRepository({
          GITHUB_REPOSITORY: trustedPublishRepositories[1],
          GITHUB_REPOSITORY_ID: '1',
        }),
      /trusted GitHub repository identity/,
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
