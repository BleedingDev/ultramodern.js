import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { registerOwnedRoot } from './lifecycle.mjs';

const markerName = '.disk-guardian-owner';
const lockReason = 'another maintenance operation holds the lock';

function ownedDirectory(t) {
  const parent = process.env.ULTRAMODERN_RSC_WORKER_PROOF_TEST_ROOT;
  assert(
    parent && path.isAbsolute(parent),
    'Set ULTRAMODERN_RSC_WORKER_PROOF_TEST_ROOT to an owned, registered test parent',
  );
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(parent), 'rsc-lifecycle-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function lease(t, overrides = {}) {
  const root = ownedDirectory(t);
  const now = Math.floor(Date.now() / 1000);
  const fields = {
    version: '1',
    path: root,
    owner_pid: process.pid,
    created_epoch: now - 1,
    expires_epoch: now + 3600,
    ...overrides,
  };
  const marker = path.join(root, markerName);
  fs.writeFileSync(
    marker,
    Object.entries(fields)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
  return { root, marker, fields };
}

function options(root, overrides = {}) {
  return {
    workDir: path.join(root, 'react-rsc'),
    owner: 'rsc-lifecycle-test',
    ownerPid: process.pid,
    ...overrides,
  };
}

function registrationFailure(overrides = {}) {
  return Object.assign(new Error('Guardian registration failed'), {
    status: 1,
    signal: null,
    stdout: Buffer.from(
      JSON.stringify({ time: 1, status: 'failed', reason: lockReason }),
    ),
    stderr: Buffer.alloc(0),
    ...overrides,
  });
}

function failedRegistration(error) {
  return () => {
    throw error;
  };
}

function assertRejectedWithoutResidue(proofOptions, configuration, expected) {
  assert.throws(
    () => registerOwnedRoot(proofOptions, configuration),
    error => error === expected,
  );
  assert(
    !fs.existsSync(proofOptions.workDir),
    'Rejected new proof root must be removed',
  );
}

test('normal guardian registration does not require or inspect an enclosing lease', t => {
  const root = ownedDirectory(t);
  const proof = options(root);
  let calls = 0;
  const result = registerOwnedRoot(proof, {
    ownedTempDir: undefined,
    ownerSnapshotImpl: () => assert.fail('Normal registration does not defer'),
    registerImpl: (command, args, configuration) => {
      calls += 1;
      assert.equal(command, 'disk-guardian-artifacts');
      assert.deepEqual(args, [
        'register',
        '--owner',
        proof.owner,
        '--kind',
        'temp',
        '--owner-pid',
        String(process.pid),
        proof.workDir,
      ]);
      assert.deepEqual(configuration, { stdio: 'pipe' });
      return Buffer.from('{"status":"registered"}\n');
    },
  });
  assert.deepEqual(result, { status: 'registered' });
  assert.equal(calls, 1);
  assert.equal(
    fs.readFileSync(path.join(proof.workDir, markerName), 'utf8'),
    `${proof.owner}\n`,
  );
});

test('exact maintenance-lock failure defers to the enclosing live physical lease', t => {
  const parent = lease(t, { owner_pid: process.ppid });
  const originalMarker = fs.readFileSync(parent.marker);
  const proof = options(parent.root);
  const error = registrationFailure();
  const configuration = {
    ownedTempDir: parent.root,
    registerImpl: failedRegistration(error),
  };
  const expected = {
    status: 'deferred',
    reason: lockReason,
    enclosingLease: { root: parent.root, ownerPid: process.ppid },
  };
  assert.deepEqual(registerOwnedRoot(proof, configuration), expected);
  assert.deepEqual(
    registerOwnedRoot(proof, configuration),
    expected,
    'Marker-only re-entry is idempotent',
  );
  assert.deepEqual(fs.readFileSync(parent.marker), originalMarker);
  assert.equal(
    fs.readFileSync(path.join(proof.workDir, markerName), 'utf8'),
    `${proof.owner}\n`,
  );
});

test('an expired lease remains owned while its owner is live', t => {
  const now = Math.floor(Date.now() / 1000);
  const parent = lease(t, { created_epoch: now - 100, expires_epoch: now - 1 });
  assert.equal(
    registerOwnedRoot(options(parent.root), {
      ownedTempDir: parent.root,
      registerImpl: failedRegistration(registrationFailure()),
    }).status,
    'deferred',
  );
});

for (const [name, overrides] of [
  [
    'another failure reason',
    {
      stdout: JSON.stringify({
        status: 'failed',
        reason: 'not an owned directory',
      }),
    },
  ],
  [
    'another failure status',
    { stdout: JSON.stringify({ status: 'registered', reason: lockReason }) },
  ],
  ['malformed stdout', { stdout: '{' }],
  [
    'multiple stdout records',
    {
      stdout: `${JSON.stringify({ status: 'failed', reason: lockReason })}\n{}`,
    },
  ],
  ['text in stdout', { stdout: lockReason }],
  ['lock text only in stderr', { stdout: '', stderr: lockReason }],
  ['additional stderr', { stderr: 'another failure' }],
  ['another exit status', { status: 2 }],
  ['signal termination', { status: null, signal: 'SIGTERM' }],
  ['spawn failure', { status: null, code: 'ENOENT', stdout: undefined }],
]) {
  test(`${name} preserves the original registration failure and rolls back new resources`, t => {
    const parent = lease(t);
    const error = registrationFailure(overrides);
    assertRejectedWithoutResidue(
      options(parent.root),
      {
        ownedTempDir: parent.root,
        registerImpl: failedRegistration(error),
        ownerSnapshotImpl: () =>
          assert.fail('Other guardian failures cannot inspect a fallback'),
      },
      error,
    );
    assert(fs.existsSync(parent.marker));
  });
}

for (const [name, parentValue] of [
  ['absent', () => undefined],
  ['relative', () => 'relative'],
  ['noncanonical', parent => `${parent.root}/.`],
  ['equal to the proof root', (parent, proof) => proof.workDir],
  ['missing', parent => path.join(parent.root, 'missing')],
  ['sibling', parent => `${parent.root}-sibling`],
]) {
  test(`${name} OWNED_TEMP_DIR cannot defer registration`, t => {
    const parent = lease(t);
    const proof = options(parent.root);
    const error = registrationFailure();
    assertRejectedWithoutResidue(
      proof,
      {
        ownedTempDir: parentValue(parent, proof),
        registerImpl: failedRegistration(error),
      },
      error,
    );
    assert(error.deferredOwnershipFailure);
    assert(fs.existsSync(parent.marker));
  });
}

for (const [name, markerFields] of [
  ['unknown version', { version: 2 }],
  ['another path', { path: '/private/tmp/another-lease' }],
  ['missing owner', { owner_pid: '' }],
  ['invalid owner', { owner_pid: -1 }],
  ['invalid creation', { created_epoch: 'bad' }],
  ['invalid expiry', { expires_epoch: 1 }],
  ['future creation', { created_epoch: Math.floor(Date.now() / 1000) + 7200 }],
]) {
  test(`${name} enclosing marker cannot defer registration`, t => {
    const parent = lease(t, markerFields);
    const markerBefore = fs.readFileSync(parent.marker);
    const error = registrationFailure();
    assertRejectedWithoutResidue(
      options(parent.root),
      { ownedTempDir: parent.root, registerImpl: failedRegistration(error) },
      error,
    );
    assert(error.deferredOwnershipFailure);
    assert.deepEqual(fs.readFileSync(parent.marker), markerBefore);
  });
}

test('missing and symlink enclosing markers cannot defer registration', t => {
  for (const symlink of [false, true]) {
    const parent = lease(t);
    const markerCopy = path.join(parent.root, 'marker-copy');
    fs.renameSync(parent.marker, markerCopy);
    if (symlink) fs.symlinkSync(markerCopy, parent.marker);
    const error = registrationFailure();
    assertRejectedWithoutResidue(
      options(parent.root),
      { ownedTempDir: parent.root, registerImpl: failedRegistration(error) },
      error,
    );
    assert(fs.existsSync(markerCopy));
  }
});

test('symlink enclosing paths and intermediate paths cannot authorize deferral', t => {
  const parent = lease(t);
  const sibling = ownedDirectory(t);
  const link = path.join(sibling, 'enclosing-link');
  fs.symlinkSync(parent.root, link);
  const error = registrationFailure();
  assertRejectedWithoutResidue(
    options(parent.root),
    { ownedTempDir: link, registerImpl: failedRegistration(error) },
    error,
  );
  const intermediate = path.join(parent.root, 'nested');
  fs.symlinkSync(sibling, intermediate);
  const throughLink = options(parent.root, {
    workDir: path.join(intermediate, 'react-rsc'),
  });
  assert.throws(
    () =>
      registerOwnedRoot(throughLink, {
        ownedTempDir: parent.root,
        registerImpl: () =>
          assert.fail('Nonphysical proof root cannot register'),
      }),
    /physical/u,
  );
  assert(!fs.existsSync(path.join(sibling, 'react-rsc')));
  assert(fs.lstatSync(intermediate).isSymbolicLink());
});

test('foreign and uninspectable live owners cannot defer registration', t => {
  for (const ownerSnapshotImpl of [
    pid => `${pid} ${process.getuid() + 1} S\n`,
    pid => `${pid} ${process.getuid()} Z\n`,
    pid => `${pid} ${process.getuid()} ?\n`,
    pid => `${pid} ${process.getuid()} S`,
    () => {
      throw new Error('Process ownership unavailable');
    },
  ]) {
    const parent = lease(t);
    const error = registrationFailure();
    assertRejectedWithoutResidue(
      options(parent.root),
      {
        ownedTempDir: parent.root,
        registerImpl: failedRegistration(error),
        ownerSnapshotImpl,
      },
      error,
    );
    assert(error.deferredOwnershipFailure);
  }
});

test('the supplied owner is inspected independently from the enclosing lease owner', t => {
  const parent = lease(t, { owner_pid: process.ppid });
  const error = registrationFailure();
  const inspected = [];
  assertRejectedWithoutResidue(
    options(parent.root),
    {
      ownedTempDir: parent.root,
      registerImpl: failedRegistration(error),
      ownerSnapshotImpl: pid => {
        inspected.push(pid);
        return `${pid} ${process.getuid() + (pid === process.pid ? 1 : 0)} S\n`;
      },
    },
    error,
  );
  assert.deepEqual(inspected, [process.ppid, process.pid]);
});

for (const targetName of ['root', 'marker']) {
  test(`a foreign-UID enclosing ${targetName} cannot defer registration`, t => {
    const parent = lease(t);
    const error = registrationFailure();
    const original = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', target => {
      const stat = original(target);
      if (target !== parent[targetName]) return stat;
      return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
        uid: process.getuid() + 1,
      });
    });
    assertRejectedWithoutResidue(
      options(parent.root),
      { ownedTempDir: parent.root, registerImpl: failedRegistration(error) },
      error,
    );
    assert(error.deferredOwnershipFailure);
  });
}

test('a dead enclosing lease owner cannot defer registration', t => {
  const child = spawnSync(process.execPath, ['-e', ''], { timeout: 5000 });
  assert.equal(child.status, 0);
  const parent = lease(t, { owner_pid: child.pid });
  const error = registrationFailure();
  assertRejectedWithoutResidue(
    options(parent.root),
    { ownedTempDir: parent.root, registerImpl: failedRegistration(error) },
    error,
  );
  assert(error.deferredOwnershipFailure);
});

test('a dead supplied owner fails before creating proof resources', t => {
  const parent = lease(t);
  const child = spawnSync(process.execPath, ['-e', ''], { timeout: 5000 });
  assert.equal(child.status, 0);
  const proof = options(parent.root, { ownerPid: child.pid });
  assert.throws(
    () =>
      registerOwnedRoot(proof, {
        registerImpl: () => assert.fail('A dead owner cannot register'),
      }),
    { code: 'ESRCH' },
  );
  assert(!fs.existsSync(proof.workDir));
});

test('rejected registration preserves existing proof roots, markers and evidence', t => {
  const parent = lease(t);
  const proof = options(parent.root);
  fs.mkdirSync(proof.workDir);
  const proofMarker = path.join(proof.workDir, markerName);
  fs.writeFileSync(proofMarker, `${proof.owner}\n`);
  const error = registrationFailure({ status: 2 });
  assert.throws(
    () => registerOwnedRoot(proof, { registerImpl: failedRegistration(error) }),
    rejected => rejected === error,
  );
  assert.equal(fs.readFileSync(proofMarker, 'utf8'), `${proof.owner}\n`);
  fs.writeFileSync(path.join(proof.workDir, 'receipt.json'), '{}');
  assert.throws(
    () =>
      registerOwnedRoot(proof, {
        registerImpl: () => assert.fail('Prior evidence cannot register'),
      }),
    /prior evidence is immutable/u,
  );
  assert.equal(
    fs.readFileSync(path.join(proof.workDir, 'receipt.json'), 'utf8'),
    '{}',
  );
  fs.unlinkSync(path.join(proof.workDir, 'receipt.json'));
  fs.writeFileSync(proofMarker, 'another-owner\n');
  assert.throws(
    () =>
      registerOwnedRoot(proof, {
        registerImpl: () => assert.fail('A foreign marker cannot register'),
      }),
    { name: 'AssertionError' },
  );
  assert.equal(fs.readFileSync(proofMarker, 'utf8'), 'another-owner\n');
});

test('rollback preserves the primary registration error when a created root gains data', t => {
  const parent = lease(t);
  const proof = options(parent.root);
  const error = registrationFailure({ status: 2 });
  assert.throws(
    () =>
      registerOwnedRoot(proof, {
        registerImpl: () => {
          fs.writeFileSync(
            path.join(proof.workDir, 'retained-evidence'),
            'retain',
          );
          throw error;
        },
      }),
    rejected => rejected === error,
  );
  assert(!fs.existsSync(path.join(proof.workDir, markerName)));
  assert.equal(
    fs.readFileSync(path.join(proof.workDir, 'retained-evidence'), 'utf8'),
    'retain',
  );
  assert.equal(error.cleanupErrors.length, 1);
  assert.equal(error.cleanupErrors[0].path, proof.workDir);
});
