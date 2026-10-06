import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import {
  inspectNpmTarball,
  readVerifiedPackageArtifactBytes,
  verifySidecarArtifacts,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';

export const sha256 = bytes =>
  crypto.createHash('sha256').update(bytes).digest('hex');

export function confinedPath(root, relative) {
  assert(typeof relative === 'string' && relative.length > 0);
  assert(!path.isAbsolute(relative), 'Emitted paths must be relative');
  const target = path.resolve(root, relative);
  const delta = path.relative(root, target);
  assert(
    delta !== '..' && !delta.startsWith(`..${path.sep}`),
    `Emitted path escapes its output root: ${relative}`,
  );
  for (const candidate of [
    root,
    ...delta
      .split(path.sep)
      .filter(Boolean)
      .map((_, index, parts) => path.join(root, ...parts.slice(0, index + 1))),
  ]) {
    try {
      assert(
        !fs.lstatSync(candidate).isSymbolicLink(),
        `Proof path contains a symlink: ${candidate}`,
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return target;
}

export function ordinaryFiles(directory) {
  assert(
    !fs.lstatSync(directory).isSymbolicLink(),
    `Unexpected proof input symlink: ${directory}`,
  );
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const file = path.join(directory, entry.name);
      assert(
        !entry.isSymbolicLink(),
        `Unexpected proof input symlink: ${file}`,
      );
      return entry.isDirectory() ? ordinaryFiles(file) : [file];
    })
    .sort();
}

export function fileEvidence(file, root) {
  confinedPath(root, path.relative(root, file));
  assert(fs.lstatSync(file).isFile(), 'Evidence must bind an ordinary file');
  const bytes = fs.readFileSync(file);
  return {
    path: path.relative(root, file).split(path.sep).join('/'),
    byteLength: bytes.length,
    sha256: sha256(bytes),
  };
}

export function parseArgs(argv) {
  const required = [
    '--manifest',
    '--expected-source-revision',
    '--expected-version',
    '--work-dir',
    '--receipt',
    '--store-dir',
    '--browser-executable',
    '--owner',
    '--owner-pid',
  ];
  const values = new Map();
  const optional = ['--continue-from', '--prior-receipt'];
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert(
      required.includes(key) || optional.includes(key),
      `Unknown argument: ${key}`,
    );
    assert(!values.has(key), `Duplicate argument: ${key}`);
    assert(value && !value.startsWith('--'), `${key} requires a value`);
    values.set(key, value);
  }
  for (const key of required) assert(values.has(key), `${key} is required`);
  const absolute = key => {
    assert(path.isAbsolute(values.get(key)), `${key} must be absolute`);
    return path.resolve(values.get(key));
  };
  assert(
    /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(
      values.get('--expected-source-revision'),
    ),
  );
  assert(/^[1-9]\d*$/u.test(values.get('--owner-pid')));
  const workDir = absolute('--work-dir');
  const receipt = absolute('--receipt');
  confinedPath(workDir, path.relative(workDir, receipt));
  const continueFrom = values.get('--continue-from');
  assert(
    continueFrom === undefined || continueFrom === 'materialized-fixture',
    'Only the materialized-fixture continuation cursor is supported',
  );
  assert.equal(
    Boolean(continueFrom),
    values.has('--prior-receipt'),
    '--continue-from materialized-fixture requires --prior-receipt, and vice versa',
  );
  return {
    manifestPath: absolute('--manifest'),
    expectedSourceRevision: values.get('--expected-source-revision'),
    expectedVersion: values.get('--expected-version'),
    workDir,
    receipt,
    storeDir: absolute('--store-dir'),
    browserExecutable: absolute('--browser-executable'),
    owner: values.get('--owner'),
    ownerPid: Number(values.get('--owner-pid')),
    ...(continueFrom
      ? {
          continueFrom,
          priorReceipt: absolute('--prior-receipt'),
        }
      : {}),
  };
}

export function materializeFixtureSources({
  fixtureRoot,
  consumer,
  release,
  priorReceipt,
}) {
  const fixture = ordinaryFiles(fixtureRoot).map(file =>
    fileEvidence(file, fixtureRoot),
  );
  let sourceRoot = fixtureRoot;
  let reusedFixture;
  if (priorReceipt) {
    const priorRoot = path.dirname(priorReceipt);
    const receiptEvidence = fileEvidence(priorReceipt, priorRoot);
    const bytes = fs.readFileSync(priorReceipt);
    assert.equal(sha256(bytes), receiptEvidence.sha256);
    const previous = JSON.parse(bytes);
    assert.equal(
      previous.schema,
      'bleedingdev.ultramodern.react-rsc-workerd-proof',
    );
    assert.equal(previous.schemaVersion, 1);
    assert.equal(
      previous.status,
      'failed',
      'Only a failed materialized fixture can be continued',
    );
    assert.deepEqual(
      previous.commands,
      [],
      'The fixture cursor cannot replay completed commands',
    );
    assert.equal(previous.sourceRevision, release.source.commit);
    assert.equal(previous.releaseVersion, release.release.version);
    assert.equal(previous.manifestSha256, release.manifestSha256);
    assert.equal(previous.frameworkCohortDigest, release.cohortDigest);
    assert.deepEqual(
      previous.fixture,
      fixture,
      'Recorded fixture sources differ from the owning producer',
    );
    sourceRoot = confinedPath(priorRoot, 'consumer');
    assert.notEqual(path.resolve(sourceRoot), path.resolve(consumer));
    reusedFixture = {
      qualification: 'verified-prior-materialized-source-only',
      sourceRoot,
      priorReceipt: {
        ...receiptEvidence,
        path: priorReceipt,
        text: bytes.toString('utf8'),
      },
    };
  }
  const sources = fixture
    .filter(item => item.path !== 'package.json.template')
    .map(item => {
      const source = confinedPath(sourceRoot, item.path);
      assert.deepEqual(
        fileEvidence(source, sourceRoot),
        item,
        `Retained fixture source differs: ${item.path}`,
      );
      const bytes = fs.readFileSync(source);
      assert.equal(
        sha256(bytes),
        item.sha256,
        `Fixture source changed while reading: ${item.path}`,
      );
      return { item, bytes };
    });
  // Authenticate every source before creating any part of the new consumer.
  for (const { item, bytes } of sources) {
    const destination = confinedPath(consumer, item.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: 'wx' });
  }
  return { fixture, ...(reusedFixture ? { reusedFixture } : {}) };
}

export function releaseConsumerInputs(release, template) {
  const packages = new Map(
    release.packages.map(item => [item.sourceName, item]),
  );
  const packed = name => {
    const item = packages.get(name);
    assert(item, `Required package absent from final cohort: ${name}`);
    const inspection = inspectNpmTarball(
      readVerifiedPackageArtifactBytes(item, item.artifactPath),
    );
    assert.equal(inspection.packageJson.name, item.targetName);
    assert.equal(inspection.packageJson.version, item.version);
    return { ...item, packageJson: inspection.packageJson };
  };
  const exact = (value, label) => {
    assert(
      /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u.test(value),
      `${label} must be an authenticated exact version`,
    );
    return value;
  };
  const reactPin = (value, label) => {
    const match =
      typeof value === 'string'
        ? /^\^?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u.exec(value)
        : null;
    assert(
      match && match[0] === value,
      `${label} must be an authenticated exact or single-caret numeric version`,
    );
    return match[1];
  };
  const manifest = structuredClone(template);
  manifest.packageManager = `pnpm@${release.tools.pnpm}`;
  manifest.version = release.release.version;
  manifest.devDependencies['@modern-js/ultramodern-create'] = 'cohort';
  manifest.devDependencies['@modern-js/app-tools-extensions'] = 'cohort';
  for (const block of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[block] ?? {})) {
      if (!name.startsWith('@modern-js/')) continue;
      const item = packed(name);
      manifest[block][name] = `npm:${item.targetName}@${item.version}`;
    }
  }
  const create = packed('@modern-js/ultramodern-create');
  const builder = packed('@modern-js/builder');
  const tanstack = packed('@modern-js/plugin-tanstack');
  const runtime = packed('@modern-js/runtime');
  const render = packed('@modern-js/render');
  const exactPackages = {};
  const reactVersion = reactPin(create.packageJson.dependencies.react, 'react');
  const reactDomVersion = reactPin(
    create.packageJson.dependencies['react-dom'],
    'react-dom',
  );
  assert.equal(
    reactVersion,
    reactDomVersion,
    'React and React DOM consumer pins must match',
  );
  for (const name of ['react', 'react-dom']) {
    manifest.dependencies[name] = reactVersion;
    exactPackages[name] = reactVersion;
  }
  const rsc = exact(
    builder.packageJson.peerDependencies['react-server-dom-rspack'],
    'RSC runtime',
  );
  assert.equal(
    render.packageJson.peerDependencies['react-server-dom-rspack'],
    rsc,
  );
  assert.equal(
    tanstack.packageJson.peerDependencies['react-server-dom-rspack'],
    rsc,
  );
  manifest.dependencies['react-server-dom-rspack'] = rsc;
  manifest.devDependencies['rsbuild-plugin-rsc'] = exact(
    builder.packageJson.peerDependencies['rsbuild-plugin-rsc'],
    'RSC compiler',
  );
  exactPackages['react-server-dom-rspack'] = rsc;
  exactPackages['rsbuild-plugin-rsc'] =
    manifest.devDependencies['rsbuild-plugin-rsc'];
  for (const [name, version] of Object.entries({
    '@tanstack/react-router':
      tanstack.packageJson.dependencies['@tanstack/react-router'],
    '@tanstack/router-core':
      tanstack.packageJson.dependencies['@tanstack/router-core'],
    'react-router': runtime.packageJson.dependencies['react-router'],
  })) {
    manifest.dependencies[name] = exact(version, name);
    exactPackages[name] = version;
  }
  const overrides = {};
  const consumerManifests = [manifest];
  for (const item of release.packages) {
    consumerManifests.push(
      inspectNpmTarball(
        readVerifiedPackageArtifactBytes(item, item.artifactPath),
      ).packageJson,
    );
    overrides[item.sourceName] = `npm:${item.targetName}@${item.version}`;
    overrides[item.targetName] = item.version;
  }
  if (release.sidecars) {
    const sidecars = verifySidecarArtifacts(release.artifactRoot, {
      manifestPath: path.basename(release.sidecars.manifestPath),
      sha256: sha256(release.sidecars.manifestBytes),
    });
    for (const item of sidecars.packages) {
      overrides[item.name] = item.version;
      consumerManifests.push(item.packageJson);
    }
    const byName = new Map(sidecars.packages.map(item => [item.name, item]));
    for (const parent of consumerManifests) {
      for (const block of ['dependencies', 'optionalDependencies']) {
        for (const [name, specifier] of Object.entries(parent[block] ?? {})) {
          const target =
            typeof specifier === 'string'
              ? /^npm:(@[^/]+\/[^@]+|[^@]+)@.+$/u.exec(specifier)?.[1]
              : undefined;
          const sidecar = byName.get(target);
          if (!sidecar) continue;
          assert.equal(
            specifier,
            `npm:${sidecar.name}@${sidecar.version}`,
            `Sidecar dependency must match the authenticated version: ${parent.name} ${name}`,
          );
          assert(
            overrides[name] === undefined || overrides[name] === specifier,
            `Conflicting authenticated sidecar alias: ${name}`,
          );
          overrides[name] = specifier;
        }
      }
    }
  }
  const inspection = inspectNpmTarball(
    readVerifiedPackageArtifactBytes(create, create.artifactPath),
  );
  const policy = inspection.fileContents
    .get('template-workspace/pnpm-workspace.yaml.handlebars')
    ?.toString('utf8');
  assert(policy, 'Authenticated generator pnpm workspace policy is missing');
  const allowBlock = /^allowBuilds:\n(?:[ \t]+[^\n]*\n?)+/mu.exec(policy)?.[0];
  assert(allowBlock, 'Authenticated generator allowBuilds policy is missing');
  const allowBuilds = parse(allowBlock).allowBuilds;
  assert(Object.values(allowBuilds).every(value => typeof value === 'boolean'));
  assert(/^strictDepBuilds:\s*true\s*$/mu.test(policy));
  // Generated apps install with the generator's peer rules (React 19 for
  // React 18-era peers such as react-helmet's react-side-effect). Keep the
  // authenticated concrete rules; templated ones bind generator inputs.
  const peerBlock = /^peerDependencyRules:\n(?:[ \t]+[^\n]*\n?)+/mu.exec(
    policy,
  )?.[0];
  const allowedVersions = Object.fromEntries(
    Object.entries(
      (peerBlock && parse(peerBlock).peerDependencyRules?.allowedVersions) ??
        {},
    ).filter(([, range]) => typeof range === 'string' && !range.includes('{{')),
  );
  return {
    manifest,
    exactPackages,
    workspaceYaml: stringify({
      packages: [],
      overrides,
      autoInstallPeers: false,
      engineStrict: true,
      verifyDepsBeforeRun: 'error',
      packageImportMethod: 'clone-or-copy',
      strictDepBuilds: true,
      allowBuilds,
      ...(Object.keys(allowedVersions).length > 0
        ? { peerDependencyRules: { allowedVersions } }
        : {}),
    }),
  };
}

export function workerOptions(outputRoot, wrangler) {
  assert(typeof wrangler.name === 'string' && wrangler.name.length > 0);
  assert(typeof wrangler.compatibility_date === 'string');
  assert(Array.isArray(wrangler.compatibility_flags));
  assert(typeof wrangler.assets?.binding === 'string');
  const main = confinedPath(outputRoot, wrangler.main);
  const paths = [main];
  for (const directory of ['server', 'worker']) {
    const root = path.join(outputRoot, directory);
    if (fs.existsSync(root))
      paths.push(
        ...ordinaryFiles(root).filter(file => /\.(?:c|m)?js$/u.test(file)),
      );
  }
  const modules = [...new Set(paths)].map(file => ({
    type: file.endsWith('.cjs') ? 'CommonJS' : 'ESModule',
    path: file,
  }));
  for (const module of modules) assert(fs.lstatSync(module.path).isFile());
  return {
    name: wrangler.name,
    modules,
    modulesRoot: outputRoot,
    compatibilityDate: wrangler.compatibility_date,
    compatibilityFlags: wrangler.compatibility_flags,
    assets: {
      binding: wrangler.assets.binding,
      directory: confinedPath(outputRoot, wrangler.assets.directory),
      routerConfig: {
        has_user_worker: true,
        invoke_user_worker_ahead_of_assets:
          wrangler.assets.run_worker_first !== false,
      },
    },
  };
}
