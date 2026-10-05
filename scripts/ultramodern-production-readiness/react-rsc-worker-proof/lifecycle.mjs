import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const maintenanceLockReason = 'another maintenance operation holds the lock';
const markerName = '.disk-guardian-owner';

function maintenanceLockFailure(error) {
  if (error.status !== 1 || error.signal || error.stderr?.toString().trim())
    return false;
  if (typeof error.stdout !== 'string' && !Buffer.isBuffer(error.stdout))
    return false;
  try {
    const result = JSON.parse(error.stdout.toString());
    return (
      result !== null &&
      !Array.isArray(result) &&
      result.status === 'failed' &&
      result.reason === maintenanceLockReason
    );
  } catch {
    return false;
  }
}

const ownerSnapshot = pid =>
  execFileSync(
    '/bin/ps',
    ['-p', String(pid), '-o', 'pid=', '-o', 'uid=', '-o', 'stat='],
    {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      timeout: 5000,
    },
  );

function inspectOwnerProcess(pid, snapshotImpl) {
  process.kill(pid, 0);
  const output = snapshotImpl(pid);
  assert(
    typeof output === 'string' && output.endsWith('\n'),
    'Incomplete lease owner inspection',
  );
  const fields = output.trim().split(/\s+/u);
  assert.equal(fields.length, 3, 'Owned temporary lease owner is unavailable');
  assert.equal(fields[0], String(pid), 'Owned temporary lease owner changed');
  assert(/^-?(?:0|[1-9]\d*)$/u.test(fields[1]) && fields[1] !== '-0');
  const printedUid = Number(fields[1]);
  assert(
    Number.isSafeInteger(printedUid) &&
      printedUid >= -0x8000_0000 &&
      printedUid <= 0xffff_ffff,
  );
  // Darwin ps formats its unsigned uid_t as a signed integer.
  const uid = printedUid < 0 ? printedUid + 0x1_0000_0000 : printedUid;
  assert(
    /^[DHIRSTU][A-Za-z+<>-]*$/u.test(fields[2]),
    'Lease owner is not live',
  );
  return { uid };
}

function ordinaryOwnedDirectory(directory, uid) {
  const stat = fs.lstatSync(directory);
  assert(
    stat.isDirectory(),
    `Owned temporary path is not ordinary: ${directory}`,
  );
  assert.equal(
    stat.uid,
    uid,
    `Owned temporary path has a foreign owner: ${directory}`,
  );
  assert.equal(
    fs.realpathSync(directory),
    directory,
    'Owned temporary path must be physical',
  );
  return stat;
}

function enclosingLease(options, ownedTempDir, ownerSnapshotImpl) {
  const uid = process.getuid();
  assert(
    typeof ownedTempDir === 'string' && path.isAbsolute(ownedTempDir),
    'Registration deferral requires an absolute OWNED_TEMP_DIR',
  );
  const parent = path.resolve(ownedTempDir);
  assert.equal(parent, ownedTempDir, 'OWNED_TEMP_DIR must be canonical');
  assert(
    parent.startsWith('/private/tmp/') ||
      /^\/private\/var\/folders\/.+\/T\/.+/u.test(parent),
    'Registration deferral requires an owned temporary lease',
  );
  const parentStat = ordinaryOwnedDirectory(parent, uid);
  const relative = path.relative(parent, options.workDir);
  assert(
    relative && relative !== '..' && !relative.startsWith(`..${path.sep}`),
    'Proof root must be a proper descendant of OWNED_TEMP_DIR',
  );
  const parts = relative.split(path.sep);
  for (let index = 0; index < parts.length; index += 1)
    ordinaryOwnedDirectory(
      path.join(parent, ...parts.slice(0, index + 1)),
      uid,
    );

  const marker = path.join(parent, markerName);
  const markerStat = fs.lstatSync(marker);
  assert(markerStat.isFile(), 'Owned temporary lease marker must be ordinary');
  assert.equal(
    markerStat.uid,
    uid,
    'Owned temporary lease marker has a foreign owner',
  );
  const fields = new Map();
  for (const line of fs.readFileSync(marker, 'utf8').trimEnd().split('\n')) {
    const separator = line.indexOf('=');
    assert(separator > 0, 'Invalid owned temporary lease marker');
    const key = line.slice(0, separator);
    assert(!fields.has(key), 'Duplicate owned temporary lease marker field');
    fields.set(key, line.slice(separator + 1));
  }
  assert.equal(fields.size, 5, 'Invalid owned temporary lease marker fields');
  assert.equal(fields.get('version'), '1', 'Unsupported owned temporary lease');
  assert.equal(
    fields.get('path'),
    parent,
    'Owned temporary lease path changed',
  );
  const positiveInteger = key => {
    const value = fields.get(key);
    assert(/^[1-9]\d*$/u.test(value), `Invalid lease ${key}`);
    const parsed = Number(value);
    assert(Number.isSafeInteger(parsed), `Invalid lease ${key}`);
    return parsed;
  };
  const leaseOwnerPid = positiveInteger('owner_pid');
  const created = positiveInteger('created_epoch');
  const expires = positiveInteger('expires_epoch');
  assert(
    created < expires && created <= Math.floor(Date.now() / 1000),
    'Invalid lease lifetime',
  );
  for (const pid of new Set([leaseOwnerPid, options.ownerPid]))
    assert.equal(
      inspectOwnerProcess(pid, ownerSnapshotImpl).uid,
      uid,
      'Owned temporary lease requires a live same-UID owner',
    );
  const current = ordinaryOwnedDirectory(parent, uid);
  assert.equal(
    current.dev,
    parentStat.dev,
    'Owned temporary lease device changed',
  );
  assert.equal(
    current.ino,
    parentStat.ino,
    'Owned temporary lease directory changed',
  );
  return { root: parent, ownerPid: leaseOwnerPid };
}

export function registerOwnedRoot(
  options,
  {
    registerImpl = execFileSync,
    ownedTempDir = process.env.OWNED_TEMP_DIR,
    ownerSnapshotImpl = ownerSnapshot,
  } = {},
) {
  assert(Number.isSafeInteger(options.ownerPid) && options.ownerPid > 0);
  process.kill(options.ownerPid, 0);
  assert(
    path.isAbsolute(options.workDir),
    'Proof work directory must be absolute',
  );
  assert.equal(
    path.resolve(options.workDir),
    options.workDir,
    'Proof work directory must be canonical',
  );
  const rootExisted = fs.existsSync(options.workDir);
  fs.mkdirSync(options.workDir, { recursive: true });
  const rootIdentity = fs.lstatSync(options.workDir);
  const marker = path.join(options.workDir, markerName);
  const markerExisted = fs.existsSync(marker);
  let markerIdentity;
  try {
    ordinaryOwnedDirectory(options.workDir, process.getuid());
    assert(
      fs.readdirSync(options.workDir).every(name => name === markerName),
      'Proof work directory must be new and empty; prior evidence is immutable',
    );
    if (markerExisted) {
      const existingMarker = fs.lstatSync(marker);
      assert(existingMarker.isFile(), 'Proof owner marker must be ordinary');
      assert.equal(
        existingMarker.uid,
        process.getuid(),
        'Proof owner marker has a foreign owner',
      );
      assert.equal(fs.readFileSync(marker, 'utf8').trim(), options.owner);
    } else {
      fs.writeFileSync(marker, `${options.owner}\n`, { flag: 'wx' });
      markerIdentity = fs.lstatSync(marker);
    }
    const isTemp =
      options.workDir.startsWith('/private/tmp/') ||
      options.workDir.startsWith('/private/var/folders/');
    try {
      registerImpl(
        'disk-guardian-artifacts',
        [
          'register',
          '--owner',
          options.owner,
          '--kind',
          isTemp ? 'temp' : 'build',
          '--owner-pid',
          String(options.ownerPid),
          options.workDir,
        ],
        { stdio: 'pipe' },
      );
      return { status: 'registered' };
    } catch (error) {
      if (!maintenanceLockFailure(error)) throw error;
      try {
        const lease = enclosingLease(options, ownedTempDir, ownerSnapshotImpl);
        return {
          status: 'deferred',
          reason: maintenanceLockReason,
          enclosingLease: lease,
        };
      } catch (ownershipError) {
        error.deferredOwnershipFailure = {
          name: ownershipError.name,
          message: ownershipError.message,
        };
        throw error;
      }
    }
  } catch (error) {
    for (const [target, identity, remove] of [
      ...(markerIdentity ? [[marker, markerIdentity, fs.unlinkSync]] : []),
      ...(!rootExisted ? [[options.workDir, rootIdentity, fs.rmdirSync]] : []),
    ]) {
      try {
        const current = fs.lstatSync(target);
        assert(
          ['dev', 'ino', 'uid', 'mode'].every(
            key => current[key] === identity[key],
          ),
          `Created proof resource identity changed: ${target}`,
        );
        remove(target);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          error.cleanupErrors ??= [];
          error.cleanupErrors.push({
            path: target,
            message: cleanupError.message,
          });
        }
      }
    }
    throw error;
  }
}
