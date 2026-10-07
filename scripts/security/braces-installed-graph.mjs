import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseAllDocuments } from 'yaml';
import { parsePnpmLockfile } from '../lib/parse-pnpm-lockfile.mjs';

const fields = ['dependencies', 'optionalDependencies'];
const identity = 'braces@3.0.3';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value =>
  value && typeof value === 'object' && !Array.isArray(value);
const sorted = values =>
  [...values].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );

function within(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function packageIdentity(key) {
  const match = /^(@[^/]+\/[^@]+|[^@]+)@([^()]+)/u.exec(key);
  assert.ok(match, `Unsupported raw package identity: ${key}`);
  return { name: match[1], version: match[2] };
}

function snapshotKey(name, version) {
  assert.equal(
    typeof version,
    'string',
    `Missing raw dependency version for ${name}`,
  );
  return /^\d/u.test(version) ? `${name}@${version}` : version;
}

function yamlDocuments(source, label) {
  return parseAllDocuments(source).map(document => {
    assert.equal(
      document.errors.length,
      0,
      `Invalid ${label}: ${document.errors[0]?.message}`,
    );
    const value = document.toJS();
    assert.ok(record(value), `Expected ${label} mapping`);
    return value;
  });
}

/** Prove the repository's raw production graph uses the authenticated patched payload. */
export function inspectInstalledBracesGraph({
  root,
  expectedIntegrity,
  patchSha256,
  referenceFiles,
}) {
  assert.equal(typeof root, 'string', 'Expected repository root');
  assert.match(
    expectedIntegrity,
    /^sha512-[A-Za-z0-9+/]+={0,2}$/u,
    'Expected authenticated braces integrity',
  );
  assert.match(
    patchSha256,
    /^[a-f0-9]{64}$/u,
    'Expected canonical braces patch hash',
  );
  assert.ok(
    referenceFiles instanceof Map && referenceFiles.size > 0,
    'Expected authenticated braces reference files',
  );
  const reference = new Map();
  for (const [name, bytes] of referenceFiles) {
    assert.ok(
      typeof name === 'string' &&
        name !== '' &&
        !name.includes('\\') &&
        !path.posix.isAbsolute(name) &&
        name
          .split('/')
          .every(part => part !== '' && part !== '.' && part !== '..'),
      `Unsafe reference file: ${name}`,
    );
    assert.ok(
      Buffer.isBuffer(bytes) || bytes instanceof Uint8Array,
      `Expected reference bytes for ${name}`,
    );
    reference.set(name, Buffer.from(bytes));
  }
  const referenceManifest = JSON.parse(
    reference.get('package.json')?.toString('utf8') ?? 'null',
  );
  assert.equal(
    referenceManifest?.name,
    'braces',
    'Reference package must retain its upstream name',
  );
  assert.equal(
    referenceManifest?.version,
    '3.0.3',
    'Reference package must retain its upstream version',
  );
  const repository = fs.realpathSync(root);
  const observed = new Map();
  const resolutions = new Map();
  const payloads = new Map();
  const statIdentity = stat =>
    [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(
      String,
    );
  const pathState = file => {
    const stat = fs.lstatSync(file, { bigint: true });
    return {
      stat: statIdentity(stat),
      link: stat.isSymbolicLink() ? fs.readlinkSync(file) : null,
    };
  };
  const observeDirectory = directory => {
    const stat = fs.lstatSync(directory, { bigint: true });
    assert.ok(
      stat.isDirectory() && !stat.isSymbolicLink(),
      `Expected physical directory: ${directory}`,
    );
    // Directory contents can change independently; payload sets and dependency resolution are checked below.
    const next = {
      directory: [String(stat.dev), String(stat.ino), String(stat.mode)],
    };
    if (observed.has(directory))
      assert.deepEqual(
        observed.get(directory),
        next,
        `Directory changed during graph inspection: ${directory}`,
      );
    observed.set(directory, next);
  };
  const read = file => {
    assert.ok(within(repository, file), `File escaped repository: ${file}`);
    const state = pathState(file);
    assert.equal(
      state.link,
      null,
      `Expected regular file, not symbolic link: ${file}`,
    );
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    let bytes;
    try {
      const before = fs.fstatSync(fd, { bigint: true });
      assert.ok(before.isFile(), `Expected regular file: ${file}`);
      assert.deepEqual(
        statIdentity(before),
        state.stat,
        `File changed while opening: ${file}`,
      );
      bytes = fs.readFileSync(fd);
      assert.deepEqual(
        statIdentity(fs.fstatSync(fd, { bigint: true })),
        state.stat,
        `File changed while reading: ${file}`,
      );
    } finally {
      fs.closeSync(fd);
    }
    const next = { ...state, sha256: digest(bytes) };
    if (observed.has(file))
      assert.deepEqual(
        observed.get(file),
        next,
        `File changed during graph inspection: ${file}`,
      );
    observed.set(file, next);
    return bytes;
  };
  observeDirectory(repository);
  const lockSource = read(path.join(repository, 'pnpm-lock.yaml')).toString(
    'utf8',
  );
  const workspaceDocuments = yamlDocuments(
    read(path.join(repository, 'pnpm-workspace.yaml')).toString('utf8'),
    'workspace',
  );
  assert.equal(workspaceDocuments.length, 1, 'Expected one workspace document');
  const workspace = workspaceDocuments[0];
  const patchPath = workspace.patchedDependencies?.[identity];
  assert.equal(
    typeof patchPath,
    'string',
    'Workspace must register the exact braces patch',
  );
  assert.ok(
    !path.isAbsolute(patchPath) && !patchPath.includes('\\'),
    'Unsafe braces patch path',
  );
  const patchFile = path.resolve(repository, patchPath);
  assert.ok(
    within(repository, patchFile) && fs.realpathSync(patchFile) === patchFile,
    'Braces patch escaped its physical repository',
  );
  assert.equal(
    digest(read(patchFile)),
    patchSha256,
    'Canonical braces patch bytes differ',
  );
  const lock = parsePnpmLockfile(lockSource);
  assert.ok(
    record(lock?.importers) &&
      record(lock?.packages) &&
      record(lock?.snapshots),
    'Expected complete pnpm lock graph',
  );
  assert.equal(
    lock.patchedDependencies?.[identity],
    patchSha256,
    'Lock must register the exact braces patch hash',
  );
  const expectedSnapshot = `${identity}(patch_hash=${patchSha256})`;
  const assertBracesReference = key => {
    if (key.startsWith('braces@')) {
      assert.ok(
        key === expectedSnapshot || key.startsWith(`${expectedSnapshot}(`),
        `Unpatched or unexpected braces snapshot: ${key}`,
      );
    }
    for (const match of key.matchAll(/\(braces@/gu)) {
      assert.ok(
        key.slice(match.index + 1).startsWith(`${expectedSnapshot})`) ||
          key.slice(match.index + 1).startsWith(`${expectedSnapshot}(`),
        `Unpatched braces peer context: ${key}`,
      );
    }
  };
  const documents = yamlDocuments(lockSource, 'lockfile');
  const mergedRecords = new Map();
  let bracesRecords = 0;
  for (const document of documents) {
    for (const section of ['packages', 'snapshots']) {
      for (const [key, value] of Object.entries(document[section] ?? {})) {
        const context = `${section}:${key}`;
        if (mergedRecords.has(context))
          assert.deepEqual(
            value,
            mergedRecords.get(context),
            `Conflicting raw lock record: ${context}`,
          );
        mergedRecords.set(context, value);
        if (section === 'packages' && key.startsWith('braces@')) {
          bracesRecords += 1;
          assert.equal(
            key,
            identity,
            `Unexpected braces package record: ${key}`,
          );
          assert.equal(
            value.resolution?.integrity,
            expectedIntegrity,
            'Braces upstream integrity differs',
          );
        } else if (section === 'snapshots') assertBracesReference(key);
      }
    }
    for (const section of ['importers', 'snapshots']) {
      for (const [parentKey, value] of Object.entries(
        document[section] ?? {},
      )) {
        for (const field of [
          ...fields,
          ...(section === 'importers' ? ['devDependencies'] : []),
        ]) {
          for (const [name, entry] of Object.entries(value[field] ?? {})) {
            const version = section === 'importers' ? entry.version : entry;
            const key = snapshotKey(name, version);
            if (name === 'braces')
              assert.ok(
                key.startsWith('braces@'),
                `Unexpected braces alias: ${parentKey} > ${key}`,
              );
            assertBracesReference(key);
            if (key.startsWith('braces@'))
              assert.ok(
                Object.hasOwn(lock.snapshots, key),
                `Missing raw braces snapshot: ${key}`,
              );
          }
        }
      }
    }
  }
  assert.ok(bracesRecords > 0, 'No braces package record was found');

  const nodes = new Map();
  const reverse = new Map();
  const importerId = importer => `importer:${importer}`;
  const snapshotId = key => `snapshot:${key}`;
  const importerDirectory = importer => {
    assert.ok(
      importer === '.' ||
        (typeof importer === 'string' &&
          !importer.includes('\\') &&
          !path.posix.isAbsolute(importer) &&
          path.posix.normalize(importer) === importer &&
          !importer.split('/').includes('..')),
      `Unsafe importer path: ${importer}`,
    );
    const directory = path.resolve(repository, importer);
    assert.ok(
      within(repository, directory),
      `Importer escaped repository: ${importer}`,
    );
    return directory;
  };
  const queue = Object.keys(lock.importers).map(importer => ({
    id: importerId(importer),
    importer,
  }));
  for (let position = 0; position < queue.length; position += 1) {
    const node = queue[position];
    if (nodes.has(node.id)) continue;
    const value =
      node.importer === undefined
        ? lock.snapshots[node.key]
        : lock.importers[node.importer];
    assert.ok(
      record(value),
      `Missing raw lock snapshot or importer: ${node.key ?? node.importer}`,
    );
    if (node.importer !== undefined) importerDirectory(node.importer);
    const edges = [];
    nodes.set(node.id, { ...node, edges });
    for (const field of fields) {
      for (const [dependencyKey, entry] of Object.entries(value[field] ?? {})) {
        const version = node.importer === undefined ? entry : entry.version;
        assert.equal(
          typeof version,
          'string',
          `Missing raw dependency version: ${node.id} > ${dependencyKey}`,
        );
        let child;
        if (version.startsWith('link:')) {
          // pnpm records importer links relative to the importer and snapshot peer links relative to the workspace.
          const linkedDirectory = path.resolve(
            node.importer === undefined
              ? repository
              : importerDirectory(node.importer),
            version.slice(5),
          );
          assert.ok(
            within(repository, linkedDirectory),
            `Workspace link escaped repository: ${version}`,
          );
          const importer =
            path
              .relative(repository, linkedDirectory)
              .split(path.sep)
              .join('/') || '.';
          assert.ok(
            Object.hasOwn(lock.importers, importer),
            `Missing linked importer: ${importer}`,
          );
          child = { id: importerId(importer), importer };
        } else {
          const key = snapshotKey(dependencyKey, version);
          assert.ok(
            Object.hasOwn(lock.snapshots, key),
            `Missing raw lock snapshot: ${key}`,
          );
          child = { id: snapshotId(key), key };
        }
        edges.push({ dependencyKey, child: child.id });
        const parents = reverse.get(child.id) ?? new Set();
        parents.add(node.id);
        reverse.set(child.id, parents);
        queue.push(child);
      }
    }
  }
  const relevant = new Set(
    [...nodes.values()]
      .filter(node => node.key?.startsWith('braces@'))
      .map(node => node.id),
  );
  const pending = [...relevant];
  for (let position = 0; position < pending.length; position += 1) {
    for (const parent of reverse.get(pending[position]) ?? []) {
      if (!relevant.has(parent)) {
        relevant.add(parent);
        pending.push(parent);
      }
    }
  }

  const manifest = directory => {
    assert.ok(
      within(repository, directory),
      `Installed package borrowed an external root: ${directory}`,
    );
    observeDirectory(directory);
    const value = JSON.parse(
      read(path.join(directory, 'package.json')).toString('utf8'),
    );
    assert.ok(
      record(value),
      `Missing installed package manifest: ${directory}`,
    );
    return value;
  };
  const resolveDependency = (parent, dependencyKey) => {
    assert.match(
      dependencyKey,
      /^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/u,
      `Unsafe dependency key: ${dependencyKey}`,
    );
    const paths = createRequire(
      path.join(parent, 'package.json'),
    ).resolve.paths(dependencyKey);
    assert.ok(
      Array.isArray(paths),
      `Unsupported dependency resolution: ${dependencyKey}`,
    );
    for (const directory of paths) {
      const logical = path.join(directory, dependencyKey);
      const stat = fs.lstatSync(logical, { throwIfNoEntry: false });
      if (!stat) continue;
      const physical = fs.realpathSync(logical);
      assert.ok(
        within(repository, logical) && within(repository, physical),
        `Installed dependency borrowed an external root: ${logical} > ${physical}`,
      );
      const state = { logical, physical, ...pathState(logical) };
      return state;
    }
    throw new Error(
      `Missing installed dependency: ${parent} > ${dependencyKey}`,
    );
  };
  const listPayload = directory => {
    const files = [];
    const walk = (current, prefix = '') => {
      for (const name of fs.readdirSync(current).sort()) {
        const file = path.join(current, name);
        const relative = prefix ? `${prefix}/${name}` : name;
        const stat = fs.lstatSync(file);
        assert.ok(
          !stat.isSymbolicLink(),
          `Braces payload contains a symbolic link: ${file}`,
        );
        if (stat.isDirectory()) {
          assert.ok(
            [...reference.keys()].some(key => key.startsWith(`${relative}/`)),
            `Unexpected braces payload directory: ${relative}`,
          );
          walk(file, relative);
        } else {
          assert.ok(
            stat.isFile(),
            `Braces payload is not a regular file: ${file}`,
          );
          files.push(relative);
        }
      }
    };
    walk(directory);
    return files.sort();
  };
  const targets = new Set();
  const identities = [];
  const physicalQueue = [...nodes.values()]
    .filter(node => node.importer !== undefined && relevant.has(node.id))
    .map(node => ({
      importer: node.importer,
      node,
      directory: importerDirectory(node.importer),
    }));
  const seen = new Set();
  for (let position = 0; position < physicalQueue.length; position += 1) {
    const current = physicalQueue[position];
    const physicalParent = fs.realpathSync(current.directory);
    assert.ok(
      within(repository, physicalParent),
      `Importer borrowed an external root: ${current.directory}`,
    );
    const visit = JSON.stringify([
      current.importer,
      current.node.id,
      physicalParent,
    ]);
    if (seen.has(visit)) continue;
    seen.add(visit);
    const parentManifest = manifest(physicalParent);
    for (const edge of current.node.edges) {
      if (!relevant.has(edge.child)) continue;
      assert.ok(
        [...fields, 'peerDependencies'].some(field =>
          Object.hasOwn(parentManifest[field] ?? {}, edge.dependencyKey),
        ),
        `Installed parent does not declare its lock dependency: ${physicalParent} > ${edge.dependencyKey}`,
      );
      const child = nodes.get(edge.child);
      const resolved = resolveDependency(physicalParent, edge.dependencyKey);
      const key = JSON.stringify([physicalParent, edge.dependencyKey]);
      if (resolutions.has(key))
        assert.deepEqual(
          resolutions.get(key).state,
          resolved,
          `Dependency resolution changed during inspection: ${key}`,
        );
      resolutions.set(key, {
        parent: physicalParent,
        dependencyKey: edge.dependencyKey,
        state: resolved,
      });
      const value = manifest(resolved.physical);
      if (child.importer !== undefined) {
        assert.equal(
          resolved.physical,
          fs.realpathSync(importerDirectory(child.importer)),
          `Installed workspace link differs from lock importer: ${child.importer}`,
        );
      } else {
        const expected = packageIdentity(child.key);
        assert.equal(
          value.name,
          expected.name,
          `Installed dependency name differs from raw snapshot: ${child.key}`,
        );
        const version = /^\d/u.test(expected.version)
          ? expected.version
          : lock.packages[child.key.split('(')[0]]?.version;
        assert.equal(
          typeof version,
          'string',
          `Missing lock package version: ${child.key}`,
        );
        assert.equal(
          value.version,
          version,
          `Installed dependency version differs from raw snapshot: ${child.key}`,
        );
      }
      identities.push({
        importer: current.importer,
        rawparentkey: current.node.key ?? `importer:${current.node.importer}`,
        dependencyKey: edge.dependencyKey,
        physicalparent: physicalParent,
        physicaltarget: resolved.physical,
        name: value.name ?? null,
        version: value.version ?? null,
        snapshot: child.key ?? `importer:${child.importer}`,
      });
      if (value.name === 'braces') {
        targets.add(resolved.physical);
        if (!payloads.has(resolved.physical)) {
          const files = listPayload(resolved.physical);
          assert.deepEqual(
            files,
            [...reference.keys()].sort(),
            `Installed braces payload file set differs: ${resolved.physical}`,
          );
          for (const file of files)
            assert.ok(
              read(path.join(resolved.physical, file)).equals(
                reference.get(file),
              ),
              `Installed braces payload bytes differ: ${resolved.physical}/${file}`,
            );
          payloads.set(resolved.physical, files);
        }
      }
      physicalQueue.push({
        importer: current.importer,
        node: child,
        directory: resolved.physical,
      });
    }
  }
  assert.ok(
    targets.size > 0,
    'No installed production consumer reaches patched braces',
  );
  const assertUnchanged = () => {
    for (const [file, expected] of observed) {
      if (expected.directory) {
        const stat = fs.lstatSync(file, { bigint: true });
        assert.ok(
          stat.isDirectory() && !stat.isSymbolicLink(),
          `Observed directory changed: ${file}`,
        );
        assert.deepEqual(
          [String(stat.dev), String(stat.ino), String(stat.mode)],
          expected.directory,
          `Observed directory identity changed: ${file}`,
        );
      } else {
        assert.deepEqual(
          pathState(file),
          { stat: expected.stat, link: expected.link },
          `Observed file identity changed: ${file}`,
        );
        assert.equal(
          digest(read(file)),
          expected.sha256,
          `Observed file bytes changed: ${file}`,
        );
      }
    }
    for (const { parent, dependencyKey, state } of resolutions.values())
      assert.deepEqual(
        resolveDependency(parent, dependencyKey),
        state,
        `Installed dependency edge changed: ${parent} > ${dependencyKey}`,
      );
    for (const [directory, files] of payloads)
      assert.deepEqual(
        listPayload(directory),
        files,
        `Installed braces payload file set changed: ${directory}`,
      );
  };
  assertUnchanged();
  return {
    targets: [...targets].sort(),
    identities: sorted(identities),
    digests: [...observed]
      .filter(([, value]) => value.sha256 !== undefined)
      .map(([file, value]) => ({ path: file, sha256: value.sha256 }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    assertUnchanged,
  };
}
