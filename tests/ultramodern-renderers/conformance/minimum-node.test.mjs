import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  inspectNodeArchive,
  prepareMinimumNode,
} from '../../../scripts/ultramodern-renderers/acceptance/minimum-node.mjs';

const version = '26.7.0';
const root = `node-v${version}-${process.platform}-${process.arch}`;
const archiveName = `${root}.tar.gz`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function archive(entries) {
  return gzipSync(
    Buffer.concat([
      ...entries.flatMap(entry => {
        const header = Buffer.alloc(512);
        const content = Buffer.from(entry.content ?? '');
        header.write(entry.path, 0, 100);
        header.write('0000755\0', 100, 8);
        header.write('0000000\0', 108, 8);
        header.write('0000000\0', 116, 8);
        header.write(
          `${content.length.toString(8).padStart(11, '0')}\0`,
          124,
          12,
        );
        header.write('00000000000\0', 136, 12);
        header.fill(32, 148, 156);
        header.write(entry.type ?? '0', 156, 1);
        if (entry.target) header.write(entry.target, 157, 100);
        header.write('ustar\0', 257, 6);
        const checksum = header.reduce((sum, byte) => sum + byte, 0);
        header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
        return [
          header,
          content,
          Buffer.alloc((512 - (content.length % 512)) % 512),
        ];
      }),
      Buffer.alloc(1024),
    ]),
  );
}

function unitArchive(reportedVersion = version) {
  // A local shell executable tests ownership/extraction only, never actual Node support.
  return archive([
    {
      path: `${root}/bin/node`,
      content: `#!/bin/sh\nprintf '%s\\n' '${reportedVersion}'\n`,
    },
  ]);
}

async function ownedInput(t, bytes = unitArchive()) {
  const ownerRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'minimum-node-unit-'),
  );
  t.after(() => fs.rm(ownerRoot, { recursive: true, force: true }));
  const events = [];
  return {
    events,
    bytes,
    input: {
      version,
      ownedDirectory: path.join(ownerRoot, 'exclusive-distribution'),
      owner: 'minimum-node-unit',
      lifecycle: {
        register: async (...args) => {
          events.push(['register', ...args]);
        },
        release: async (...args) => {
          events.push(['release', ...args]);
        },
      },
      fetch: async url =>
        new Response(
          url.endsWith('SHASUMS256.txt')
            ? `${hash(bytes)}  ${archiveName}\n`
            : bytes,
        ),
    },
  };
}

test('minimum distribution validates official URLs/checksum and releases only its exclusive owned path', async t => {
  const { input, events, bytes } = await ownedInput(t);
  const urls = [];
  const fetch = input.fetch;
  input.fetch = async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, 'error');
    return fetch(url);
  };
  const globalExecutable = process.execPath;
  const result = await prepareMinimumNode(input);
  assert.equal(result.version, version);
  assert.equal(result.archiveSha256, hash(bytes));
  assert.deepEqual(urls, [
    `https://nodejs.org/dist/v${version}/SHASUMS256.txt`,
    `https://nodejs.org/dist/v${version}/${archiveName}`,
  ]);
  assert.equal(result.inventory.entryCount, 1);
  assert.equal(process.execPath, globalExecutable);
  assert.equal(events[0][0], 'register');
  assert.equal(events[0][4], process.pid);
  assert.equal(result.ownerPid, process.pid);
  await result.dispose();
  await result.dispose();
  assert.equal(events.filter(event => event[0] === 'release').length, 1);
  await assert.rejects(fs.stat(input.ownedDirectory), /ENOENT/u);
});

test('minimum runtime handoff records the explicit owning process and rejects invalid owners before creation', async t => {
  const { input, events } = await ownedInput(t);
  input.ownerPid = 17970;
  const result = await prepareMinimumNode(input);
  assert.equal(events[0][4], 17970);
  assert.equal(result.ownerPid, 17970);
  await result.dispose();
  for (const ownerPid of [0, -1, 1.5, '17970']) {
    await assert.rejects(
      prepareMinimumNode({ ...input, ownerPid }),
      /exclusive owned distribution path/u,
    );
    await assert.rejects(fs.stat(input.ownedDirectory), /ENOENT/u);
  }
});

test('checksum ambiguity, changed bytes and wrong runtime version clean the newly owned distribution', async t => {
  for (const mode of ['ambiguous', 'mismatch', 'version']) {
    const { input, events, bytes } = await ownedInput(
      t,
      unitArchive(mode === 'version' ? '0.0.1' : version),
    );
    if (mode !== 'version')
      input.fetch = async url =>
        new Response(
          url.endsWith('SHASUMS256.txt')
            ? mode === 'ambiguous'
              ? `${hash(bytes)}  ${archiveName}\n${hash(bytes)}  ${archiveName}\n`
              : `${'0'.repeat(64)}  ${archiveName}\n`
            : bytes,
        );
    await assert.rejects(
      prepareMinimumNode(input),
      /checksum|SHA-256|minimum version/u,
    );
    assert.equal(events.filter(event => event[0] === 'release').length, 1);
    await assert.rejects(fs.stat(input.ownedDirectory), /ENOENT/u);
  }
});

test('an existing distribution and pre-aborted request remain untouched', async t => {
  const { input, events } = await ownedInput(t);
  await fs.mkdir(input.ownedDirectory);
  await fs.writeFile(
    path.join(input.ownedDirectory, 'preserve.txt'),
    'other-owner',
  );
  await assert.rejects(prepareMinimumNode(input), /EEXIST/u);
  assert.deepEqual(events, []);
  assert.equal(
    await fs.readFile(path.join(input.ownedDirectory, 'preserve.txt'), 'utf8'),
    'other-owner',
  );
  await assert.rejects(
    prepareMinimumNode({
      ...input,
      ownedDirectory: `${input.ownedDirectory}-aborted`,
      signal: AbortSignal.abort(new Error('unit cancellation')),
    }),
    /unit cancellation/u,
  );
  await assert.rejects(fs.stat(`${input.ownedDirectory}-aborted`), /ENOENT/u);
});

test('cancellation after registration still gets a separate live teardown signal', async t => {
  const { input, events } = await ownedInput(t);
  const controller = new AbortController();
  input.signal = controller.signal;
  input.lifecycle.register = async (directory, owner, signal) => {
    assert.equal(signal.aborted, false);
    events.push(['register', directory, owner]);
    controller.abort(new Error('unit cancellation after registration'));
  };
  input.lifecycle.release = async (directory, owner, signal) => {
    assert.equal(signal.aborted, false);
    events.push(['release', directory, owner]);
  };
  await assert.rejects(prepareMinimumNode(input), /unit cancellation/u);
  assert.equal(events.filter(event => event[0] === 'release').length, 1);
  await assert.rejects(fs.stat(input.ownedDirectory), /ENOENT/u);
});

test('archive paths, links, duplicates and special files are rejected before extraction', () => {
  const runtime = { path: `${root}/bin/node`, content: 'unit-executable' };
  assert.equal(
    inspectNodeArchive(
      archive([
        runtime,
        { path: `${root}/bin/link`, type: '2', target: 'node' },
      ]),
      root,
    ).entryCount,
    2,
  );
  for (const entry of [
    { path: `${root}/../../other-owner`, content: 'escape' },
    { path: `${root}/bin/link`, type: '2', target: '../../../other-owner' },
    { path: `${root}/bin/link`, type: '2', target: 'missing' },
    { path: `${root}/device`, type: '3' },
    runtime,
  ])
    assert.throws(
      () => inspectNodeArchive(archive([runtime, entry]), root),
      /Unsafe|escapes|absent|special|duplicate/u,
    );
});
