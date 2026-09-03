// Consumer: publish-bleedingdev.yml qualify-source and prepare-release jobs.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const scriptPath = path.join(__dirname, '..', 'source-qualification.mjs');

// The helper is ESM; every sibling test in this directory is CommonJS because
// `pnpm test:scripts` globs `__tests__/*.test.js`.
const loadHelper = () => import(pathToFileURL(scriptPath).href);

const repository = 'BleedingDev/ultramodern.js';
const qualifiedCommit = 'a'.repeat(40);
const otherCommit = 'b'.repeat(40);

const withTempDir = async body => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-qualification-'));
  try {
    return await body(root);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
};

const writeReceipt = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const acceptedReceipt = () => ({
  schema: 'bleedingdev.ultramodern.source-qualification',
  schemaVersion: 1,
  source: { repository, commit: qualifiedCommit },
  runId: '77',
  runAttempt: '2',
  runIdentity: `github:${repository}:run:77:attempt:2`,
});

const verifyArgs = {
  receiptPath: '',
  repository,
  runAttempt: '2',
  runId: '77',
};

test('a qualification receipt binds the qualified commit to its own run', async () => {
  const { createSourceQualification, sourceQualificationArtifactName } =
    await loadHelper();
  await withTempDir(async root => {
    const outPath = path.join(root, 'nested', 'source-qualification.json');
    const receipt = createSourceQualification({
      commit: qualifiedCommit,
      outPath,
      repository,
      runAttempt: '2',
      runId: '77',
    });

    assert.deepEqual(receipt, acceptedReceipt());
    assert.deepEqual(JSON.parse(fs.readFileSync(outPath, 'utf8')), receipt);
    assert.equal(
      sourceQualificationArtifactName({ runAttempt: '2', runId: '77' }),
      'bleedingdev-source-qualification-run-77-attempt-2',
    );
  });
});

test('a qualification receipt cannot be minted for an unresolved source', async () => {
  const { createSourceQualification } = await loadHelper();
  await withTempDir(async root => {
    const outPath = path.join(root, 'source-qualification.json');
    for (const invalid of [
      { commit: 'HEAD' },
      { commit: qualifiedCommit.toUpperCase() },
      { repository: 'ultramodern.js' },
      { runId: '0' },
      { runAttempt: 'latest' },
    ]) {
      assert.throws(
        () =>
          createSourceQualification({
            commit: qualifiedCommit,
            outPath,
            repository,
            runAttempt: '2',
            runId: '77',
            ...invalid,
          }),
        /is not a valid/u,
      );
    }
    assert.equal(fs.existsSync(outPath), false);
  });
});

test('verification accepts only the recovered run own passing receipt', async () => {
  const { verifySourceQualification } = await loadHelper();
  await withTempDir(async root => {
    const receiptPath = path.join(root, 'source-qualification.json');
    writeReceipt(receiptPath, acceptedReceipt());

    assert.deepEqual(
      verifySourceQualification({ ...verifyArgs, receiptPath }),
      acceptedReceipt(),
    );
    assert.deepEqual(
      verifySourceQualification({
        ...verifyArgs,
        expectedCommit: qualifiedCommit,
        receiptPath,
      }),
      acceptedReceipt(),
    );
  });
});

test('an ancestral bundle cannot promote another commit qualification', async () => {
  const { verifySourceQualification } = await loadHelper();
  await withTempDir(async root => {
    const receiptPath = path.join(root, 'source-qualification.json');
    writeReceipt(receiptPath, acceptedReceipt());

    assert.throws(
      () =>
        verifySourceQualification({
          ...verifyArgs,
          expectedCommit: otherCommit,
          receiptPath,
        }),
      /was not qualified at its own source commit/u,
    );
  });
});

test('verification rejects a receipt from another run, attempt, or repository', async () => {
  const { verifySourceQualification } = await loadHelper();
  await withTempDir(async root => {
    const receiptPath = path.join(root, 'source-qualification.json');

    for (const forged of [
      { runId: '78', runIdentity: `github:${repository}:run:78:attempt:2` },
      { runAttempt: '1', runIdentity: `github:${repository}:run:77:attempt:1` },
      {
        source: { repository: 'BleedingDev/other', commit: qualifiedCommit },
        runIdentity: 'github:BleedingDev/other:run:77:attempt:2',
      },
      // Self-consistent fields, forged identity string: the receipt claims a
      // run that never qualified anything.
      { runIdentity: `github:${repository}:run:99:attempt:9` },
    ]) {
      writeReceipt(receiptPath, { ...acceptedReceipt(), ...forged });
      assert.throws(
        () => verifySourceQualification({ ...verifyArgs, receiptPath }),
        /was not produced by the recovered run/u,
      );
    }
  });
});

test('verification rejects a receipt that is not the strict schema', async () => {
  const { verifySourceQualification } = await loadHelper();
  await withTempDir(async root => {
    const receiptPath = path.join(root, 'source-qualification.json');

    writeReceipt(receiptPath, [acceptedReceipt()]);
    assert.throws(
      () => verifySourceQualification({ ...verifyArgs, receiptPath }),
      /strict receipt shape/u,
    );

    writeReceipt(receiptPath, { ...acceptedReceipt(), extra: true });
    assert.throws(
      () => verifySourceQualification({ ...verifyArgs, receiptPath }),
      /strict receipt shape/u,
    );

    const { runIdentity: _dropped, ...missing } = acceptedReceipt();
    writeReceipt(receiptPath, missing);
    assert.throws(
      () => verifySourceQualification({ ...verifyArgs, receiptPath }),
      /strict receipt shape/u,
    );

    writeReceipt(receiptPath, { ...acceptedReceipt(), schemaVersion: 2 });
    assert.throws(
      () => verifySourceQualification({ ...verifyArgs, receiptPath }),
      /Unknown source qualification schema/u,
    );

    writeReceipt(receiptPath, {
      ...acceptedReceipt(),
      source: { repository, commit: 'not-a-commit' },
    });
    assert.throws(
      () => verifySourceQualification({ ...verifyArgs, receiptPath }),
      /Source commit is not a valid source commit/u,
    );
  });
});

test('the CLI fails closed on an unknown command and on a rejected receipt', async () => {
  await withTempDir(async root => {
    const receiptPath = path.join(root, 'source-qualification.json');
    writeReceipt(receiptPath, acceptedReceipt());

    const unknown = spawnSync(process.execPath, [scriptPath, 'promote'], {
      encoding: 'utf8',
    });
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unknown source qualification command/u);

    const missingFlag = spawnSync(
      process.execPath,
      [scriptPath, 'verify', '--receipt', receiptPath],
      { encoding: 'utf8' },
    );
    assert.notEqual(missingFlag.status, 0);
    assert.match(missingFlag.stderr, /Missing --repository/u);

    const wrongCommit = spawnSync(
      process.execPath,
      [
        scriptPath,
        'verify',
        '--receipt',
        receiptPath,
        '--repository',
        repository,
        '--run-id',
        '77',
        '--run-attempt',
        '2',
        '--expect-commit',
        otherCommit,
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(wrongCommit.status, 0);
    assert.match(wrongCommit.stderr, /own source commit/u);
  });
});
