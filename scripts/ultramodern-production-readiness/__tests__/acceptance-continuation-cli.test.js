const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const cliModule = '../../ultramodern-publish/run-release-acceptance.mjs';
const requiredArgs = [
  '--manifest',
  'release/manifest.json',
  '--receipt',
  'acceptance/receipt.json',
];
const workDir = path.resolve('acceptance/work');

test('prepublish acceptance keeps its defaults without continuation', async () => {
  const { parseArgs } = await import(cliModule);
  const options = parseArgs(requiredArgs);

  assert.equal(options.mode, 'prepublish');
  assert.equal(options.expectedMode, 'source');
  assert.equal(options.scaleProfile, 'erp-10');
  assert.equal(options.manifestPath, path.resolve('release/manifest.json'));
  assert.equal(options.receiptPath, path.resolve('acceptance/receipt.json'));
  assert.equal(options.workDir, undefined);
  assert.equal(options.continueFrom, undefined);
  assert.equal(options.priorRunLogPath, undefined);
  assert.equal(options.nodeReportPath, undefined);
});

test('published acceptance remains valid without continuation', async () => {
  const { parseArgs } = await import(cliModule);
  const options = parseArgs([
    ...requiredArgs,
    '--mode',
    'published',
    '--registry-url',
    'https://registry.example.test/',
    '--run-identity',
    'published-acceptance-run',
  ]);

  assert.equal(options.mode, 'published');
  assert.equal(options.registryUrl, 'https://registry.example.test/');
  assert.equal(options.runIdentity, 'published-acceptance-run');
  assert.equal(options.continueFrom, undefined);
  assert.equal(options.priorRunLogPath, undefined);
  assert.equal(options.nodeReportPath, undefined);
});

test('receipt verification remains valid without continuation', async () => {
  const { parseArgs } = await import(cliModule);
  const options = parseArgs([
    ...requiredArgs,
    '--verify-receipt',
    '--expected-mode',
    'published',
    '--run-identity',
    'accepted-producer-run',
  ]);

  assert.equal(options.mode, 'verify');
  assert.equal(options.expectedMode, 'published');
  assert.equal(options.runIdentity, 'accepted-producer-run');
  assert.equal(options.continueFrom, undefined);
  assert.equal(options.priorRunLogPath, undefined);
  assert.equal(options.nodeReportPath, undefined);
});

test('source-node continuation resolves its prior log without requiring a node report', async () => {
  const { parseArgs } = await import(cliModule);
  const options = parseArgs([
    ...requiredArgs,
    '--continue-from',
    'source-node',
    '--work-dir',
    workDir,
    '--prior-run-log',
    'acceptance/previous/run.json',
  ]);

  assert.equal(options.mode, 'prepublish');
  assert.equal(options.continueFrom, 'source-node');
  assert.equal(options.workDir, workDir);
  assert.equal(
    options.priorRunLogPath,
    path.resolve('acceptance/previous/run.json'),
  );
  assert.equal(options.nodeReportPath, undefined);
});

test('source-node continuation resolves the supplied leaf report path', async () => {
  const { parseArgs } = await import(cliModule);
  const options = parseArgs([
    ...requiredArgs,
    '--mode',
    'prepublish',
    '--continue-from',
    'source-node',
    '--work-dir',
    workDir,
    '--prior-run-log',
    'acceptance/previous/../previous/run.json',
    '--node-report',
    'acceptance/work/node/../node/report.json',
  ]);

  assert.equal(options.continueFrom, 'source-node');
  assert.equal(
    options.priorRunLogPath,
    path.resolve('acceptance/previous/run.json'),
  );
  assert.equal(
    options.nodeReportPath,
    path.resolve('acceptance/work/node/report.json'),
  );
});

test('continuation rejects an unsupported cursor', async () => {
  const { parseArgs } = await import(cliModule);

  assert.throws(
    () =>
      parseArgs([
        ...requiredArgs,
        '--continue-from',
        'source-browser',
        '--work-dir',
        workDir,
        '--prior-run-log',
        'acceptance/previous/run.json',
      ]),
    /--continue-from.*source-node/u,
  );
});

test('continuation rejects published acceptance', async () => {
  const { parseArgs } = await import(cliModule);

  assert.throws(
    () =>
      parseArgs([
        ...requiredArgs,
        '--mode',
        'published',
        '--continue-from',
        'source-node',
        '--prior-run-log',
        'acceptance/previous/run.json',
      ]),
    /prepublish/u,
  );
});

test('continuation rejects explicit receipt verification mode', async () => {
  const { parseArgs } = await import(cliModule);

  assert.throws(
    () =>
      parseArgs([
        ...requiredArgs,
        '--mode',
        'verify',
        '--continue-from',
        'source-node',
        '--prior-run-log',
        'acceptance/previous/run.json',
      ]),
    /prepublish/u,
  );
});

test('continuation rejects the receipt verification flag', async () => {
  const { parseArgs } = await import(cliModule);

  assert.throws(
    () =>
      parseArgs([
        ...requiredArgs,
        '--verify-receipt',
        '--continue-from',
        'source-node',
        '--prior-run-log',
        'acceptance/previous/run.json',
      ]),
    /prepublish/u,
  );
});

test('continuation requires an explicit work directory', async () => {
  const { parseArgs } = await import(cliModule);

  assert.throws(
    () =>
      parseArgs([
        ...requiredArgs,
        '--continue-from',
        'source-node',
        '--prior-run-log',
        'acceptance/previous/run.json',
      ]),
    /--work-dir/u,
  );
});

test('continuation requires a prior run log even when a node report is supplied', async () => {
  const { parseArgs } = await import(cliModule);

  assert.throws(
    () =>
      parseArgs([
        ...requiredArgs,
        '--continue-from',
        'source-node',
        '--work-dir',
        workDir,
        '--node-report',
        'acceptance/work/node/report.json',
      ]),
    /--prior-run-log/u,
  );
});

test('prepublish acceptance rejects a prior log without continuation', async () => {
  const { parseArgs } = await import(cliModule);

  assert.throws(
    () =>
      parseArgs([
        ...requiredArgs,
        '--prior-run-log',
        'acceptance/previous/run.json',
      ]),
    /--continue-from/u,
  );
});

test('prepublish acceptance rejects a node report without continuation', async () => {
  const { parseArgs } = await import(cliModule);

  assert.throws(
    () =>
      parseArgs([
        ...requiredArgs,
        '--node-report',
        'acceptance/work/node/report.json',
      ]),
    /--continue-from/u,
  );
});

test('receipt verification rejects a prior log without continuation', async () => {
  const { parseArgs } = await import(cliModule);

  assert.throws(
    () =>
      parseArgs([
        ...requiredArgs,
        '--mode',
        'verify',
        '--prior-run-log',
        'acceptance/previous/run.json',
      ]),
    /--continue-from/u,
  );
});

test('receipt verification rejects a node report without continuation', async () => {
  const { parseArgs } = await import(cliModule);

  assert.throws(
    () =>
      parseArgs([
        ...requiredArgs,
        '--verify-receipt',
        '--node-report',
        'acceptance/work/node/report.json',
      ]),
    /--continue-from/u,
  );
});

const sourceWorkerdArgs = [
  ...requiredArgs,
  '--continue-from',
  'source-workerd',
  '--work-dir',
  workDir,
  '--prior-run-log',
  'acceptance/previous/../previous/run.json',
  '--node-report',
  'acceptance/work/node/../node/report.json',
  '--cloudflare-run-log',
  'acceptance/work/cloudflare/../cloudflare/run.json',
  '--shell-finalization',
  'acceptance/work/shell/../shell/finalization.json',
];

test('source-workerd continuation resolves all supplied evidence paths', async () => {
  const { parseArgs } = await import(cliModule);
  const options = parseArgs(sourceWorkerdArgs);

  assert.equal(options.mode, 'prepublish');
  assert.equal(options.continueFrom, 'source-workerd');
  assert.equal(options.workDir, workDir);
  assert.equal(
    options.priorRunLogPath,
    path.resolve('acceptance/previous/run.json'),
  );
  assert.equal(
    options.nodeReportPath,
    path.resolve('acceptance/work/node/report.json'),
  );
  assert.equal(
    options.cloudflareRunLogPath,
    path.resolve('acceptance/work/cloudflare/run.json'),
  );
  assert.equal(
    options.shellFinalizationPath,
    path.resolve('acceptance/work/shell/finalization.json'),
  );
});

for (const flag of [
  '--work-dir',
  '--prior-run-log',
  '--node-report',
  '--cloudflare-run-log',
  '--shell-finalization',
]) {
  test(`source-workerd continuation requires ${flag}`, async () => {
    const { parseArgs } = await import(cliModule);
    const flagIndex = sourceWorkerdArgs.indexOf(flag);
    const args = [
      ...sourceWorkerdArgs.slice(0, flagIndex),
      ...sourceWorkerdArgs.slice(flagIndex + 2),
    ];

    assert.throws(() => parseArgs(args), new RegExp(flag, 'u'));
  });
}

for (const [flag, evidencePath] of [
  ['--cloudflare-run-log', 'acceptance/work/cloudflare/run.json'],
  ['--shell-finalization', 'acceptance/work/shell/finalization.json'],
]) {
  test(`source-node continuation rejects ${flag}`, async () => {
    const { parseArgs } = await import(cliModule);

    assert.throws(
      () =>
        parseArgs([
          ...requiredArgs,
          '--continue-from',
          'source-node',
          '--work-dir',
          workDir,
          '--prior-run-log',
          'acceptance/previous/run.json',
          '--node-report',
          'acceptance/work/node/report.json',
          flag,
          evidencePath,
        ]),
      /source-workerd/u,
    );
  });

  for (const mode of ['prepublish', 'published', 'verify']) {
    test(`${mode} acceptance rejects ${flag} without continuation`, async () => {
      const { parseArgs } = await import(cliModule);

      assert.throws(
        () => parseArgs([...requiredArgs, '--mode', mode, flag, evidencePath]),
        /source-workerd/u,
      );
    });
  }
}

for (const [description, modeArgs] of [
  ['published acceptance', ['--mode', 'published']],
  ['explicit receipt verification mode', ['--mode', 'verify']],
  ['the receipt verification flag', ['--verify-receipt']],
]) {
  test(`source-workerd continuation rejects ${description}`, async () => {
    const { parseArgs } = await import(cliModule);
    const workDirIndex = sourceWorkerdArgs.indexOf('--work-dir');
    const args = [
      ...sourceWorkerdArgs.slice(0, workDirIndex),
      ...sourceWorkerdArgs.slice(workDirIndex + 2),
      ...modeArgs,
    ];

    assert.throws(() => parseArgs(args), /prepublish/u);
  });
}
