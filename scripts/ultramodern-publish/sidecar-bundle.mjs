// Consumer: the independent, same-run sidecar lane in publish-bleedingdev.yml.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import inventory from '../../packages/toolkit/ultramodern-create/src/ultramodern-workspace/patch-inventory.ts';
import {
  repoRoot,
  sidecarManifestFile,
  sidecarTarballsDirectory,
  trustedPublishRepository,
} from './lib/prepare-bleedingdev-packages/constants.mjs';
import {
  canonicalJson,
  resolveSourceIdentity,
  resolveToolVersions,
  verifySidecarArtifacts,
} from './lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import {
  assertSidecarPublishOrder,
  assertSidecarPublishTarget,
  assertSidecarStagingManifest,
  sidecarContentProjection,
} from './lib/prepare-bleedingdev-packages/sidecar-publication.mjs';
import { validateAliasConsistency } from './lib/prepare-bleedingdev-packages/sidecars.mjs';

export const sidecarBundleFile = 'sidecar-bundle.json';
export const sidecarBundleSchema = 'bleedingdev.ultramodern.sidecar-bundle';
export const sidecarQualificationSchema =
  'bleedingdev.ultramodern.sidecar-qualification';
// This label records dependency ordering only; it is no cohort/version qualification.
export const sidecarPublishBefore = '@bleedingdev/modern-js-utils';
export const sidecarRecipeIds = Object.freeze([
  'braces',
  'chokidar',
  'fast-glob',
  'find-workspaces',
  'micromatch',
  'rsbuild-plugin-source-build',
  'rsbuild-plugin-type-check',
  'ts-checker-rspack-plugin',
  'ultracite',
]);
export const sidecarQualificationProbeKeys = Object.freeze([
  'packed-install',
  'braces-api',
  'braces-depth-guard',
  'glob-api',
  'chokidar-api',
  'type-check-api',
  'ultracite-api',
]);
const passedProbes = Object.fromEntries(
  sidecarQualificationProbeKeys.map(key => [key, true]),
);
const outputRoot = path.join(repoRoot, '.modern', 'bleedingdev-sidecars');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function assertKeys(value, keys, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())
  ) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}

function readRegularFile(filePath) {
  const fd = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    if (!fs.fstatSync(fd).isFile())
      throw new Error(`Not a regular file: ${filePath}`);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readCanonicalJson(filePath) {
  const bytes = readRegularFile(filePath);
  const value = JSON.parse(bytes.toString('utf8'));
  if (!bytes.equals(Buffer.from(`${canonicalJson(value, 2)}\n`))) {
    throw new Error(`Not canonical JSON: ${filePath}`);
  }
  return { bytes, value };
}

export function resolveSidecarOutput(value) {
  const output = path.resolve(value);
  const relative = path.relative(outputRoot, output);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Sidecar output must be inside ${outputRoot}`);
  }
  let current = repoRoot;
  for (const segment of path.relative(repoRoot, output).split(path.sep)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink())
      throw new Error(`Sidecar output traverses a symbolic link: ${current}`);
  }
  return output;
}

export function readSidecarBundleInputs() {
  const recipes = JSON.parse(
    fs.readFileSync(
      new URL('../ultramodern-supply/sidecars.json', import.meta.url),
      'utf8',
    ),
  );
  return sidecarRecipeIds.map(id => {
    const matches = recipes.filter(recipe => recipe.id === id);
    if (matches.length !== 1)
      throw new Error(`Expected exactly one reviewed sidecar recipe ${id}`);
    const [recipe] = matches;
    let patch = null;
    if (recipe.patch) {
      const rows = inventory.filter(
        row => `${row.packageName}@${row.version}` === recipe.patch.inventory,
      );
      if (rows.length !== 1)
        throw new Error(`Missing canonical patch inventory for ${id}`);
      const [row] = rows;
      const digest = sha256(readRegularFile(path.join(repoRoot, row.path)));
      if (digest !== row.sha256)
        throw new Error(`Canonical patch hash drift for ${id}`);
      patch = { path: row.path, sha256: digest };
    }
    return {
      id,
      name: recipe.fork.name,
      version: recipe.fork.version,
      recipeSha256: sha256(Buffer.from(canonicalJson(recipe))),
      patch,
    };
  });
}

function producerIdentity(env) {
  if (
    !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? '') ||
    !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ATTEMPT ?? '')
  ) {
    throw new Error(
      'Sidecar bundle requires a real GitHub workflow run ID and attempt',
    );
  }
  return { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT };
}

export function assertSidecarProducerContext(env, source) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_REPOSITORY !== trustedPublishRepository
  )
    throw new Error(
      'Sidecar producer receipt requires this repository GitHub workflow',
    );
  const producer = producerIdentity(env);
  if (env.GITHUB_SHA !== source.commit)
    throw new Error('Sidecar producer must stage its exact workflow source');
  return producer;
}

function assertBundleManifest(manifest, { env, source, tools, inputs }) {
  assertKeys(
    manifest,
    [
      'schema',
      'schemaVersion',
      'mode',
      'source',
      'producer',
      'tools',
      'inputs',
      'sidecars',
    ],
    'Sidecar bundle',
  );
  assertKeys(manifest.source, ['repository', 'commit'], 'Sidecar source');
  assertKeys(manifest.producer, ['runId', 'runAttempt'], 'Sidecar producer');
  assertKeys(manifest.tools, ['node', 'npm', 'pnpm'], 'Sidecar toolchain');
  assertKeys(
    manifest.sidecars,
    ['manifestPath', 'sha256'],
    'Sidecar descriptor',
  );
  if (
    manifest.schema !== sidecarBundleSchema ||
    manifest.schemaVersion !== 1 ||
    manifest.mode !== 'sidecars'
  )
    throw new Error('Unknown independent sidecar bundle schema or mode');
  if (
    manifest.source.repository !== trustedPublishRepository ||
    !/^[a-f0-9]{40}$/u.test(manifest.source.commit)
  )
    throw new Error('Invalid sidecar source identity');
  producerIdentity({
    GITHUB_RUN_ID: manifest.producer.runId,
    GITHUB_RUN_ATTEMPT: manifest.producer.runAttempt,
  });
  if (env.GITHUB_RUN_ID !== undefined || env.GITHUB_RUN_ATTEMPT !== undefined) {
    if (
      canonicalJson(manifest.producer) !== canonicalJson(producerIdentity(env))
    )
      throw new Error('Sidecar producer is not this workflow run and attempt');
  }
  if (env.GITHUB_SHA !== undefined && manifest.source.commit !== env.GITHUB_SHA)
    throw new Error('Sidecar bundle source differs from workflow source');
  if (canonicalJson(manifest.source) !== canonicalJson(source))
    throw new Error('Sidecar bundle source differs from the checkout');
  if (canonicalJson(manifest.tools) !== canonicalJson(tools))
    throw new Error(
      'Sidecar accepted toolchain differs from the active toolchain',
    );
  if (canonicalJson(manifest.inputs) !== canonicalJson(inputs))
    throw new Error('Sidecar reviewed recipe or patch inputs differ');
  if (
    manifest.sidecars.manifestPath !== sidecarManifestFile ||
    !/^[a-f0-9]{64}$/u.test(manifest.sidecars.sha256)
  )
    throw new Error('Unsafe sidecar manifest descriptor');
}

export function verifySidecarBundle(
  out,
  {
    env = process.env,
    source = resolveSourceIdentity({ env }),
    tools = resolveToolVersions(),
    inputs = readSidecarBundleInputs(),
  } = {},
) {
  const root = path.resolve(out);
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink())
    throw new Error('Unsafe sidecar bundle root');
  const names = fs.readdirSync(root).sort();
  const expected = [
    sidecarBundleFile,
    sidecarManifestFile,
    sidecarTarballsDirectory,
  ].sort();
  if (canonicalJson(names) !== canonicalJson(expected))
    throw new Error('Independent sidecar bundle file set differs');
  const { bytes, value: manifest } = readCanonicalJson(
    path.join(root, sidecarBundleFile),
  );
  assertBundleManifest(manifest, { env, source, tools, inputs });
  // The closed v2 verifier owns all tarball paths, digests, identities and file sets.
  const sidecars = verifySidecarArtifacts(root, manifest.sidecars);
  assertSidecarStagingManifest(sidecars.manifest, {
    publishBefore: sidecarPublishBefore,
  });
  const identities = sidecars.packages
    .map(item => ({
      id: path.posix.basename(item.root),
      name: item.name,
      version: item.version,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const reviewed = inputs.map(({ id, name, version }) => ({
    id,
    name,
    version,
  }));
  if (canonicalJson(identities) !== canonicalJson(reviewed))
    throw new Error(
      'Sidecar package set differs from the exact reviewed recipe closure',
    );
  for (const item of sidecars.packages) {
    if (item.root !== `packages/sidecar/${path.posix.basename(item.root)}`)
      throw new Error('Unsafe sidecar recipe root');
    assertSidecarPublishTarget(item.packageJson, item.name);
    sidecarContentProjection(item.packageJson, item.name);
  }
  validateAliasConsistency([], sidecars.packages);
  assertSidecarPublishOrder(sidecars.packages);
  return { manifest, bundleSha256: sha256(bytes), sidecars };
}

export function writeSidecarBundle(
  out,
  { descriptor, source, tools, env = process.env },
) {
  const producer = assertSidecarProducerContext(env, source);
  const manifest = {
    schema: sidecarBundleSchema,
    schemaVersion: 1,
    mode: 'sidecars',
    source,
    producer,
    tools,
    inputs: readSidecarBundleInputs(),
    sidecars: descriptor,
  };
  fs.writeFileSync(
    path.join(out, sidecarBundleFile),
    `${canonicalJson(manifest, 2)}\n`,
    { flag: 'wx' },
  );
  return verifySidecarBundle(out, { env, source, tools });
}

export function writeSidecarQualification(
  out,
  probes,
  { env = process.env, receiptPath } = {},
) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_REPOSITORY !== trustedPublishRepository
  )
    throw new Error(
      'Sidecar qualification receipt requires this repository GitHub workflow',
    );
  const accepted = verifySidecarBundle(out, { env });
  if (canonicalJson(probes) !== canonicalJson(passedProbes))
    throw new Error(
      'Sidecar qualification did not pass the complete required probe set',
    );
  if (
    canonicalJson(accepted.manifest.producer) !==
    canonicalJson(producerIdentity(env))
  )
    throw new Error('Qualification must use this workflow run and attempt');
  const receipt = {
    schema: sidecarQualificationSchema,
    schemaVersion: 1,
    bundleSha256: accepted.bundleSha256,
    source: accepted.manifest.source,
    producer: accepted.manifest.producer,
    tools: accepted.manifest.tools,
    inputs: accepted.manifest.inputs,
    sidecars: accepted.manifest.sidecars,
    probes,
  };
  if (!receiptPath)
    throw new Error('Sidecar qualification receipt path is required');
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${canonicalJson(receipt, 2)}\n`, {
    flag: 'wx',
  });
  return receipt;
}

export function verifySidecarQualification(out, receiptPath, options = {}) {
  const accepted = verifySidecarBundle(out, options);
  const { value: receipt } = readCanonicalJson(receiptPath);
  const expected = {
    schema: sidecarQualificationSchema,
    schemaVersion: 1,
    bundleSha256: accepted.bundleSha256,
    source: accepted.manifest.source,
    producer: accepted.manifest.producer,
    tools: accepted.manifest.tools,
    inputs: accepted.manifest.inputs,
    sidecars: accepted.manifest.sidecars,
    probes: passedProbes,
  };
  if (canonicalJson(receipt) !== canonicalJson(expected))
    throw new Error(
      'Sidecar qualification receipt does not bind the exact successful bundle, source, tools, inputs and producer',
    );
  return accepted;
}
