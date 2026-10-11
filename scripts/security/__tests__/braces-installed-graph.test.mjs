import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectInstalledBracesGraph } from '../braces-installed-graph.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
};
const writePackage = (directory, manifest, files = {}) => {
  writeJson(path.join(directory, 'package.json'), manifest);
  for (const [name, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    fs.writeFileSync(path.join(directory, name), bytes);
  }
};
const link = (target, dependency) => {
  fs.mkdirSync(path.dirname(dependency), { recursive: true });
  fs.symlinkSync(target, dependency, 'dir');
};

function fixture(t) {
  const temporary = fs.realpathSync(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'braces-installed-graph-',
      ),
    ),
  );
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'repository');
  fs.mkdirSync(root);
  const patch = Buffer.from('canonical repository braces correction\n');
  const patchSha256 = sha256(patch);
  const expectedIntegrity = `sha512-${createHash('sha512').update('authenticated braces tarball').digest('base64')}`;
  const bracesManifest = { name: 'braces', version: '3.0.3', main: 'index.js' };
  const referenceFiles = new Map([
    ['package.json', Buffer.from(JSON.stringify(bracesManifest, null, 2))],
    ['index.js', Buffer.from('module.exports = require("./lib/parse.js");\n')],
    ['lib/parse.js', Buffer.from('module.exports = input => input;\n')],
    ['LICENSE', Buffer.from('MIT\n')],
  ]);
  const patchedVersion = `3.0.3(patch_hash=${patchSha256})`;
  const contexts = [
    'micromatch@4.0.8(peer@1.0.0)',
    'micromatch@4.0.8(peer@2.0.0)',
  ];
  const braceContexts = [
    `braces@${patchedVersion}`,
    `braces@${patchedVersion}(peer@2.0.0)`,
  ];
  const importers = ['.', 'packages/app'];
  const parents = [];
  const targets = [];
  const parentLinks = [];
  const braceLinks = [];
  for (let i = 0; i < contexts.length; i += 1) {
    const directory = path.join(root, importers[i]);
    writePackage(directory, {
      name: i === 0 ? 'repository' : 'app',
      version: '1.0.0',
      [i === 0 ? 'dependencies' : 'optionalDependencies']: {
        'parent-alias': 'npm:micromatch@4.0.8',
      },
    });
    const parent = path.join(
      root,
      'node_modules/.pnpm',
      `arbitrary-parent-location-${i}`,
      'node_modules/micromatch',
    );
    writePackage(
      parent,
      {
        name: 'micromatch',
        version: '4.0.8',
        dependencies: { [i === 0 ? 'braces' : 'braces-alias']: '^3.0.3' },
      },
      { 'index.js': 'module.exports = {};\n' },
    );
    const target = path.join(
      root,
      'node_modules/.pnpm',
      `arbitrary-payload-location-${i}`,
      'node_modules/braces',
    );
    for (const [file, bytes] of referenceFiles) {
      fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
      fs.writeFileSync(path.join(target, file), bytes);
    }
    const parentLink = path.join(directory, 'node_modules/parent-alias');
    const braceLink = path.join(
      path.dirname(parent),
      i === 0 ? 'braces' : 'braces-alias',
    );
    link(parent, parentLink);
    link(target, braceLink);
    parents.push(parent);
    targets.push(target);
    parentLinks.push(parentLink);
    braceLinks.push(braceLink);
  }
  const lock = {
    lockfileVersion: '9.0',
    patchedDependencies: { 'braces@3.0.3': patchSha256 },
    importers: {
      '.': {
        dependencies: {
          'parent-alias': {
            specifier: 'npm:micromatch@4.0.8',
            version: contexts[0],
          },
        },
      },
      'packages/app': {
        optionalDependencies: {
          'parent-alias': {
            specifier: 'npm:micromatch@4.0.8',
            version: contexts[1],
          },
        },
      },
    },
    packages: {
      'micromatch@4.0.8': {},
      'braces@3.0.3': { resolution: { integrity: expectedIntegrity } },
    },
    snapshots: {
      [contexts[0]]: { dependencies: { braces: patchedVersion } },
      [contexts[1]]: {
        optionalDependencies: { 'braces-alias': braceContexts[1] },
      },
      [braceContexts[0]]: {},
      [braceContexts[1]]: {},
    },
  };
  const workspace = {
    packages: ['packages/*'],
    patchedDependencies: { 'braces@3.0.3': 'patches/braces.patch' },
  };
  const lockFile = path.join(root, 'pnpm-lock.yaml');
  const workspaceFile = path.join(root, 'pnpm-workspace.yaml');
  fs.mkdirSync(path.join(root, 'patches'));
  fs.writeFileSync(path.join(root, 'patches/braces.patch'), patch);
  const save = () => {
    writeJson(lockFile, lock);
    writeJson(workspaceFile, workspace);
  };
  save();
  const options = { root, expectedIntegrity, patchSha256, referenceFiles };
  return {
    ...options,
    options,
    temporary,
    lock,
    workspace,
    lockFile,
    workspaceFile,
    contexts,
    braceContexts,
    parents,
    targets,
    parentLinks,
    braceLinks,
    save,
    inspect: () => inspectInstalledBracesGraph(options),
  };
}

function addRemoteProductionBranch(f, protocol = 'https:') {
  const routerName = '@octanejs/tanstack-router';
  const routerUrl = `${protocol}//github.com/bleedingdev/octane/releases/download/%40octanejs%2Ftanstack-router%400.1.60%2Bultramodern.0b9f76ee3003/octanejs-tanstack-router-0.1.60%2Bultramodern.0b9f76ee3003.tgz`;
  const octaneUrl = `${protocol}//github.com/bleedingdev/octane/releases/download/octane%400.7.1%2Bultramodern.1331985ea3b0/octane-0.7.1%2Bultramodern.1331985ea3b0.tgz`;
  const octaneVersion = `${octaneUrl}(react-dom@19.3.0(react@19.3.0))(react@19.3.0)(typescript@7.0.2)(vite@8.3.2(@types/node@26.6.3)(esbuild@0.28.2)(jiti@2.7.0)(less@4.9.1(supports-color@10.2.2))(sass-embedded@1.105.1)(sass@1.105.1)(terser@5.51.2)(tsx@4.23.15)(yaml@2.9.1))`;
  const routerVersion = `${routerUrl}(octane@${octaneVersion})`;
  const routerSnapshot = `${routerName}@${routerVersion}`;
  const octaneSnapshot = `octane@${octaneVersion}`;
  const routerDirectory = path.join(f.root, 'node_modules/remote-router');
  const octaneDirectory = path.join(f.root, 'node_modules/remote-octane');
  writePackage(routerDirectory, {
    name: routerName,
    version: '0.1.60+ultramodern.0b9f76ee3003',
    dependencies: { octane: octaneUrl },
  });
  writePackage(octaneDirectory, {
    name: 'octane',
    version: '0.7.1+ultramodern.1331985ea3b0',
    dependencies: { 'parent-alias': 'npm:micromatch@4.0.8' },
  });
  link(routerDirectory, path.join(f.root, 'node_modules', routerName));
  link(routerDirectory, path.join(f.root, 'node_modules/router-alias'));
  link(octaneDirectory, path.join(routerDirectory, 'node_modules/octane'));
  link(f.parents[0], path.join(octaneDirectory, 'node_modules/parent-alias'));
  const manifestPath = path.join(f.root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  Object.assign(manifest.dependencies, {
    [routerName]: routerUrl,
    'router-alias': routerUrl,
    '@typescript/native': 'npm:typescript@7.0.2',
    '@rspack/core': '2.2.8',
  });
  writeJson(manifestPath, manifest);
  Object.assign(f.lock.importers['.'].dependencies, {
    [routerName]: { specifier: routerUrl, version: routerVersion },
    'router-alias': { specifier: routerUrl, version: routerSnapshot },
    '@typescript/native': {
      specifier: 'npm:typescript@7.0.2',
      version: 'typescript@7.0.2',
    },
    '@rspack/core': {
      specifier: '2.2.8',
      version:
        '2.2.8(@module-federation/runtime-tools@2.9.2)(@swc/helpers@0.5.23)',
    },
  });
  const octanePackage = `octane@${octaneUrl}`;
  f.lock.packages[`${routerName}@${routerUrl}`] = {
    version: '0.1.60+ultramodern.0b9f76ee3003',
  };
  f.lock.packages[octanePackage] = {
    version: '0.7.1+ultramodern.1331985ea3b0',
  };
  Object.assign(f.lock.snapshots, {
    [routerSnapshot]: { dependencies: { octane: octaneVersion } },
    [octaneSnapshot]: { dependencies: { 'parent-alias': f.contexts[0] } },
    'typescript@7.0.2': {},
    '@rspack/core@2.2.8(@module-federation/runtime-tools@2.9.2)(@swc/helpers@0.5.23)':
      {},
  });
  f.save();
  return { routerSnapshot, octaneSnapshot, octanePackage };
}

test('remote tarball snapshot references retain exact nested URL peer and native contexts', async t => {
  for (const protocol of ['https:', 'http:'])
    await t.test(protocol, subtest => {
      const f = fixture(subtest);
      const { routerSnapshot, octaneSnapshot } = addRemoteProductionBranch(
        f,
        protocol,
      );
      const proof = f.inspect();
      assert.deepEqual(proof.targets, [...f.targets].sort());
      const remote = proof.identities.filter(row =>
        ['@octanejs/tanstack-router', 'octane'].includes(row.name),
      );
      assert.deepEqual(
        new Set(remote.map(row => row.snapshot)),
        new Set([routerSnapshot, octaneSnapshot]),
      );
      assert.deepEqual(
        new Set(remote.map(row => row.dependencyKey)),
        new Set(['@octanejs/tanstack-router', 'router-alias', 'octane']),
      );
      proof.assertUnchanged();
    });
});

test('remote references cannot borrow another peer context or installed version', async t => {
  await t.test('missing exact nested context', subtest => {
    const f = fixture(subtest);
    const { octaneSnapshot, octanePackage } = addRemoteProductionBranch(f);
    delete f.lock.snapshots[octaneSnapshot];
    f.lock.snapshots[octanePackage] = {};
    f.save();
    assert.throws(f.inspect, /Missing raw lock snapshot: octane@https:/u);
  });
  await t.test('installed remote version differs', subtest => {
    const f = fixture(subtest);
    const { octanePackage } = addRemoteProductionBranch(f);
    f.lock.packages[octanePackage].version = '0.7.0';
    f.save();
    assert.throws(
      f.inspect,
      /Installed dependency version differs from raw snapshot: octane@https:/u,
    );
  });
});

test('raw aliases, optional paths and distinct patch/peer contexts resolve from each physical consumer', t => {
  const f = fixture(t);
  const proof = f.inspect();
  assert.deepEqual(proof.targets, [...f.targets].sort());
  const braces = proof.identities.filter(row => row.name === 'braces');
  assert.deepEqual(
    new Set(braces.map(row => row.rawparentkey)),
    new Set(f.contexts),
  );
  assert.deepEqual(
    new Set(braces.map(row => row.snapshot)),
    new Set(f.braceContexts),
  );
  assert.deepEqual(
    new Set(braces.map(row => row.dependencyKey)),
    new Set(['braces', 'braces-alias']),
  );
  assert.deepEqual(
    new Set(braces.map(row => row.physicalparent)),
    new Set(f.parents),
  );
  assert.ok(proof.digests.some(row => row.path === f.lockFile));
  assert.ok(proof.digests.some(row => row.path === f.workspaceFile));
  assert.ok(proof.digests.every(row => /^[a-f0-9]{64}$/u.test(row.sha256)));
  proof.assertUnchanged();
});

test('production workspace links use their installed target and retain the originating importer', t => {
  const f = fixture(t);
  f.lock.importers['.'].dependencies.local = {
    specifier: 'workspace:*',
    version: 'link:packages/app',
  };
  const manifestPath = path.join(f.root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.dependencies.local = 'workspace:*';
  writeJson(manifestPath, manifest);
  link(
    path.join(f.root, 'packages/app'),
    path.join(f.root, 'node_modules/local'),
  );
  f.save();
  const proof = f.inspect();
  assert.ok(
    proof.identities.some(
      row =>
        row.importer === '.' &&
        row.rawparentkey === 'importer:packages/app' &&
        row.physicaltarget === f.parents[1],
    ),
  );
  assert.deepEqual(proof.targets, [...f.targets].sort());
});

test('private importer manifests may omit a published identity without weakening snapshot identities', t => {
  const f = fixture(t);
  for (const importer of ['.', 'packages/app']) {
    const file = path.join(f.root, importer, 'package.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete value.name;
    delete value.version;
    writeJson(file, value);
  }
  assert.deepEqual(f.inspect().targets, [...f.targets].sort());
});

test('snapshot workspace peer links are workspace-relative and use the actual consumer edge', t => {
  const f = fixture(t);
  f.lock.snapshots[f.contexts[0]].dependencies.local = 'link:packages/app';
  const manifestPath = path.join(f.parents[0], 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.peerDependencies = { local: 'workspace:*' };
  writeJson(manifestPath, manifest);
  link(
    path.join(f.root, 'packages/app'),
    path.join(path.dirname(f.parents[0]), 'local'),
  );
  f.save();
  const proof = f.inspect();
  assert.ok(
    proof.identities.some(
      row =>
        row.rawparentkey === f.contexts[0] &&
        row.dependencyKey === 'local' &&
        row.snapshot === 'importer:packages/app',
    ),
  );
  proof.assertUnchanged();
});

test('every braces record and edge must retain the exact version, upstream SRI and patch hash', async t => {
  const mutations = [
    [
      'unpatched alternate snapshot',
      f => {
        f.lock.snapshots['braces@3.0.3'] = {};
      },
      /Unpatched or unexpected braces/u,
    ],
    [
      'different version',
      f => {
        f.lock.packages['braces@3.0.2'] = {
          resolution: { integrity: f.expectedIntegrity },
        };
      },
      /Unexpected braces package/u,
    ],
    [
      'upstream bytes',
      f => {
        f.lock.packages['braces@3.0.3'].resolution.integrity = 'sha512-other';
      },
      /integrity differs/u,
    ],
    [
      'lock registration',
      f => {
        f.lock.patchedDependencies['braces@3.0.3'] = 'a'.repeat(64);
      },
      /patch hash/u,
    ],
    [
      'workspace registration',
      f => {
        delete f.workspace.patchedDependencies['braces@3.0.3'];
      },
      /register the exact/u,
    ],
    [
      'unpatched direct edge',
      f => {
        f.lock.snapshots[f.contexts[0]].dependencies.braces = '3.0.3';
      },
      /Unpatched or unexpected braces/u,
    ],
    [
      'unpatched aliased edge',
      f => {
        f.lock.snapshots[f.contexts[1]].optionalDependencies['braces-alias'] =
          'braces@3.0.3';
      },
      /Unpatched or unexpected braces/u,
    ],
    [
      'different patch context',
      f => {
        f.lock.snapshots[`braces@3.0.3(patch_hash=${'a'.repeat(64)})`] = {};
      },
      /Unpatched or unexpected braces/u,
    ],
    [
      'unpatched peer context',
      f => {
        f.lock.snapshots['unused@1.0.0(braces@3.0.3)'] = {};
      },
      /Unpatched braces peer/u,
    ],
    [
      'unpatched development edge',
      f => {
        f.lock.importers['.'].devDependencies = {
          'dev-braces': { version: 'braces@3.0.3' },
        };
      },
      /Unpatched or unexpected braces/u,
    ],
    [
      'missing development snapshot',
      f => {
        f.lock.importers['.'].devDependencies = {
          'dev-braces': {
            version: `braces@3.0.3(patch_hash=${f.patchSha256})(peer@missing)`,
          },
        };
      },
      /Missing raw braces snapshot/u,
    ],
  ];
  for (const [name, mutate, error] of mutations)
    await t.test(name, subtest => {
      const f = fixture(subtest);
      mutate(f);
      f.save();
      assert.throws(f.inspect, error);
    });
});

test('missing raw snapshots fail even when their names resemble an admitted context', t => {
  const f = fixture(t);
  delete f.lock.snapshots[f.contexts[1]];
  f.save();
  assert.throws(f.inspect, /Missing raw lock snapshot/u);
});

test('missing snapshots on unrelated production branches also fail closed', t => {
  const f = fixture(t);
  f.lock.importers['.'].dependencies.unrelated = {
    version: 'unrelated@1.0.0(peer@1.0.0)',
  };
  f.save();
  assert.throws(f.inspect, /Missing raw lock snapshot/u);
});

test('an installed package in another raw context cannot replace a missing parent or target', async t => {
  for (const [name, select] of [
    ['parent', f => f.parentLinks[1]],
    ['target', f => f.braceLinks[1]],
  ])
    await t.test(name, subtest => {
      const f = fixture(subtest);
      fs.unlinkSync(select(f));
      if (name === 'parent') fs.unlinkSync(f.parentLinks[0]);
      assert.throws(f.inspect, /Missing installed dependency/u);
    });
});

test('a nearer importer cannot silently use a different peer context with incompatible dependency aliases', t => {
  const f = fixture(t);
  fs.unlinkSync(f.parentLinks[1]);
  assert.throws(
    f.inspect,
    /Installed parent does not declare its lock dependency/u,
  );
});

test('linked importer records and physical importers are both required', async t => {
  await t.test('raw importer', subtest => {
    const f = fixture(subtest);
    f.lock.importers['.'].dependencies.local = {
      version: 'link:missing-importer',
    };
    f.save();
    assert.throws(f.inspect, /Missing linked importer/u);
  });
  await t.test('physical importer', subtest => {
    const f = fixture(subtest);
    fs.rmSync(path.join(f.root, 'packages/app'), { recursive: true });
    assert.throws(f.inspect, /ENOENT/u);
  });
});

test('borrowed physical parents and targets cannot qualify a repository installation', async t => {
  for (const [name, select, manifest] of [
    ['parent', f => f.parentLinks[1], { name: 'micromatch', version: '4.0.8' }],
    ['target', f => f.braceLinks[1], { name: 'braces', version: '3.0.3' }],
  ])
    await t.test(name, subtest => {
      const f = fixture(subtest);
      const external = path.join(f.temporary, 'borrowed');
      writePackage(external, manifest);
      fs.unlinkSync(select(f));
      link(external, select(f));
      assert.throws(f.inspect, /borrowed an external root/u);
    });
});

test('wrong parent identity or an undeclared installed dependency fails', async t => {
  for (const [name, mutate, error] of [
    [
      'name',
      value => {
        value.name = 'different';
      },
      /name differs/u,
    ],
    [
      'version',
      value => {
        value.version = '4.0.7';
      },
      /version differs/u,
    ],
    [
      'edge',
      value => {
        delete value.dependencies.braces;
      },
      /does not declare its lock dependency/u,
    ],
  ])
    await t.test(name, subtest => {
      const f = fixture(subtest);
      const file = path.join(f.parents[0], 'package.json');
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      mutate(value);
      writeJson(file, value);
      assert.throws(f.inspect, error);
    });
});

test('installed braces must contain exactly the authenticated regular payload', async t => {
  for (const [name, mutate, error] of [
    [
      'changed bytes',
      f =>
        fs.writeFileSync(path.join(f.targets[0], 'lib/parse.js'), 'different'),
      /payload bytes differ/u,
    ],
    [
      'missing file',
      f => fs.unlinkSync(path.join(f.targets[0], 'LICENSE')),
      /file set differs/u,
    ],
    [
      'unexpected file',
      f => fs.writeFileSync(path.join(f.targets[0], 'extra.js'), 'unexpected'),
      /file set differs/u,
    ],
    [
      'unexpected directory',
      f => fs.mkdirSync(path.join(f.targets[0], 'extra')),
      /Unexpected braces payload directory/u,
    ],
    [
      'symbolic payload',
      f => {
        fs.unlinkSync(path.join(f.targets[0], 'LICENSE'));
        fs.symlinkSync(
          path.join(f.targets[1], 'LICENSE'),
          path.join(f.targets[0], 'LICENSE'),
        );
      },
      /payload contains a symbolic link/u,
    ],
    [
      'renamed manifest',
      f => {
        writeJson(path.join(f.targets[0], 'package.json'), {
          name: '@bleedingdev/braces',
          version: '3.0.3',
        });
      },
      /name differs/u,
    ],
  ])
    await t.test(name, subtest => {
      const f = fixture(subtest);
      mutate(f);
      assert.throws(f.inspect, error);
    });
});

test('audit-time mutations of graph inputs, consumers, edges and payloads are detected', async t => {
  for (const [name, mutate] of [
    ['lock', f => fs.appendFileSync(f.lockFile, '\n')],
    ['workspace', f => fs.appendFileSync(f.workspaceFile, '\n')],
    [
      'patch',
      f => fs.appendFileSync(path.join(f.root, 'patches/braces.patch'), '\n'),
    ],
    [
      'parent manifest',
      f => fs.appendFileSync(path.join(f.parents[0], 'package.json'), '\n'),
    ],
    [
      'target payload',
      f => fs.appendFileSync(path.join(f.targets[0], 'lib/parse.js'), '\n'),
    ],
    [
      'added payload',
      f => fs.writeFileSync(path.join(f.targets[0], 'extra.js'), 'unexpected'),
    ],
    [
      'dependency link',
      f => {
        fs.unlinkSync(f.braceLinks[0]);
        link(f.targets[1], f.braceLinks[0]);
      },
    ],
    [
      'new nearer dependency',
      f => {
        link(f.targets[1], path.join(f.parents[0], 'node_modules/braces'));
      },
    ],
  ])
    await t.test(name, subtest => {
      const f = fixture(subtest);
      const proof = f.inspect();
      mutate(f);
      assert.throws(proof.assertUnchanged);
    });
});

test('conflicting lock documents cannot hide an unpatched raw record', t => {
  const f = fixture(t);
  const first = {
    lockfileVersion: '9.0',
    packages: {
      'braces@3.0.3': { resolution: { integrity: 'sha512-untrusted' } },
    },
  };
  fs.writeFileSync(
    f.lockFile,
    `${JSON.stringify(first)}\n---\n${JSON.stringify(f.lock)}\n`,
  );
  assert.throws(f.inspect, /integrity differs|Conflicting raw lock record/u);
});

test('canonical patch and reference inputs cannot be replaced or renamed', async t => {
  await t.test('patch bytes', subtest => {
    const f = fixture(subtest);
    fs.appendFileSync(path.join(f.root, 'patches/braces.patch'), 'different');
    assert.throws(f.inspect, /patch bytes differ/u);
  });
  await t.test('reference identity', subtest => {
    const f = fixture(subtest);
    f.referenceFiles.set(
      'package.json',
      Buffer.from(
        JSON.stringify({ name: '@bleedingdev/braces', version: '3.0.3' }),
      ),
    );
    assert.throws(f.inspect, /retain its upstream name/u);
  });
});
