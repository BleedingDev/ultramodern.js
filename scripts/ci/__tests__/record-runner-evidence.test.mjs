import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import {
  collectRunnerEvidence,
  emitRunnerEvidence,
  runnerEvidencePrefix,
} from '../record-runner-evidence.mjs';

const cwd = '/benchmark/checkout';
const checkout = 'a'.repeat(40);
const eventSha = 'b'.repeat(40);
const mise = '[tools]\nnode = "26.12.0"\npnpm = "12.11.2"\n';
const lockfile = "lockfileVersion: '9.0'\n";
const hash = text => createHash('sha256').update(text).digest('hex');

function fixture({ env = {}, host = {}, files = {}, run } = {}) {
  const fileContents = new Map([
    [path.join(cwd, 'package.json'), '{"packageManager":"pnpm@12.11.2"}'],
    [path.join(cwd, '.mise.toml'), mise],
    [path.join(cwd, 'pnpm-lock.yaml'), lockfile],
    [
      '/etc/os-release',
      'ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.3 LTS"\nUNRELATED_SECRET=do-not-log\n',
    ],
    ...Object.entries(files),
  ]);
  const calls = [];
  return {
    calls,
    options: {
      cwd,
      nodeVersion: '26.12.0',
      pnpmVersion: '12.11.2',
      env: {
        GITHUB_SHA: eventSha,
        GITHUB_REPOSITORY: 'ultramodernjs/ultramodern.js',
        GITHUB_REPOSITORY_ID: '1151231350',
        GITHUB_WORKFLOW_REF:
          'ultramodernjs/ultramodern.js/.github/workflows/ut-Linux.yml@refs/pull/222/merge',
        DEPOT_TOKEN: 'secret-depot-token',
        NODE_AUTH_TOKEN: 'secret-npm-token',
        GITHUB_TOKEN: 'secret-github-token',
        ...env,
      },
      host: {
        cpus: () => [
          { model: ' AMD EPYC\n 9R14 ' },
          { model: ' AMD EPYC\t9R14 ' },
        ],
        totalmem: () => 8 * 1024 ** 3,
        platform: () => 'linux',
        type: () => 'Linux',
        release: () => '6.11.0-1018-azure',
        arch: () => 'x64',
        ...host,
      },
      readFile: file => {
        if (!fileContents.has(file) || fileContents.get(file) === undefined)
          throw new Error(`secret-read-error:${file}`);
        return Buffer.from(fileContents.get(file));
      },
      run: (command, args, options) => {
        calls.push({ command, args, options });
        if (run) return run(command, args);
        if (command === 'git') return `${checkout}\n`;
        throw new Error('Unexpected subprocess');
      },
    },
  };
}

test('runner evidence records the actual checkout separately from the event SHA and uses measured hardware', () => {
  const { options, calls } = fixture({
    env: { ImageOS: 'ubuntu24', ImageVersion: '20261001.23.1' },
  });
  const evidence = collectRunnerEvidence(options);
  assert.deepEqual(evidence, {
    schema: 'ultramodern.ci.runner-evidence',
    schemaVersion: 1,
    checkedOutCommit: checkout,
    github: {
      eventSha,
      repository: 'ultramodernjs/ultramodern.js',
      repositoryId: '1151231350',
      workflowRef: options.env.GITHUB_WORKFLOW_REF,
    },
    tools: { node: '26.12.0', pnpm: '12.11.2' },
    runner: {
      os: {
        platform: 'linux',
        type: 'Linux',
        release: '6.11.0-1018-azure',
        architecture: 'x64',
        distribution: {
          id: 'ubuntu',
          versionId: '24.04',
          name: 'Ubuntu 24.04.3 LTS',
        },
      },
      cpu: { logicalCount: 2, models: ['AMD EPYC 9R14'] },
      memoryBytes: 8 * 1024 ** 3,
      image: { os: 'ubuntu24', version: '20261001.23.1' },
    },
    inputs: { lockfileSha256: hash(lockfile), miseSha256: hash(mise) },
  });
  assert.deepEqual(
    calls.map(({ command, args }) => [command, args]),
    [['git', ['rev-parse', '--verify', 'HEAD']]],
  );
  assert.ok(
    calls.every(
      call => call.options.cwd === cwd && call.options.timeout === 15_000,
    ),
  );
});

test('one JSON line contains only explicit fields and sanitizes runner descriptions', () => {
  const { options } = fixture({
    env: { ImageVersion: '20261001\n::notice::\u0000release' },
  });
  const lines = [];
  emitRunnerEvidence(options, line => lines.push(line));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith(runnerEvidencePrefix));
  assert.equal(lines[0].includes('\n'), false);
  const evidence = JSON.parse(lines[0].slice(runnerEvidencePrefix.length));
  assert.equal(evidence.runner.image.version, '20261001 ::notice:: release');
  for (const secret of [
    'secret-depot-token',
    'secret-npm-token',
    'secret-github-token',
    'do-not-log',
  ])
    assert.equal(lines[0].includes(secret), false);
  assert.equal('env' in evidence, false);
});

test('optional image and Linux distribution metadata can be absent without inventing them', () => {
  const { options } = fixture({ files: { '/etc/os-release': undefined } });
  const evidence = collectRunnerEvidence(options);
  assert.equal('image' in evidence.runner, false);
  assert.equal('distribution' in evidence.runner.os, false);
  const darwin = fixture({
    host: {
      platform: () => 'darwin',
      type: () => 'Darwin',
      release: () => '25.0.0',
      arch: () => 'arm64',
    },
  });
  assert.equal(
    'distribution' in collectRunnerEvidence(darwin.options).runner.os,
    false,
  );
});

test('invalid GitHub metadata or failed subprocesses cannot leak captured secrets', () => {
  const cases = [
    { env: { GITHUB_SHA: 'secret-invalid-sha' } },
    { env: { GITHUB_REPOSITORY_ID: 'secret-invalid-id' } },
    { env: { GITHUB_WORKFLOW_REF: 'secret\nworkflow' } },
    {
      run: () => {
        throw new Error('secret-subprocess-error');
      },
    },
  ];
  for (const input of cases) {
    const { options } = fixture(input);
    assert.throws(
      () => collectRunnerEvidence(options),
      error => {
        assert.equal(error.message.includes('secret'), false);
        assert.match(error.message, /Cannot record CI benchmark evidence/);
        return true;
      },
    );
  }
});

test('missing or mismatched required toolchain and input files fail before any evidence is emitted', () => {
  const cases = [
    { ...fixture().options, nodeVersion: '26.11.1' },
    { ...fixture().options, pnpmVersion: '12.9.0' },
    { ...fixture().options, pnpmVersion: undefined },
    { ...fixture().options, pnpmVersion: 'secret-token\n12.11.2' },
    fixture({ files: { [path.join(cwd, '.mise.toml')]: undefined } }).options,
    fixture({ files: { [path.join(cwd, 'pnpm-lock.yaml')]: undefined } })
      .options,
    fixture({
      files: {
        [path.join(cwd, 'package.json')]: '{"packageManager":"pnpm@12.9.0"}',
      },
    }).options,
    fixture({ host: { cpus: () => [] } }).options,
    fixture({ host: { totalmem: () => 0 } }).options,
  ];
  for (const options of cases) {
    const lines = [];
    assert.throws(
      () => emitRunnerEvidence(options, line => lines.push(line)),
      /Cannot record CI benchmark evidence/,
    );
    assert.deepEqual(lines, []);
  }
});

test('input hashes cover exact file bytes and Depot workflow references are retained', () => {
  const { options } = fixture({
    files: { [path.join(cwd, 'pnpm-lock.yaml')]: `${lockfile}\n` },
    env: {
      GITHUB_WORKFLOW_REF:
        'ultramodernjs/ultramodern.js/.depot/workflows/type-check.yml@refs/heads/main-ultramodern',
    },
  });
  const evidence = collectRunnerEvidence(options);
  assert.equal(evidence.inputs.lockfileSha256, hash(`${lockfile}\n`));
  assert.notEqual(evidence.inputs.lockfileSha256, hash(lockfile));
  assert.equal(evidence.github.workflowRef, options.env.GITHUB_WORKFLOW_REF);
});

test('Windows evidence uses the shell-supplied verified pnpm version without launching a .cmd child process', () => {
  const { options, calls } = fixture({
    host: {
      platform: () => 'win32',
      type: () => 'Windows_NT',
      release: () => '10.0.26100',
      arch: () => 'x64',
    },
  });
  const evidence = collectRunnerEvidence(options);
  assert.equal(evidence.runner.os.platform, 'win32');
  assert.equal(evidence.tools.pnpm, '12.11.2');
  assert.deepEqual(
    calls.map(call => call.command),
    ['git'],
  );
  assert.ok(calls.every(call => call.options.shell === undefined));
});

test('native Depot workflow references are optional observed metadata rather than invented revision proof', () => {
  for (const value of [undefined, null, '']) {
    const { options } = fixture({ env: { GITHUB_WORKFLOW_REF: value } });
    const evidence = collectRunnerEvidence(options);
    assert.equal(evidence.github.workflowRef, null);
    assert.equal(evidence.checkedOutCommit, checkout);
    assert.equal(evidence.github.eventSha, eventSha);
    assert.equal(evidence.github.repositoryId, '1151231350');
  }
  for (const value of [
    `ultramodernjs/ultramodern.js/.depot/workflows/type-check.yml@${checkout}`,
    '.depot/workflows/type-check.yml',
    'type-check.yml',
  ]) {
    const { options } = fixture({ env: { GITHUB_WORKFLOW_REF: value } });
    assert.equal(collectRunnerEvidence(options).github.workflowRef, value);
  }
  for (const value of ['secret\nworkflow', 'x'.repeat(513)]) {
    const { options } = fixture({ env: { GITHUB_WORKFLOW_REF: value } });
    assert.throws(
      () => collectRunnerEvidence(options),
      error => {
        assert.equal(error.message.includes('secret'), false);
        assert.match(error.message, /invalid GitHub workflow reference/);
        return true;
      },
    );
  }
});
