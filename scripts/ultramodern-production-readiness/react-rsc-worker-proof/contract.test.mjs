import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { parse } from 'yaml';
import { createTemplateRequiredFiles } from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/constants.mjs';
import {
  canonicalJson,
  inspectNpmTarball,
  readVerifiedPackageArtifactBytes,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import {
  confinedPath,
  fileEvidence,
  ordinaryFiles,
  parseArgs,
  releaseConsumerInputs,
  workerOptions,
} from './contract.mjs';

function ownedDirectory(t) {
  const parent = process.env.ULTRAMODERN_RSC_WORKER_PROOF_TEST_ROOT;
  assert(
    parent && path.isAbsolute(parent),
    'Set ULTRAMODERN_RSC_WORKER_PROOF_TEST_ROOT to an owned, registered test parent',
  );
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(parent), 'rsc-worker-contract-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, contents = 'export default {};\n') {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

function args(root, overrides = {}) {
  return Object.entries({
    '--manifest': path.join(root, 'release', 'manifest.json'),
    '--expected-source-revision': 'a'.repeat(40),
    '--expected-version': '3.9.0-ultramodern.1',
    '--work-dir': root,
    '--receipt': path.join(root, 'receipt.json'),
    '--store-dir': path.join(root, 'shared-store'),
    '--browser-executable': path.join(root, 'browser'),
    '--owner': 'rsc-worker-contract-test',
    '--owner-pid': String(process.pid),
    ...overrides,
  }).flat();
}

function workerFixture(t) {
  const root = ownedDirectory(t);
  const output = path.join(root, 'output');
  write(output, 'worker/main.mjs');
  write(output, 'worker/chunk.js');
  write(output, 'worker/chunk.js.map', '{}');
  write(output, 'server/nested/render.cjs', 'module.exports = {};\n');
  write(output, 'server/runtime.mjs');
  write(output, 'public/index.html', '<!doctype html>');
  return {
    root,
    output,
    wrangler: {
      name: 'react-rsc-worker',
      main: './worker/main.mjs',
      compatibility_date: '2026-09-21',
      compatibility_flags: ['nodejs_compat', 'streams_enable_constructors'],
      assets: {
        directory: './public',
        binding: 'ASSETS',
        run_worker_first: true,
      },
    },
  };
}

// These tiny archives exercise the real artifact reader. They are unit inputs,
// not a production capture or evidence that a renderer package works.
function tarBytes(files) {
  const blocks = [];
  for (const [relative, contents] of Object.entries(files)) {
    const bytes = Buffer.from(contents);
    const header = Buffer.alloc(512);
    const name = `package/${relative}`;
    assert(Buffer.byteLength(name) < 100);
    header.write(name, 0, 100);
    header.write('0000644\0', 100, 8);
    header.write('0000000\0', 108, 8);
    header.write('0000000\0', 116, 8);
    header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12);
    header.write('00000000000\0', 136, 12);
    header.fill(32, 148, 156);
    header.write('0', 156, 1);
    header.write('ustar\0', 257, 6);
    header.write('00', 263, 2);
    const checksum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(
      header,
      bytes,
      Buffer.alloc((512 - (bytes.length % 512)) % 512),
    );
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

function releaseFixture(
  t,
  {
    react = '19.3.0',
    reactDom = '19.3.0',
    builderRsc = '0.1.0',
    rscCompiler = '0.1.1',
    reactRouter = '7.18.4',
    renderRsc = '0.1.0',
    policy = 'strictDepBuilds: true\nallowBuilds:\n  esbuild: true\n  sharp: false\n  workerd: true\n',
  } = {},
) {
  const root = ownedDirectory(t);
  const version = '3.9.0-ultramodern.1';
  const definitions = {
    'ultramodern-create': { dependencies: { react, 'react-dom': reactDom } },
    builder: {
      peerDependencies: {
        'react-server-dom-rspack': builderRsc,
        'rsbuild-plugin-rsc': rscCompiler,
      },
    },
    'plugin-tanstack': {
      dependencies: {
        '@tanstack/react-router': '1.170.39',
        '@tanstack/router-core': '1.171.32',
      },
      peerDependencies: { 'react-server-dom-rspack': '0.1.0' },
    },
    runtime: { dependencies: { 'react-router': reactRouter } },
    render: { peerDependencies: { 'react-server-dom-rspack': renderRsc } },
    tsconfig: {},
    'ultramodern-app-tools': {},
    'app-tools-extensions': {},
  };
  const packages = Object.entries(definitions).map(([name, definition]) => {
    const sourceName = `@modern-js/${name}`;
    const targetName = `@bleedingdev/modern-js-${name}`;
    const files = {
      'package.json': canonicalJson({
        name: targetName,
        version,
        publishConfig: { access: 'public' },
        ...definition,
      }),
      'index.js': 'export default {};\n',
    };
    if (name === 'ultramodern-create') {
      for (const relative of createTemplateRequiredFiles)
        files[relative] = 'unit fixture\n';
      files['template-workspace/pnpm-workspace.yaml.handlebars'] = policy;
    }
    const bytes = tarBytes(files);
    const inspection = inspectNpmTarball(bytes);
    const artifactPath = write(root, `${name}.tgz`, bytes);
    const digest = (algorithm, encoding = 'hex') =>
      crypto.createHash(algorithm).update(bytes).digest(encoding);
    const record = {
      sourceName,
      targetName,
      version,
      artifactPath,
      size: bytes.length,
      sha256: digest('sha256'),
      shasum: digest('sha1'),
      integrity: `sha512-${digest('sha512', 'base64')}`,
      fileCount: inspection.fileCount,
      unpackedSize: inspection.unpackedSize,
      packageJsonSha256: inspection.packageJsonSha256,
      fileListSha256: inspection.fileListSha256,
      packageJson: inspection.packageJson,
    };
    readVerifiedPackageArtifactBytes(record, artifactPath);
    return record;
  });
  return {
    root,
    release: {
      packages,
      createPackage: packages.find(
        item => item.sourceName === '@modern-js/ultramodern-create',
      ),
      tools: { pnpm: '11.17.0' },
      release: { version },
    },
    template: JSON.parse(
      fs.readFileSync(
        new URL('./fixture/package.json.template', import.meta.url),
      ),
    ),
  };
}

test('arguments bind the expected release, tools, owner, and confined receipt', t => {
  const root = ownedDirectory(t);
  const options = parseArgs(args(root));
  assert.equal(
    options.manifestPath,
    path.join(root, 'release', 'manifest.json'),
  );
  assert.equal(options.expectedSourceRevision, 'a'.repeat(40));
  assert.equal(options.expectedVersion, '3.9.0-ultramodern.1');
  assert.equal(options.workDir, root);
  assert.equal(options.receipt, path.join(root, 'receipt.json'));
  assert.equal(options.storeDir, path.join(root, 'shared-store'));
  assert.equal(options.browserExecutable, path.join(root, 'browser'));
  assert.equal(options.owner, 'rsc-worker-contract-test');
  assert.equal(options.ownerPid, process.pid);
});

test('arguments reject unknown, duplicate, missing, and valueless options', t => {
  const root = ownedDirectory(t);
  const valid = args(root);
  assert.throws(
    () => parseArgs([...valid, '--force', 'true']),
    /Unknown argument/u,
  );
  assert.throws(
    () => parseArgs([...valid, '--owner', 'other']),
    /Duplicate argument/u,
  );
  for (let index = 0; index < valid.length; index += 2) {
    const without = [...valid.slice(0, index), ...valid.slice(index + 2)];
    assert.throws(() => parseArgs(without), /is required/u, valid[index]);
  }
  assert.throws(() => parseArgs([...valid.slice(0, -1)]), /requires a value/u);
  assert.throws(
    () => parseArgs(args(root, { '--owner': '--other' })),
    /requires a value/u,
  );
});

test('arguments reject relative tool paths, malformed source identity, and invalid owner pid', t => {
  const root = ownedDirectory(t);
  for (const key of [
    '--manifest',
    '--work-dir',
    '--receipt',
    '--store-dir',
    '--browser-executable',
  ]) {
    assert.throws(
      () => parseArgs(args(root, { [key]: 'relative/path' })),
      /must be absolute/u,
    );
  }
  for (const revision of ['main', 'a'.repeat(39), 'g'.repeat(40)]) {
    assert.throws(() =>
      parseArgs(args(root, { '--expected-source-revision': revision })),
    );
  }
  for (const pid of ['0', '-1', '1.5', 'not-a-pid']) {
    assert.throws(() => parseArgs(args(root, { '--owner-pid': pid })));
  }
});

test('receipt paths cannot escape the owned work directory lexically', t => {
  const root = ownedDirectory(t);
  for (const receipt of [
    path.join(root, '..', 'receipt.json'),
    `${root}-sibling/receipt.json`,
  ]) {
    assert.throws(
      () => parseArgs(args(root, { '--receipt': receipt })),
      /escapes/u,
    );
  }
});

test('receipt paths cannot escape through a symlink ancestor', t => {
  const root = ownedDirectory(t);
  const work = path.join(root, 'work');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(work);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(work, 'receipts'), 'dir');
  assert.throws(
    () =>
      parseArgs(
        args(work, {
          '--receipt': path.join(work, 'receipts', 'receipt.json'),
        }),
      ),
    /symlink|escapes/u,
  );
});

test('confined paths reject absolute, parent, and sibling escapes', t => {
  const root = ownedDirectory(t);
  assert.equal(
    confinedPath(root, './worker/main.mjs'),
    path.join(root, 'worker/main.mjs'),
  );
  for (const relative of [
    '../main.mjs',
    `../${path.basename(root)}-sibling/main.mjs`,
  ]) {
    assert.throws(() => confinedPath(root, relative), /escapes/u);
  }
  assert.throws(
    () => confinedPath(root, path.join(root, 'main.mjs')),
    /must be relative/u,
  );
  assert.throws(() => confinedPath(root, ''));
});

test('file evidence records actual bytes under a portable relative path', t => {
  const root = ownedDirectory(t);
  const file = write(root, 'server/main.mjs', 'abc');
  assert.deepEqual(fileEvidence(file, root), {
    path: 'server/main.mjs',
    byteLength: 3,
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  });
});

test('file evidence cannot authenticate a file outside its root', t => {
  const root = ownedDirectory(t);
  const file = write(root, 'outside/main.mjs');
  const output = path.join(root, 'output');
  fs.mkdirSync(output);
  assert.throws(() => fileEvidence(file, output), /escapes|outside/u);
});

test('ordinary files enumerate nested inputs and reject symlink entries and roots', t => {
  const root = ownedDirectory(t);
  const directory = path.join(root, 'inputs');
  const first = write(directory, 'a.mjs');
  const second = write(directory, 'nested/b.cjs');
  assert.deepEqual(ordinaryFiles(directory), [first, second].sort());
  fs.symlinkSync(first, path.join(directory, 'alias.mjs'));
  assert.throws(() => ordinaryFiles(directory), /symlink/u);
  const linkedRoot = path.join(root, 'linked-inputs');
  fs.symlinkSync(directory, linkedRoot, 'dir');
  fs.rmSync(path.join(directory, 'alias.mjs'));
  assert.throws(() => ordinaryFiles(linkedRoot), /symlink/u);
});

test('worker options use emitted flags, assets routing, and all actual JavaScript modules', t => {
  const { output, wrangler } = workerFixture(t);
  const options = workerOptions(output, wrangler);
  assert.equal(options.name, wrangler.name);
  assert.equal(options.modulesRoot, output);
  assert.equal(options.compatibilityDate, wrangler.compatibility_date);
  assert.deepEqual(options.compatibilityFlags, wrangler.compatibility_flags);
  assert.deepEqual(options.assets, {
    binding: 'ASSETS',
    directory: path.join(output, 'public'),
    routerConfig: {
      has_user_worker: true,
      invoke_user_worker_ahead_of_assets: true,
    },
  });
  assert.deepEqual(options.modules, [
    { type: 'ESModule', path: path.join(output, 'worker/main.mjs') },
    { type: 'CommonJS', path: path.join(output, 'server/nested/render.cjs') },
    { type: 'ESModule', path: path.join(output, 'server/runtime.mjs') },
    { type: 'ESModule', path: path.join(output, 'worker/chunk.js') },
  ]);
  const assetsFirst = workerOptions(output, {
    ...wrangler,
    assets: { ...wrangler.assets, run_worker_first: false },
  });
  assert.equal(
    assetsFirst.assets.routerConfig.invoke_user_worker_ahead_of_assets,
    false,
  );
});

test('worker options reject escaped main and assets paths', t => {
  const { output, wrangler } = workerFixture(t);
  assert.throws(
    () => workerOptions(output, { ...wrangler, main: '../main.mjs' }),
    /escapes/u,
  );
  assert.throws(
    () =>
      workerOptions(output, {
        ...wrangler,
        assets: { ...wrangler.assets, directory: '../public' },
      }),
    /escapes/u,
  );
});

test('worker options reject symlink main files and main ancestors', t => {
  const { root, output, wrangler } = workerFixture(t);
  const outside = write(root, 'outside/main.mjs');
  fs.symlinkSync(outside, path.join(output, 'linked-main.mjs'));
  assert.throws(() =>
    workerOptions(output, { ...wrangler, main: './linked-main.mjs' }),
  );
  fs.symlinkSync(
    path.dirname(outside),
    path.join(output, 'linked-directory'),
    'dir',
  );
  assert.throws(
    () =>
      workerOptions(output, {
        ...wrangler,
        main: './linked-directory/main.mjs',
      }),
    /symlink|escapes/u,
  );
});

test('worker options reject symlink assets and module directory roots', t => {
  const { root, output, wrangler } = workerFixture(t);
  const external = path.join(root, 'external');
  write(external, 'module.mjs');
  fs.symlinkSync(external, path.join(output, 'linked-assets'), 'dir');
  assert.throws(
    () =>
      workerOptions(output, {
        ...wrangler,
        assets: { ...wrangler.assets, directory: './linked-assets' },
      }),
    /symlink|escapes/u,
  );
  fs.rmSync(path.join(output, 'server'), { recursive: true });
  fs.symlinkSync(external, path.join(output, 'server'), 'dir');
  assert.throws(() => workerOptions(output, wrangler), /symlink|escapes/u);
});

test('consumer inputs authenticate mapped tar bytes and retain their exact pins and build policy', t => {
  const { release, template } = releaseFixture(t);
  const before = structuredClone(template);
  const inputs = releaseConsumerInputs(release, template);
  assert.deepEqual(
    template,
    before,
    'The caller-owned template must remain unchanged',
  );
  const workspace = parse(inputs.workspaceYaml);
  for (const item of release.packages) {
    assert.equal(
      workspace.overrides[item.sourceName],
      `file:${item.artifactPath}`,
    );
    assert.equal(
      workspace.overrides[item.targetName],
      `file:${item.artifactPath}`,
    );
  }
  for (const block of ['dependencies', 'devDependencies']) {
    for (const [name, specifier] of Object.entries(inputs.manifest[block])) {
      if (!name.startsWith('@modern-js/')) continue;
      const item = release.packages.find(
        candidate => candidate.sourceName === name,
      );
      assert.equal(specifier, `npm:${item.targetName}@${item.version}`);
    }
  }
  const inspection = inspectNpmTarball(
    readVerifiedPackageArtifactBytes(
      release.createPackage,
      release.createPackage.artifactPath,
    ),
  );
  assert.deepEqual(workspace.allowBuilds, {
    esbuild: true,
    sharp: false,
    workerd: true,
  });
  assert.equal(workspace.strictDepBuilds, true);
  assert.equal(workspace.autoInstallPeers, false);
  assert.equal(workspace.engineStrict, true);
  assert.equal(workspace.verifyDepsBeforeRun, 'error');
  assert.equal(workspace.packageImportMethod, 'clone-or-copy');
  assert.equal(inputs.manifest.packageManager, 'pnpm@11.17.0');
  assert.equal(inputs.manifest.version, release.release.version);
  assert.deepEqual(inputs.exactPackages, {
    react: '19.3.0',
    'react-dom': '19.3.0',
    'react-server-dom-rspack': '0.1.0',
    'rsbuild-plugin-rsc': '0.1.1',
    '@tanstack/react-router': '1.170.39',
    '@tanstack/router-core': '1.171.32',
    'react-router': '7.18.4',
  });
  assert.equal(inputs.manifest.devDependencies['rsbuild-plugin-rsc'], '0.1.1');
  for (const name of ['react', 'react-dom']) {
    assert.equal(
      inputs.manifest.dependencies[name],
      inspection.packageJson.dependencies[name],
    );
    assert.equal(
      inputs.exactPackages[name],
      inspection.packageJson.dependencies[name],
    );
  }
});

test('consumer input authentication rejects changed tarball bytes', t => {
  const { root, release, template } = releaseFixture(t);
  const changed = path.join(root, 'changed.tgz');
  fs.writeFileSync(
    changed,
    Buffer.concat([
      fs.readFileSync(release.createPackage.artifactPath),
      Buffer.from('tampered'),
    ]),
  );
  const forged = {
    ...release,
    packages: release.packages.map(item =>
      item.sourceName === release.createPackage.sourceName
        ? { ...item, artifactPath: changed }
        : item,
    ),
  };
  assert.throws(
    () => releaseConsumerInputs(forged, template),
    /tarball size mismatch/u,
  );
});

test('consumer pins come from authenticated tar bytes instead of caller packageJson', t => {
  const { release, template } = releaseFixture(t, {
    react: '^19.3.0',
    reactDom: '^19.3.0',
  });
  const forged = {
    ...release,
    packages: release.packages.map(item => ({
      ...item,
      packageJson: {
        ...item.packageJson,
        dependencies: {
          ...item.packageJson.dependencies,
          ...(item.sourceName === '@modern-js/ultramodern-create'
            ? { react: '99.0.0' }
            : {}),
        },
      },
    })),
  };
  const inputs = releaseConsumerInputs(forged, template);
  assert.equal(inputs.manifest.dependencies.react, '19.3.0');
  assert.equal(inputs.exactPackages.react, '19.3.0');
});

test('consumer inputs pin exact and single-caret React declarations to the same numeric base', t => {
  for (const [react, reactDom] of [
    ['^19.3.0', '^19.3.0'],
    ['^19.3.0', '19.3.0'],
    ['19.3.0', '^19.3.0'],
  ]) {
    const { release, template } = releaseFixture(t, { react, reactDom });
    const inputs = releaseConsumerInputs(release, template);
    for (const name of ['react', 'react-dom']) {
      assert.equal(inputs.manifest.dependencies[name], '19.3.0');
      assert.equal(inputs.exactPackages[name], '19.3.0');
    }
  }
});

test('consumer inputs reject mismatched React and React DOM base pins', t => {
  const { release, template } = releaseFixture(t, {
    react: '^19.3.0',
    reactDom: '^19.3.1',
  });
  assert.throws(
    () => releaseConsumerInputs(release, template),
    /React and React DOM consumer pins must match/u,
  );
});

test('consumer inputs reject unsupported React declarations in either package', t => {
  for (const invalid of [
    '^^19.3.0',
    '^19.3',
    '19.x',
    '19.3.0 || 20.0.0',
    '*',
    '~19.3.0',
    '^19.3.0-rc.1',
    '^19.3.0+build',
    '019.3.0',
    ' ^19.3.0',
    '^19.3.0\n',
    '19.3.0\r',
    ['^19.3.0'],
    [['19.3.0']],
    null,
  ]) {
    for (const name of ['react', 'reactDom']) {
      const { release, template } = releaseFixture(t, { [name]: invalid });
      assert.throws(
        () => releaseConsumerInputs(release, template),
        /authenticated exact or single-caret numeric version/u,
      );
    }
  }
});

test('consumer inputs retain exact RSC and router dependencies and consistent RSC peers', t => {
  for (const options of [
    { builderRsc: '^0.1.0' },
    { rscCompiler: '^0.1.1' },
    { reactRouter: '^7.18.4' },
  ]) {
    const { release, template } = releaseFixture(t, options);
    assert.throws(
      () => releaseConsumerInputs(release, template),
      /authenticated exact version/u,
    );
  }
  const inconsistent = releaseFixture(t, { renderRsc: '0.2.0' });
  assert.throws(() =>
    releaseConsumerInputs(inconsistent.release, inconsistent.template),
  );
});

test('consumer inputs reject missing cohort packages and unapproved packed build policy', t => {
  const { release, template } = releaseFixture(t);
  assert.throws(
    () =>
      releaseConsumerInputs(
        {
          ...release,
          packages: release.packages.filter(
            item => item.sourceName !== '@modern-js/builder',
          ),
        },
        template,
      ),
    /Required package absent from final cohort/u,
  );
  for (const policy of [
    'strictDepBuilds: true\n',
    'strictDepBuilds: false\nallowBuilds:\n  workerd: true\n',
    'strictDepBuilds: true\nallowBuilds:\n  workerd: yes\n',
  ]) {
    const invalid = releaseFixture(t, { policy });
    assert.throws(() =>
      releaseConsumerInputs(invalid.release, invalid.template),
    );
  }
});
