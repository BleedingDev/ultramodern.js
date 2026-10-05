#!/usr/bin/env node
// The caller owns the built apps, servers and receipt. This probe starts no jobs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const metadataKey = 'ultramodernRenderer';
const stoppedEntry = 'ULTRAMODERN_MF_PROOF_ENTRY_OBSERVED';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const tuple = value => ({
  profile: value.profile,
  runtime: value.runtime,
  bootstrap: value.bootstrap,
});
const projectedProfile = profile => ({
  renderer: profile.renderer,
  protocolVersion: profile.protocolVersion,
  compiler: profile.compiler,
  hydration: profile.hydration,
  router: profile.router,
});

async function packageRecord(filename, compiled = false) {
  const entry = await fs.realpath(filename);
  let directory = path.dirname(entry);
  while (true) {
    const manifest = path.join(directory, 'package.json');
    try {
      const bytes = await fs.readFile(manifest);
      const json = JSON.parse(bytes);
      if (typeof json.name === 'string' && typeof json.version === 'string') {
        if (compiled)
          assert.ok(
            entry.includes(`${path.sep}dist${path.sep}`),
            `Compiled package entry required: ${entry}`,
          );
        return {
          name: json.name,
          version: json.version,
          entry,
          entrySha256: hash(await fs.readFile(entry)),
          packageJson: manifest,
          packageJsonSha256: hash(bytes),
        };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `Package owner missing for ${entry}`);
    directory = parent;
  }
}

async function fetchManifest(url) {
  assert.match(url, /^https?:\/\//u, 'A live HTTP manifest URL is required');
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, `Native manifest unavailable: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const json = JSON.parse(bytes.toString());
  assert.ok(
    json.metaData && Array.isArray(json.exposes) && Array.isArray(json.shared),
    'A native MF manifest is required',
  );
  return { url, sha256: hash(bytes), bytes: bytes.length, json };
}

async function bindApp(appDirectory, manifest, sdkImport) {
  const app = await fs.realpath(appDirectory);
  const requireApp = createRequire(path.join(app, 'package.json'));
  const sdkPath = requireApp.resolve(sdkImport);
  const sdk = requireApp(sdkImport);
  const requireSdk = createRequire(sdkPath);
  const guardPath = requireSdk.resolve(
    '@modern-js/federation-runtime/renderer-runtime-plugin',
  );
  const contractPath = requireSdk.resolve(
    '@modern-js/federation-runtime/renderer-contract',
  );
  const { readRendererFederationContract } = requireSdk(contractPath);
  const guardModule = requireSdk(guardPath);
  const guard = guardModule.createRendererFederationRuntimePlugin;
  assert.equal(
    typeof guard,
    'function',
    'The installed candidate guard must export its native plugin factory',
  );
  const profile = sdk.resolveRendererProfile('react');
  const buildPath = path.join(app, 'dist', 'renderer-build.json');
  const buildBytes = await fs.readFile(buildPath);
  const build = sdk.validateRendererBuildManifest(
    JSON.parse(buildBytes.toString()),
    profile,
    {
      routerFrameworks: sdk.resolveRendererRouterFrameworks('react'),
    },
  );
  const contract = readRendererFederationContract(
    manifest.json.metaData[metadataKey],
  );
  assert.deepEqual(
    contract.profile,
    projectedProfile(profile),
    'Native MF profile must match the installed SDK profile',
  );
  assert.deepEqual(
    { ...contract.identities },
    { ...build.identities },
    'Native MF identities must match the finalized renderer build',
  );
  const bootstrapPath = requireSdk.resolve('@modern-js/runtime/cli');
  const requireBootstrap = createRequire(bootstrapPath);
  const [sdkOwner, guardOwner, contractOwner, bootstrap, runtime, hydration] =
    await Promise.all([
      packageRecord(sdkPath, true),
      packageRecord(guardPath, true),
      packageRecord(contractPath, true),
      packageRecord(bootstrapPath),
      packageRecord(requireBootstrap.resolve('react')),
      packageRecord(requireBootstrap.resolve('react-dom/client')),
    ]);
  assert.deepEqual(
    contract.runtime,
    { name: runtime.name, version: runtime.version },
    'React runtime publication must match the installed owner',
  );
  assert.deepEqual(
    contract.bootstrap,
    { name: bootstrap.name, version: bootstrap.version },
    'Bootstrap publication must match the installed owner',
  );
  assert.equal(
    contract.profile.hydration.version,
    hydration.version,
    'Hydration publication must match the installed owner',
  );
  return {
    requireApp,
    guard,
    contract,
    receipt: {
      app,
      sdk: sdkOwner,
      guard: guardOwner,
      contract: contractOwner,
      bootstrap,
      runtime,
      hydration,
      build: {
        path: buildPath,
        sha256: hash(buildBytes),
        identities: build.identities,
        buildMarker: build.buildMarker,
        inputDigest: build.inputDigest,
        profileDigest: build.profileDigest,
        compilerDigest: build.compilerDigest,
        frameworkCohortDigest: build.frameworkCohortDigest,
        sourceRevision: build.sourceRevision,
      },
      manifest: {
        url: manifest.url,
        sha256: manifest.sha256,
        bytes: manifest.bytes,
        name: manifest.json.name,
        contract,
      },
    },
  };
}

function changedVersion(version) {
  return version === '0.0.0' ? '0.0.1' : '0.0.0';
}

/** Only the native loader's fetched response is changed; the built files stay bound. */
export function mutateRendererManifest(manifest, variant) {
  const mutated = clone(manifest);
  const metadata = mutated.metaData[metadataKey];
  if (variant === 'missing-metadata') delete mutated.metaData[metadataKey];
  else if (variant === 'renderer') {
    metadata.profile.renderer = 'solid';
    for (const identity of Object.values(metadata.identities))
      identity.renderer = 'solid';
  } else if (variant === 'protocol') {
    metadata.profile.protocolVersion = 2;
    for (const identity of Object.values(metadata.identities))
      identity.protocolVersion = 2;
  } else if (variant === 'schema')
    metadata.schema = 'unsupported.renderer-federation';
  else if (variant === 'schema-version') metadata.schemaVersion += 1;
  else if (variant === 'extra-field') metadata.unowned = true;
  else if (variant === 'runtime' || variant === 'bootstrap') {
    metadata[variant].version = changedVersion(metadata[variant].version);
  } else if (['compiler', 'hydration', 'router'].includes(variant)) {
    metadata.profile[variant].version = changedVersion(
      metadata.profile[variant].version,
    );
  } else if (variant === 'router-core') {
    metadata.profile.router.coreVersion = changedVersion(
      metadata.profile.router.coreVersion,
    );
  } else assert.equal(variant, 'valid', `Unknown manifest variant: ${variant}`);
  return mutated;
}

function remoteUrl(url, label) {
  const result = new URL(url);
  result.searchParams.set('ultramodernRendererProof', label);
  return result.href;
}

/** Real native createInstance/loadRemote only. Entry loading stops at an observed hook. */
async function observeLoad(
  context,
  {
    label,
    remoteName,
    url,
    expected,
    variant = 'valid',
    cached = false,
    expectEntry = false,
  },
) {
  const observation = {
    label,
    variant,
    remoteName,
    manifestUrl: url,
    manifestFetches: 0,
    snapshots: [],
    hostSnapshotGates: 0,
    entries: [],
  };
  const auditObserver = {
    name: `renderer-proof-observer-${label}`,
    async fetch(input, init) {
      assert.equal(
        String(input),
        url,
        'The native loader requested an unbound resource',
      );
      observation.manifestFetches += 1;
      const response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(
        hash(bytes),
        context.manifest.sha256,
        'Served remote changed during the proof',
      );
      const mutated = mutateRendererManifest(
        JSON.parse(bytes.toString()),
        variant,
      );
      observation.servedSha256 = hash(JSON.stringify(mutated));
      return new Response(JSON.stringify(mutated), {
        headers: { 'content-type': 'application/json' },
      });
    },
    async loadRemoteSnapshot(args) {
      observation.snapshots.push(args.from);
      return args;
    },
    async afterLoadSnapshot(args) {
      observation.hostSnapshotGates += 1;
      return args;
    },
  };
  const entryObserver = {
    name: `renderer-proof-entry-observer-${label}`,
    async loadEntry(args) {
      observation.entries.push(clone(args.remoteInfo));
      throw new Error(stoppedEntry);
    },
  };
  const instance = context.runtime.createInstance({
    name: `rendererProofHost_${process.pid}_${label}`,
    version: context.buildMarker,
    inBrowser: false,
    remotes: [{ name: remoteName, entry: url }],
    plugins: [auditObserver, context.guard(expected), entryObserver],
  });
  try {
    await instance.loadRemote(`${remoteName}/${context.expose}`);
    assert.fail('The entry observer must stop every probe load');
  } catch (error) {
    observation.error = String(error?.message ?? error);
  }
  if (expectEntry) {
    assert.equal(
      observation.entries.length,
      1,
      `${label}: valid same-renderer publication did not reach native entry loading`,
    );
    assert.ok(
      observation.error.includes(stoppedEntry),
      `${label}: native load did not stop at the entry observer`,
    );
    assert.equal(
      observation.hostSnapshotGates,
      1,
      `${label}: native host snapshot validation was bypassed`,
    );
  } else {
    assert.equal(
      observation.entries.length,
      0,
      `${label}: incompatible publication reached native entry loading`,
    );
    assert.match(
      observation.error,
      /Renderer federation manifest contract:/u,
      `${label}: rejection must come from the installed renderer guard`,
    );
  }
  assert.equal(
    observation.manifestFetches,
    cached ? 0 : 1,
    `${label}: unexpected native manifest fetch count`,
  );
  return observation;
}

export async function runReactMfRendererGuardProof(options) {
  const sdkImport = options.sdkImport ?? '@modern-js/ultramodern-app-tools';
  const [hostManifest, remoteManifest] = await Promise.all([
    fetchManifest(options.hostManifest),
    fetchManifest(options.remoteManifest),
  ]);
  const [host, remote] = await Promise.all([
    bindApp(options.hostApp, hostManifest, sdkImport),
    bindApp(options.remoteApp, remoteManifest, sdkImport),
  ]);
  assert.deepEqual(
    tuple(host.contract),
    tuple(remote.contract),
    'The candidate positive fixture needs the same exact renderer tuple',
  );
  assert.equal(
    host.receipt.guard.entrySha256,
    remote.receipt.guard.entrySha256,
    'Host and remote must use the same packed guard',
  );
  const nativePluginPath = host.requireApp.resolve(
    '@module-federation/modern-js-v3',
  );
  const requireNative = createRequire(nativePluginPath);
  const runtimePath = requireNative.resolve('@module-federation/runtime');
  const requireRuntime = createRequire(runtimePath);
  const runtime = requireNative(runtimePath);
  const corePath = requireRuntime.resolve('@module-federation/runtime-core');
  const core = requireRuntime(corePath);
  assert.equal(typeof runtime.createInstance, 'function');
  assert.equal(typeof core.getGlobalSnapshot, 'function');
  assert.equal(typeof core.addGlobalSnapshot, 'function');
  const expose = remoteManifest.json.exposes[0]?.name?.replace(/^\.\//u, '');
  assert.ok(
    typeof expose === 'string' && expose.length,
    'Built remote must expose an actual module',
  );
  const expected = tuple(host.contract);
  const context = {
    runtime,
    guard: host.guard,
    expected,
    expose,
    manifest: remoteManifest,
    buildMarker: host.receipt.build.buildMarker,
  };
  const observations = [];
  const variants = [
    'valid',
    'renderer',
    'runtime',
    'compiler',
    'hydration',
    'router',
    'router-core',
    'bootstrap',
    'protocol',
    'schema',
    'schema-version',
    'missing-metadata',
    'extra-field',
  ];
  for (const variant of variants) {
    observations.push(
      await observeLoad(context, {
        label: variant,
        remoteName: `rendererProofRemote_${process.pid}_${variant}`,
        url: remoteUrl(remoteManifest.url, variant),
        expected,
        variant,
        expectEntry: variant === 'valid',
      }),
    );
  }
  const cacheName = `rendererProofRemote_${process.pid}_cache`;
  const cacheUrl = remoteUrl(remoteManifest.url, 'cache');
  const incompatible = clone(expected);
  incompatible.runtime.version = changedVersion(incompatible.runtime.version);
  const promiseName = `rendererProofRemote_${process.pid}_promise`;
  const promiseUrl = remoteUrl(remoteManifest.url, 'shared-promise');
  const promiseLoads = await Promise.all([
    observeLoad(context, {
      label: 'promise-creator-incompatible',
      remoteName: promiseName,
      url: promiseUrl,
      expected: incompatible,
    }),
    observeLoad(context, {
      label: 'promise-compatible-consumer',
      remoteName: promiseName,
      url: promiseUrl,
      expected,
      cached: true,
      expectEntry: true,
    }),
  ]);
  assert.deepEqual(
    promiseLoads[0].snapshots,
    ['manifest'],
    'The first native host must attest the shared manifest promise',
  );
  assert.deepEqual(
    promiseLoads[1].snapshots,
    [],
    'The second native host must exercise the retained promise without a publication hook',
  );
  observations.push(...promiseLoads);
  observations.push(
    await observeLoad(context, {
      label: 'cache-creator-incompatible',
      remoteName: cacheName,
      url: cacheUrl,
      expected: incompatible,
    }),
  );
  const matches = Object.entries(core.getGlobalSnapshot()).filter(([key]) =>
    key.startsWith(`${cacheName}:`),
  );
  assert.equal(
    matches.length,
    1,
    'The native creator must retain one verified publication snapshot',
  );
  const [cacheKey, snapshot] = matches[0];
  observations.push(
    await observeLoad(context, {
      label: 'cache-compatible',
      remoteName: cacheName,
      url: cacheUrl,
      expected,
      cached: true,
      expectEntry: true,
    }),
  );
  observations.push(
    await observeLoad(context, {
      label: 'cache-incompatible',
      remoteName: cacheName,
      url: cacheUrl,
      expected: incompatible,
      cached: true,
    }),
  );
  const unattested = JSON.parse(JSON.stringify(snapshot));
  core.addGlobalSnapshot({ [cacheKey]: unattested });
  observations.push(
    await observeLoad(context, {
      label: 'cache-unattested',
      remoteName: cacheName,
      url: cacheUrl,
      expected,
      cached: true,
    }),
  );
  for (const label of [
    'cache-compatible',
    'cache-incompatible',
    'cache-unattested',
  ])
    assert.deepEqual(
      observations.find(item => item.label === label).snapshots,
      ['global'],
      `${label}: the native global snapshot path must run`,
    );
  const receipt = {
    schema: 'ultramodern-react-mf-renderer-guard-proof',
    version: 1,
    completedAt: new Date().toISOString(),
    host: host.receipt,
    remote: remote.receipt,
    native: {
      plugin: await packageRecord(nativePluginPath, true),
      runtime: await packageRecord(runtimePath, true),
      core: await packageRecord(corePath, true),
      environment: 'node',
    },
    expose,
    observations,
    evidence: {
      rejectedBeforeEntry: observations.filter(
        item => item.entries.length === 0,
      ).length,
      acceptedToNativeEntry: observations.filter(
        item => item.entries.length === 1,
      ).length,
      remoteEntryEvaluation: 0,
      remoteFactoryExecution: 0,
    },
    limits: [
      'The installed native Node loader runs; entry observation stops execution before native container evaluation.',
      'Use the original packed MF probe for actual SSR, hydration, events and remote lifecycle.',
    ],
  };
  await fs.mkdir(path.dirname(path.resolve(options.output)), {
    recursive: true,
  });
  await fs.writeFile(options.output, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
  });
  return receipt;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      'host-app': { type: 'string' },
      'remote-app': { type: 'string' },
      'host-manifest': { type: 'string' },
      'remote-manifest': { type: 'string' },
      output: { type: 'string' },
      'sdk-import': { type: 'string' },
    },
  });
  for (const key of [
    'host-app',
    'remote-app',
    'host-manifest',
    'remote-manifest',
    'output',
  ])
    assert.ok(values[key], `Required --${key}`);
  const receipt = await runReactMfRendererGuardProof({
    hostApp: values['host-app'],
    remoteApp: values['remote-app'],
    hostManifest: values['host-manifest'],
    remoteManifest: values['remote-manifest'],
    output: values.output,
    sdkImport: values['sdk-import'],
  });
  process.stdout.write(
    `${JSON.stringify({ output: path.resolve(values.output), evidence: receipt.evidence })}\n`,
  );
}
