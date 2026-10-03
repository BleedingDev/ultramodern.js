import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const guardian = '/Users/satan/bin/disk-guardian-artifacts';

async function command(executable, args, signal = AbortSignal.timeout(15_000)) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let output = '';
    let errorOutput = '';
    let hardStop;
    let finished = false;
    const stop = strength => {
      try {
        if (child.pid) process.kill(-child.pid, strength);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const abort = () => {
      stop('SIGTERM');
      hardStop ??= setTimeout(() => stop('SIGKILL'), 250);
    };
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      clearTimeout(hardStop);
      stop('SIGKILL');
      if (error) reject(error);
      else resolve(value);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', bytes => {
      output += bytes;
    });
    child.stderr.on('data', bytes => {
      errorOutput += bytes;
    });
    child.once('error', error => finish(error));
    child.once('close', code =>
      finish(
        signal?.aborted
          ? signal.reason
          : code === 0
            ? undefined
            : new Error(
                `${executable} failed (${code}): ${`${errorOutput}\n${output}`.slice(-2000)}`,
              ),
        output.trim(),
      ),
    );
  });
}

const defaultLifecycle = {
  register: (directory, owner, signal, ownerPid) =>
    command(
      guardian,
      [
        'register',
        directory,
        '--owner',
        owner,
        '--owner-pid',
        String(ownerPid),
        '--grace-hours',
        '24',
        '--kind',
        'build',
      ],
      signal,
    ),
  release: async (directory, owner, signal = AbortSignal.timeout(15_000)) => {
    await command(guardian, ['release', directory, '--owner', owner], signal);
    await command(
      guardian,
      ['cleanup', '--only', directory, '--no-caches', '--apply'],
      signal,
    );
  },
};

function archivePath(value, root) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.split('/').includes('..')
  )
    throw new Error('Unsafe Node archive path');
  const normalized = path.posix.normalize(value).replace(/\/$/u, '');
  if (normalized !== root && !normalized.startsWith(`${root}/`))
    throw new Error(
      'Node archive entry escapes its expected distribution root',
    );
  return normalized;
}

function stringField(bytes) {
  return bytes
    .subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0))
    .toString('utf8');
}

function octal(bytes) {
  const value = stringField(bytes).trim();
  if (!/^[0-7]+$/u.test(value))
    throw new Error('Invalid Node archive numeric field');
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed))
    throw new Error('Oversized Node archive field');
  return parsed;
}

function paxRecords(bytes) {
  const values = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    const lengthText = bytes.subarray(offset, space).toString('ascii');
    const length = Number(lengthText);
    if (
      space < offset ||
      !/^\d+$/u.test(lengthText) ||
      !Number.isSafeInteger(length) ||
      length <= space - offset + 1 ||
      offset + length > bytes.length ||
      bytes[offset + length - 1] !== 10
    )
      throw new Error('Invalid Node archive PAX record');
    const record = bytes
      .subarray(space + 1, offset + length - 1)
      .toString('utf8');
    const equal = record.indexOf('=');
    if (equal < 1) throw new Error('Invalid Node archive PAX value');
    values[record.slice(0, equal)] = record.slice(equal + 1);
    offset += length;
  }
  if (values.size !== undefined)
    throw new Error('Node archive refuses PAX size overrides');
  if (
    Object.keys(values).some(
      key =>
        ![
          'path',
          'linkpath',
          'mtime',
          'atime',
          'ctime',
          'uid',
          'gid',
          'uname',
          'gname',
        ].includes(key),
    )
  )
    throw new Error(
      'Node archive refuses unsupported PAX extraction overrides',
    );
  return values;
}

/** Validate archive bytes before allowing the host tar utility to extract them. */
export function inspectNodeArchive(archive, root) {
  const bytes = gunzipSync(archive, { maxOutputLength: 512 * 1024 * 1024 });
  const entries = [];
  const names = new Set();
  let offset = 0;
  let pending = {};
  let global = {};
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (!bytes.subarray(offset).every(byte => byte === 0))
        throw new Error('Node archive has trailing unvalidated entries');
      break;
    }
    const checksum = octal(header.subarray(148, 156));
    const actual = header.reduce(
      (total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (actual !== checksum)
      throw new Error('Node archive header checksum mismatch');
    const size = octal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156]);
    const next = offset + 512 + Math.ceil(size / 512) * 512;
    if (next > bytes.length) throw new Error('Truncated Node archive');
    const content = bytes.subarray(offset + 512, offset + 512 + size);
    if (type === 'x' || type === 'g') {
      const attributes = paxRecords(content);
      if (type === 'g') {
        if (attributes.path || attributes.linkpath)
          throw new Error('Node archive refuses global path overrides');
        global = { ...global, ...attributes };
      } else pending = { ...pending, ...attributes };
    } else if (type === 'L' || type === 'K') {
      pending[type === 'L' ? 'path' : 'linkpath'] = stringField(
        content,
      ).replace(/\n$/u, '');
    } else {
      if (!['\0', '0', '1', '2', '5'].includes(type))
        throw new Error('Node archive contains a non-file special entry');
      const format = stringField(header.subarray(257, 263));
      if (!['ustar', 'ustar ', ''].includes(format))
        throw new Error('Node archive has an unsupported header format');
      const prefix =
        format === 'ustar' ? stringField(header.subarray(345, 500)) : '';
      const name = archivePath(
        pending.path ??
          global.path ??
          `${prefix ? `${prefix}/` : ''}${stringField(header.subarray(0, 100))}`,
        root,
      );
      if (names.has(name))
        throw new Error('Node archive contains a duplicate entry');
      names.add(name);
      const entry = { path: name, type, size };
      if (type === '1' || type === '2') {
        const link =
          pending.linkpath ??
          global.linkpath ??
          stringField(header.subarray(157, 257));
        if (!link || link.startsWith('/') || link.includes('\\'))
          throw new Error('Unsafe Node archive link');
        entry.target = archivePath(
          type === '1' ? link : path.posix.join(path.posix.dirname(name), link),
          root,
        );
      }
      entries.push(entry);
      pending = {};
    }
    offset = next;
  }
  if (
    !entries.length ||
    !entries.some(
      entry =>
        entry.path === `${root}/bin/node` && ['0', '\0'].includes(entry.type),
    ) ||
    Object.keys(pending).length
  )
    throw new Error('Node archive lacks its regular runtime executable');
  for (const entry of entries.filter(value => value.target))
    if (!names.has(entry.target))
      throw new Error('Node archive link target is absent');
  return {
    entryCount: entries.length,
    byteLength: bytes.length,
    inventorySha256: hash(JSON.stringify(entries)),
  };
}

async function download(url, fetch, signal, maximumBytes) {
  const response = await fetch(url, { signal, redirect: 'error' });
  if (!response.ok || !response.body)
    throw new Error(`Official Node download failed (${response.status})`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    signal.throwIfAborted();
    size += chunk.length;
    if (size > maximumBytes)
      throw new Error('Official Node download exceeded its bounded size');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Creates one exclusively owned distribution, with explicit idempotent disposal. */
export async function prepareMinimumNode({
  version,
  ownedDirectory,
  owner,
  ownerPid = process.pid,
  signal,
  fetch = globalThis.fetch,
  lifecycle = defaultLifecycle,
}) {
  if (
    !/^\d+\.\d+\.\d+$/u.test(version) ||
    !path.isAbsolute(ownedDirectory ?? '') ||
    typeof owner !== 'string' ||
    !owner ||
    !Number.isInteger(ownerPid) ||
    ownerPid <= 0 ||
    !['darwin', 'linux'].includes(process.platform) ||
    !['arm64', 'x64'].includes(process.arch)
  )
    throw new Error(
      'Minimum Node requires an exact version and exclusive owned distribution path',
    );
  const root = `node-v${version}-${process.platform}-${process.arch}`;
  const archiveName = `${root}.tar.gz`;
  const archiveSource = `https://nodejs.org/dist/v${version}/${archiveName}`;
  const checksumSource = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;
  const requestSignal = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(120_000),
  ]);
  requestSignal.throwIfAborted();
  await fs.mkdir(ownedDirectory);
  let registered = false;
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    try {
      if (registered)
        await lifecycle.release(
          ownedDirectory,
          owner,
          AbortSignal.timeout(15_000),
        );
    } finally {
      await fs.rm(ownedDirectory, { recursive: true, force: true });
    }
  };
  try {
    await lifecycle.register(ownedDirectory, owner, requestSignal, ownerPid);
    registered = true;
    const checksums = await download(
      checksumSource,
      fetch,
      requestSignal,
      1024 * 1024,
    );
    const matching = checksums
      .toString('utf8')
      .split(/\r?\n/u)
      .flatMap(line => {
        const match = /^([a-f\d]{64})\s+\*?(.+)$/u.exec(line);
        return match?.[2] === archiveName ? [match[1]] : [];
      });
    if (matching.length !== 1)
      throw new Error(
        'Official checksum does not uniquely name the selected Node distribution',
      );
    const archive = await download(
      archiveSource,
      fetch,
      requestSignal,
      128 * 1024 * 1024,
    );
    const archiveSha256 = hash(archive);
    if (archiveSha256 !== matching[0])
      throw new Error('Official Node distribution SHA-256 mismatch');
    const inventory = inspectNodeArchive(archive, root);
    const archiveFile = path.join(ownedDirectory, archiveName);
    await fs.writeFile(archiveFile, archive, { flag: 'wx' });
    await fs.writeFile(path.join(ownedDirectory, 'SHASUMS256.txt'), checksums, {
      flag: 'wx',
    });
    await command(
      '/usr/bin/tar',
      ['-xzf', archiveFile, '-C', ownedDirectory],
      requestSignal,
    );
    const executable = path.join(ownedDirectory, root, 'bin/node');
    const actualVersion = await command(
      executable,
      ['--print', 'process.versions.node'],
      requestSignal,
    );
    if (actualVersion !== version)
      throw new Error(
        'Extracted Node runtime does not report the selected minimum version',
      );
    return {
      executable,
      executableSha256: hash(await fs.readFile(executable)),
      version,
      archiveSource,
      checksumSource,
      archiveSha256,
      checksumFileSha256: hash(checksums),
      inventory,
      ownedDirectory,
      owner,
      ownerPid,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
