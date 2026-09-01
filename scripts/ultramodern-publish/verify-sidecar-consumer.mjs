#!/usr/bin/env node
// ROOT-ONLY. Packed-consumer proof for the sidecar publication lane.
//
// What it proves, end to end, against a LOOPBACK registry only:
//   * the three stable sidecars publish in alias order (image-size before the
//     rsbuild-image-core fork that aliases it; ipx before the cohort);
//   * the cohort package @bleedingdev/modern-js-image, packed from this
//     checkout, installs from that registry with strict npm peer resolution;
//   * its `npm:@bleedingdev/...` aliases resolve to the fork packages;
//   * sharp resolves on the 0.35 line, image-size resolves to the hardened
//     fork through the core fork's own dependency edge;
//   * ipx and @rsbuild-image/core/shared import through BOTH CJS and ESM;
//   * `npm ls` reports no invalid or missing peer edges.
//
// Publishing safety (this script runs `npm publish`, so it is written to make
// a public-registry publish impossible rather than unlikely):
//   * --registry accepts loopback hosts only; public npm/yarn/GitHub registries
//     are refused unconditionally and there is no override flag;
//   * the scratch npmrc files pin BOTH the default registry and the
//     @bleedingdev-scoped registry, and cover npm's project, user AND global
//     config roles - three DISTINCT files with identical pins, so no ambient
//     .npmrc can redirect the scope and npm never double-loads one path;
//   * before every publish the EFFECTIVE `npm config get registry` and
//     `npm config get @bleedingdev:registry` are asserted equal to that URL;
//   * no original sidecar tarball is ever published: each package is staged
//     into scratch with `publishConfig.registry` removed (access preserved),
//     and the packed tarball's own manifest is re-read to prove no registry
//     field survived. `@bleedingdev/ipx` pins publishConfig.registry to public
//     npm, and npm honours a packed publishConfig.registry over `--registry`.
//
// It never installs Verdaccio and never touches the repository working tree or
// its lockfile: everything happens in a unique directory this script creates
// underneath the scratch root the caller names, and removes on exit, on error,
// and on SIGINT/SIGTERM. The caller's scratch root itself is never deleted.
//
// Launch a local registry SEPARATELY first (root, in another terminal):
//
//   npx --yes verdaccio@6.2.0 --listen http://127.0.0.1:4873
//   npm --registry http://127.0.0.1:4873 adduser        # then, for the token:
//   npm --registry http://127.0.0.1:4873 token create   # pass via --auth-token
//
// The registry needs an npmjs uplink (Verdaccio's default config has one) so
// third-party dependencies such as @rsbuild-image/react and sharp resolve.
//
// Then, from the repository root:
//
//   pnpm --filter @modern-js/image build
//   node scripts/ultramodern-publish/verify-sidecar-consumer.mjs \
//     --registry http://127.0.0.1:4873 \
//     --scratch-dir "$HOME/.cache/ultramodern-sidecar-proof" \
//     --auth-token "<token from npm token create>"
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cliKit from '../lib/cli-kit.js';
import validationKit from '../lib/validation-kit.js';
import { isDirectRun } from './lib/direct-run.mjs';
import { rejectInlineOptionSyntax } from './lib/option-syntax.mjs';
import {
  repoRoot,
  sidecarScope,
} from './lib/prepare-bleedingdev-packages/constants.mjs';
import { readNpmTarballFile } from './lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { sidecarRegistryDecision } from './lib/prepare-bleedingdev-packages/sidecar-publication.mjs';
import {
  collectSidecarPackages,
  rewriteSidecarConsumerAliases,
  sidecarPublishOrder,
  validateAliasConsistency,
} from './lib/prepare-bleedingdev-packages/sidecars.mjs';

const { parseCliArgs } = cliKit;
const { isPlainObject } = validationKit;

const cohortImageSourceName = '@modern-js/image';
const cohortImageTargetName = '@bleedingdev/modern-js-image';
const cohortImageSourceDir = 'packages/runtime/plugin-image';

// The cohort image is rebuilt from the working tree on every run, so its
// content legitimately differs between runs while its identity would not. A
// per-run prerelease version keeps an immutable local-registry version from
// ever being republished with different bytes (npm answers that with E403),
// without weakening anything this proof exists to check: the ALIASES it
// publishes still pin the exact stable sidecar versions the cohort ships.
const proofVersionBase = '0.0.0-sidecar-consumer-proof';

// Hosts that are npm itself. Refused unconditionally.
const publicRegistryHosts = new Set([
  'registry.npmjs.org',
  'registry.npmjs.com',
  'registry.yarnpkg.com',
  'npmjs.org',
  'npmjs.com',
  'www.npmjs.com',
  'npm.pkg.github.com',
]);

const loopbackHosts = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

// Shared temp roots. The root itself is never an acceptable scratch root, and
// these subtrees are out of bounds entirely: artifacts belong somewhere the
// caller named and can inspect.
const genericTempRoots = Object.freeze([
  '/tmp',
  '/var/tmp',
  '/private/var/tmp',
]);
// The one exception, because agent sessions are handed a deep scratch path
// underneath it. The root itself and anything shallow under it stay refused.
const deepTempRoot = '/private/tmp';
const minimumTempScratchDepth = 2;

const cliValueOptions = new Set([
  '--registry',
  '--scratch-dir',
  '--auth-token',
]);
const cliBooleanOptions = new Set(['--keep']);

// Both must resolve to the approved registry before any publish.
const registryConfigKeys = Object.freeze([
  'registry',
  `${sidecarScope}:registry`,
]);

function pathIsInside(child, parent) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function normalizeRegistryUrl(url) {
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

/**
 * Loopback-only. There is deliberately no override flag: the previous
 * `--allow-nonlocal-registry` escape hatch is the kind of thing that gets
 * pasted into a shell next to a real token, and nothing this proof does needs
 * a registry that is not on this machine.
 */
function assertLocalRegistry(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`--registry is not a URL: ${String(value)}`, {
      cause: error,
    });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`--registry must be http(s), found ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (publicRegistryHosts.has(host) || host.endsWith('.npmjs.org')) {
    throw new Error(
      [
        `Refusing to run the packed-consumer proof against the public registry ${url.href}.`,
        'This script publishes packages. Point --registry at a loopback registry you control.',
      ].join('\n'),
    );
  }
  if (!loopbackHosts.has(host)) {
    throw new Error(
      [
        `--registry ${url.href} is not a loopback address.`,
        'The packed-consumer proof publishes packages and only ever publishes to this machine; start a local registry and point --registry at it.',
      ].join('\n'),
    );
  }
  return normalizeRegistryUrl(url);
}

/**
 * The scratch ROOT is caller-owned: this proof creates a unique child inside
 * it and only ever deletes that child. The root must be outside the repository
 * so the working tree and its lockfile are unreachable, and it must not be a
 * shared temp root that other processes also write into.
 */
function assertOwnedScratchRoot(value, { tmpdir = os.tmpdir() } = {}) {
  if (!value) {
    throw new Error(
      '--scratch-dir is required: name an artifact directory this proof may create and delete inside.',
    );
  }
  const resolved = path.resolve(value);
  if (pathIsInside(resolved, repoRoot)) {
    throw new Error(
      '--scratch-dir must be outside the repository so the proof cannot touch the working tree or its lockfile.',
    );
  }

  const resolvedTmpdir = path.resolve(tmpdir);
  const sharedRoots = [...genericTempRoots, deepTempRoot, resolvedTmpdir];
  if (sharedRoots.includes(resolved)) {
    throw new Error(
      `--scratch-dir must not be the shared temp root ${resolved}; name a unique directory this proof owns inside it.`,
    );
  }

  // A deep, explicitly named directory under /private/tmp is caller-owned
  // enough: session scratch roots live there. Shallow paths are not.
  if (pathIsInside(resolved, deepTempRoot)) {
    const depth = path
      .relative(deepTempRoot, resolved)
      .split(path.sep)
      .filter(Boolean).length;
    if (depth < minimumTempScratchDepth) {
      throw new Error(
        [
          `--scratch-dir ${resolved} is too shallow under ${deepTempRoot}.`,
          `Pass a caller-owned directory at least ${minimumTempScratchDepth} path segments deep, so this proof cannot collide with anything else under ${deepTempRoot}.`,
        ].join('\n'),
      );
    }
    return resolved;
  }

  for (const forbidden of [...genericTempRoots, resolvedTmpdir]) {
    if (pathIsInside(resolved, forbidden)) {
      throw new Error(
        [
          `--scratch-dir must not live under ${forbidden}; pass a caller-owned artifact directory.`,
          `On macOS ${forbidden} may be the same directory as ${deepTempRoot}; pass its ${deepTempRoot} path if that is what you mean.`,
        ].join('\n'),
      );
    }
  }
  return resolved;
}

function parseArgs(argv) {
  rejectInlineOptionSyntax(argv, {
    booleanOptions: cliBooleanOptions,
    valueOptions: cliValueOptions,
  });
  const options = parseCliArgs(argv, {
    defaults: {
      authToken: null,
      keep: false,
      registry: undefined,
      scratchDir: undefined,
    },
    ignoreTerminator: true,
    options: {
      'auth-token': { key: 'authToken' },
      keep: { type: 'boolean' },
      registry: {},
      'scratch-dir': { key: 'scratchDir' },
    },
  });

  if (!options.registry) {
    throw new Error(
      'Missing --registry <loopback registry URL>, for example --registry http://127.0.0.1:4873',
    );
  }
  return {
    ...options,
    registry: assertLocalRegistry(options.registry),
    scratchRoot: assertOwnedScratchRoot(options.scratchDir),
  };
}

function run(command, args, { cwd, env, label }) {
  try {
    return String(
      execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch (error) {
    const detail = [error?.stdout, error?.stderr]
      .map(value => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
      .join('\n');
    throw new Error(
      `${label} failed:\n${detail || String(error?.message ?? error)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Registry safety
// ---------------------------------------------------------------------------

/**
 * Reduce `npm config get <key>` output to the single value line.
 *
 * npm writes diagnostics into this stream (a misconfigured scratch config makes
 * it emit `double-loading config ... as "global", previously loaded as "user"`
 * right where the value belongs). Those lines are dropped, and ANY remaining
 * ambiguity - zero value lines, or more than one - returns null so the caller
 * refuses to publish rather than parsing a warning as a registry.
 */
function extractNpmConfigValue(raw) {
  const lines = String(raw ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(
      line =>
        !/^npm\s+(warn|notice|error|info|http|verbose|silly|timing)\b/iu.test(
          line,
        ),
    );
  return lines.length === 1 ? lines[0] : null;
}

function normalizeRegistryConfigValue(raw) {
  const value = extractNpmConfigValue(raw);
  if (value === null || value === 'undefined' || value === 'null') {
    return null;
  }
  try {
    return normalizeRegistryUrl(new URL(value)).href;
  } catch {
    return null;
  }
}

/**
 * A single effective npm registry setting must be exactly the approved local
 * registry. `npm publish --registry <local>` is NOT sufficient on its own: a
 * scoped `@bleedingdev:registry` in any .npmrc npm can see wins over the
 * default registry for scoped packages.
 */
function assertRegistryConfigValue(key, raw, approvedHref) {
  const normalized = normalizeRegistryConfigValue(raw);
  if (normalized === null) {
    throw new Error(
      [
        `npm config "${key}" is ${String(raw ?? '').trim() || '<empty>'}, not a registry URL.`,
        `Refusing to publish: this proof requires "${key}" to resolve to exactly ${approvedHref}.`,
      ].join('\n'),
    );
  }
  if (normalized !== approvedHref) {
    throw new Error(
      [
        `npm config "${key}" resolves to ${normalized}, not the approved local registry ${approvedHref}.`,
        'Refusing to publish: an .npmrc npm can see is redirecting this publish off the local registry.',
      ].join('\n'),
    );
  }
  return normalized;
}

function assertEffectiveRegistries(cwd, env, registry, label) {
  for (const key of registryConfigKeys) {
    const raw = run('npm', ['config', 'get', key], {
      cwd,
      env,
      label: `npm config get ${key}`,
    });
    assertRegistryConfigValue(key, raw, registry.href);
  }
  return registry.href;
}

// npm loads one config file per ROLE and refuses to load a single path twice:
// pointing --userconfig and --globalconfig at the same file makes it emit
// `double-loading config ... as "global", previously loaded as "user"`. Each
// role therefore gets its own file with identical pins. Only the project role
// may be named `.npmrc`; the other two must not be, or npm would load the
// project file a second time under another role in the same directory.
const scratchNpmrcFileNames = Object.freeze({
  global: 'npmrc-global',
  project: '.npmrc',
  user: 'npmrc-user',
});

function writeScratchNpmrc(
  dir,
  registry,
  authToken,
  { fileName = scratchNpmrcFileNames.project } = {},
) {
  const authKey = `//${registry.host}${registry.pathname}:_authToken`;
  const lines = [
    `registry=${registry.href}`,
    // The scoped pin is the one that actually decides where an
    // @bleedingdev/* package is published.
    `${sidecarScope}:registry=${registry.href}`,
    'audit=false',
    'fund=false',
  ];
  if (authToken) {
    lines.push(`${authKey}=${authToken}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const npmrcPath = path.join(dir, fileName);
  fs.writeFileSync(npmrcPath, `${lines.join('\n')}\n`);
  return npmrcPath;
}

/**
 * The three config roles npm reads for this run - project (the cwd `.npmrc`),
 * user, and global - as three DISTINCT files carrying identical local pins, so
 * no ambient .npmrc can supply a registry and npm never double-loads one path.
 */
function writeScratchNpmrcSet(dir, registry, authToken) {
  const write = fileName =>
    writeScratchNpmrc(dir, registry, authToken, { fileName });
  return {
    globalPath: write(scratchNpmrcFileNames.global),
    projectPath: write(scratchNpmrcFileNames.project),
    userPath: write(scratchNpmrcFileNames.user),
  };
}

// ---------------------------------------------------------------------------
// Staging and packing: nothing published retains a public publish target
// ---------------------------------------------------------------------------

/**
 * Remove ONLY `publishConfig.registry`, preserving `access` and every other
 * field. Local-proof-only: this rewrites the scratch copy, never the
 * repository manifest the sidecar publishes from in CI.
 */
function sanitizePublishManifest(packageJson, label) {
  if (!isPlainObject(packageJson)) {
    throw new Error(`${label} manifest is not an object`);
  }
  const sanitized = { ...packageJson };
  const publishConfig = sanitized.publishConfig;
  if (publishConfig !== undefined) {
    if (!isPlainObject(publishConfig)) {
      throw new Error(`${label} publishConfig must be an object`);
    }
    const { registry: _removed, ...rest } = publishConfig;
    sanitized.publishConfig = rest;
  }
  if (sanitized.publishConfig?.access !== 'public') {
    throw new Error(
      `${label} must keep publishConfig.access "public" after sanitizing publishConfig.registry`,
    );
  }
  return sanitized;
}

function assertPackedManifestHasNoRegistry(tarballPath, label) {
  const bytes = fs.readFileSync(tarballPath);
  const manifest = JSON.parse(
    readNpmTarballFile(bytes, 'package.json').toString('utf8'),
  );
  if (Object.hasOwn(manifest.publishConfig ?? {}, 'registry')) {
    throw new Error(
      [
        `${label} tarball still declares publishConfig.registry ${String(manifest.publishConfig.registry)}.`,
        'npm honours a packed publishConfig.registry over --registry, so this tarball could publish to a public registry. Refusing to publish it.',
      ].join('\n'),
    );
  }
  if (Object.hasOwn(manifest, 'registry')) {
    throw new Error(`${label} tarball declares a top-level registry field`);
  }
  if (manifest.publishConfig?.access !== 'public') {
    throw new Error(`${label} tarball must publish with public access`);
  }
  return manifest;
}

/**
 * Copy a package into scratch and strip its publish target. The repository copy
 * is never touched.
 */
function stageSanitizedPackage(sourceDir, stageDir, { name, version }) {
  fs.rmSync(stageDir, { force: true, recursive: true });
  fs.mkdirSync(stageDir, { recursive: true });
  fs.cpSync(sourceDir, stageDir, {
    recursive: true,
    filter: source => {
      const base = path.basename(source);
      return base !== 'node_modules' && base !== '.git';
    },
  });
  const manifestPath = path.join(stageDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (packageJson.name !== name || packageJson.version !== version) {
    throw new Error(
      `Staged ${sourceDir} as ${String(packageJson.name)}@${String(packageJson.version)}, expected ${name}@${version}`,
    );
  }
  const sanitized = sanitizePublishManifest(packageJson, `${name}@${version}`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(sanitized, null, 2)}\n`);
  return { packageJson: sanitized, stageDir };
}

function packDirectory(packageDir, tarballsDir, label, env) {
  fs.mkdirSync(tarballsDir, { recursive: true });
  const stdout = run(
    'npm',
    [
      'pack',
      packageDir,
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      tarballsDir,
    ],
    { cwd: repoRoot, env, label: `npm pack ${label}` },
  );
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(`npm pack ${label} did not return exactly one artifact`);
  }
  const tarball = path.join(tarballsDir, parsed[0].filename);
  const packageJson = assertPackedManifestHasNoRegistry(tarball, label);
  const bytes = fs.readFileSync(tarball);
  const integrity = `sha512-${crypto
    .createHash('sha512')
    .update(bytes)
    .digest('base64')}`;
  const shasum = crypto.createHash('sha1').update(bytes).digest('hex');
  if (parsed[0].integrity !== integrity || parsed[0].shasum !== shasum) {
    throw new Error(
      `npm pack ${label} reported digests that differ from its tarball bytes`,
    );
  }
  return {
    bytes,
    filename: parsed[0].filename,
    integrity,
    name: parsed[0].name,
    packageJson,
    shasum,
    tarball,
    version: parsed[0].version,
  };
}

function proofImageVersion(
  now = Date.now(),
  random = crypto.randomBytes(4).toString('hex'),
) {
  // `r` prefix keeps the random identifier non-numeric, so a hex run of digits
  // can never become a leading-zero numeric identifier (invalid semver).
  return `${proofVersionBase}.${now}.r${random}`;
}

/**
 * Stage the cohort image package exactly as the publisher would: the fork
 * name, a per-run proof version, and exact `npm:@bleedingdev/...` aliases
 * projected from the staged sidecars. Nothing is written inside the repository.
 */
function stageCohortImagePackage(
  stageDir,
  {
    sidecars = collectSidecarPackages(repoRoot),
    version = proofImageVersion(),
  } = {},
) {
  const sourceDir = path.join(repoRoot, cohortImageSourceDir);
  const distDir = path.join(sourceDir, 'dist');
  if (!fs.statSync(distDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      [
        `${cohortImageSourceName} has no dist/; build it first (root command):`,
        '  pnpm --filter @modern-js/image build',
      ].join('\n'),
    );
  }
  fs.rmSync(stageDir, { force: true, recursive: true });
  fs.mkdirSync(stageDir, { recursive: true });
  fs.cpSync(sourceDir, stageDir, {
    recursive: true,
    filter: source => {
      const base = path.basename(source);
      return base !== 'node_modules' && base !== '.git';
    },
  });

  const manifestPath = path.join(stageDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (packageJson.name !== cohortImageSourceName) {
    throw new Error(
      `${cohortImageSourceDir} is ${String(packageJson.name)}, expected ${cohortImageSourceName}`,
    );
  }
  // devDependencies carry workspace: specifiers that no registry can resolve,
  // and a consumer never installs them; scripts would only run rslib again.
  delete packageJson.devDependencies;
  delete packageJson.scripts;
  packageJson.name = cohortImageTargetName;
  packageJson.version = version;
  packageJson.publishConfig = { access: 'public' };
  rewriteSidecarConsumerAliases(packageJson, sidecars);
  for (const [dependencyName, specifier] of Object.entries(
    packageJson.dependencies ?? {},
  )) {
    if (typeof specifier === 'string' && specifier.startsWith('workspace:')) {
      throw new Error(
        `${cohortImageTargetName} dependencies.${dependencyName} is ${specifier}; this proof only covers the registry-resolvable image cone`,
      );
    }
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return { packageJson, stageDir, version };
}

// ---------------------------------------------------------------------------
// Re-runnable publication against the local registry
// ---------------------------------------------------------------------------

/**
 * Read a packument from the local registry in the shape
 * `sidecarRegistryDecision` consumes. A 404 means "never published".
 */
async function readRegistryPackument(
  name,
  { registry, authToken, fetchImpl = globalThis.fetch },
) {
  const url = new URL(encodeURIComponent(name), registry);
  const headers = { accept: 'application/json' };
  if (authToken) {
    headers.authorization = `Bearer ${authToken}`;
  }
  const response = await fetchImpl(url, { headers });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `${name} registry metadata returned HTTP ${response.status} from ${registry.href}`,
    );
  }
  return await response.json();
}

/**
 * Publish one packed tarball, re-asserting the effective registry immediately
 * beforehand so nothing between argument parsing and the publish itself can
 * redirect it.
 */
function publishPacked(packed, { cwd, env, registry, label }) {
  assertEffectiveRegistries(cwd, env, registry, label);
  run(
    'npm',
    [
      'publish',
      packed.tarball,
      '--registry',
      registry.href,
      '--tag',
      'latest',
      '--access',
      'public',
      '--ignore-scripts',
    ],
    { cwd, env, label: `npm publish ${label}` },
  );
}

// ---------------------------------------------------------------------------
// The consumer proof itself (embedded, runs inside the installed tree)
// ---------------------------------------------------------------------------

/**
 * Resolve a package's directory and manifest starting from an entry path its
 * exports map already allows.
 *
 * `require.resolve('<pkg>/package.json')` is NOT usable here: a package that
 * declares `exports` without a `./package.json` subpath blocks it, which is the
 * case for @bleedingdev/modern-js-image and both sidecar forks. So the proof
 * starts at a public entry and walks ancestors to the first NAMED package.json,
 * which is the package that owns the entry, and checks that name.
 *
 * Stringified into the generated proof script, so it takes its `fs`/`path` and
 * refers to nothing in this module's scope.
 */
function resolvePackageFromEntry(entryPath, expectedName, io) {
  const { fs: fsImpl, path: pathImpl } = io;
  let dir = pathImpl.dirname(entryPath);
  for (;;) {
    const manifestPath = pathImpl.join(dir, 'package.json');
    if (fsImpl.existsSync(manifestPath)) {
      const manifest = JSON.parse(fsImpl.readFileSync(manifestPath, 'utf8'));
      // Nested package.json markers such as {"type":"module"} carry no name;
      // the first named manifest above the entry owns it.
      if (typeof manifest.name === 'string' && manifest.name.length > 0) {
        if (manifest.name !== expectedName) {
          throw new Error(
            `${entryPath} resolved into package ${manifest.name}, expected ${expectedName}`,
          );
        }
        return { dir, manifest };
      }
    }
    const parent = pathImpl.dirname(dir);
    if (parent === dir || pathImpl.basename(dir) === 'node_modules') {
      throw new Error(
        `Could not find the package.json owning ${entryPath} (expected ${expectedName})`,
      );
    }
    dir = parent;
  }
}

/**
 * The proof body. Stringified into the generated script, so every dependency
 * arrives through `io` and `config`, and `resolvePackageFromEntry` is resolved
 * as a free identifier defined alongside it in that script.
 */
async function consumerProofMain(config, io) {
  const {
    assert,
    createRequire,
    fs: fsImpl,
    path: pathImpl,
    pathToFileURL,
  } = io;
  const results = [];
  const record = (name, detail) => {
    results.push({ detail, name });
  };
  const walkIo = { fs: fsImpl, path: pathImpl };

  const consumerRequire = createRequire(
    pathImpl.join(process.cwd(), 'package.json'),
  );
  const imageEntry = consumerRequire.resolve(config.imageName);
  const image = resolvePackageFromEntry(imageEntry, config.imageName, walkIo);
  assert.equal(image.manifest.version, config.imageVersion);
  record(
    'cohort image package installed',
    `${image.manifest.name}@${image.manifest.version}`,
  );

  // 1. npm: alias resolution - the aliased request names must land on the
  //    forks, resolved from the image package's own entry.
  const imageRequire = createRequire(imageEntry);

  const coreEntry = imageRequire.resolve('@rsbuild-image/core');
  const core = resolvePackageFromEntry(coreEntry, config.coreName, walkIo);
  assert.equal(
    image.manifest.dependencies['@rsbuild-image/core'],
    `npm:${config.coreName}@${core.manifest.version}`,
  );
  record(
    '@rsbuild-image/core alias resolves',
    `${core.manifest.name}@${core.manifest.version}`,
  );

  const ipxEntry = imageRequire.resolve('ipx');
  const ipx = resolvePackageFromEntry(ipxEntry, config.ipxName, walkIo);
  assert.equal(
    image.manifest.dependencies.ipx,
    `npm:${config.ipxName}@${ipx.manifest.version}`,
  );
  record('ipx alias resolves', `${ipx.manifest.name}@${ipx.manifest.version}`);

  // 2. sharp stays on the 0.35 line (the exact patch floats with the range).
  const sharp = resolvePackageFromEntry(
    imageRequire.resolve('sharp'),
    'sharp',
    walkIo,
  );
  assert.match(
    sharp.manifest.version,
    new RegExp(config.sharpVersionPattern, 'u'),
    `sharp must resolve on 0.35, found ${sharp.manifest.version}`,
  );
  record('sharp resolves on 0.35', sharp.manifest.version);

  // 3. image-size resolves to the hardened fork, from inside the core fork.
  const coreRequire = createRequire(coreEntry);
  const imageSize = resolvePackageFromEntry(
    coreRequire.resolve('image-size'),
    config.imageSizeName,
    walkIo,
  );
  assert.equal(
    core.manifest.dependencies['image-size'],
    `npm:${config.imageSizeName}@${imageSize.manifest.version}`,
  );
  record(
    'image-size fork resolves',
    `${imageSize.manifest.name}@${imageSize.manifest.version}`,
  );

  // 4. CJS: ipx and the core fork's shared subpath.
  const ipxCjs = imageRequire('ipx');
  assert.equal(
    typeof ipxCjs.createIPX,
    'function',
    'ipx CJS entry must export createIPX',
  );
  record('ipx CJS import', `${Object.keys(ipxCjs).length} exports`);

  const sharedPath = imageRequire.resolve('@rsbuild-image/core/shared');
  assert.ok(
    fsImpl.existsSync(sharedPath),
    'core shared entry does not exist on disk',
  );
  const sharedCjs = imageRequire('@rsbuild-image/core/shared');
  assert.ok(
    sharedCjs && typeof sharedCjs === 'object',
    'core shared entry must export a namespace',
  );
  record(
    '@rsbuild-image/core/shared CJS import',
    pathImpl.relative(core.dir, sharedPath),
  );

  // 5. ESM: resolved from inside the installed image package, so the import
  //    conditions and node_modules layout are the consumer's real ones.
  const probePath = pathImpl.join(image.dir, 'ultramodern-esm-probe.mjs');
  fsImpl.writeFileSync(
    probePath,
    [
      "export * as ipx from 'ipx';",
      "export * as coreShared from '@rsbuild-image/core/shared';",
      '',
    ].join('\n'),
  );
  const probe = await import(pathToFileURL(probePath).href);

  const createIPX = probe.ipx.createIPX ?? probe.ipx.default?.createIPX;
  assert.equal(
    typeof createIPX,
    'function',
    'ipx ESM entry must export createIPX',
  );
  record('ipx ESM import', 'createIPX present');

  const sharedEsm = probe.coreShared;
  assert.ok(
    sharedEsm && typeof sharedEsm === 'object',
    'core shared ESM entry must export a namespace',
  );
  assert.ok(
    Object.keys(sharedEsm).length > 0,
    'core shared ESM namespace is empty',
  );
  record(
    '@rsbuild-image/core/shared ESM import',
    `${Object.keys(sharedEsm).length} export(s)`,
  );

  return results;
}

function buildConsumerProofSource(config) {
  return [
    "'use strict';",
    "const assert = require('node:assert/strict');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const { createRequire } = require('node:module');",
    "const { pathToFileURL } = require('node:url');",
    '',
    `const config = ${JSON.stringify(config, null, 2)};`,
    '',
    resolvePackageFromEntry.toString(),
    '',
    consumerProofMain.toString(),
    '',
    'consumerProofMain(config, { assert, createRequire, fs, path, pathToFileURL })',
    '  .then(results => {',
    '    console.log(JSON.stringify(results, null, 2));',
    '  })',
    '  .catch(error => {',
    '    console.error(error instanceof Error ? error.stack : String(error));',
    '    process.exit(1);',
    '  });',
    '',
  ].join('\n');
}

function assertNoInvalidPeerEdges(consumerDir, env) {
  let stdout;
  try {
    stdout = String(
      execFileSync('npm', ['ls', '--all', '--json'], {
        cwd: consumerDir,
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch (error) {
    // npm ls exits non-zero when the tree has problems; the JSON still carries
    // them, so read it rather than discarding the diagnosis.
    stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    if (!stdout) {
      throw new Error(
        `npm ls failed with no output: ${String(error?.message ?? error)}`,
      );
    }
  }
  const tree = JSON.parse(stdout);
  const problems = [];
  const walk = node => {
    for (const problem of node?.problems ?? []) {
      problems.push(problem);
    }
    for (const child of Object.values(node?.dependencies ?? {})) {
      walk(child);
    }
  };
  walk(tree);
  const peerProblems = problems.filter(problem =>
    /invalid|peer dep missing|missing:/iu.test(String(problem)),
  );
  if (peerProblems.length > 0) {
    throw new Error(
      [
        'The installed consumer tree has invalid or missing edges:',
        ...new Set(peerProblems),
      ].join('\n'),
    );
  }
  return problems.length;
}

// ---------------------------------------------------------------------------
// Scratch lifecycle
// ---------------------------------------------------------------------------

/**
 * Only the unique child this run created may be removed. The scratch root the
 * caller named is never deleted.
 */
function assertRemovableWorkDir(workDir, scratchRoot) {
  const resolvedWork = path.resolve(workDir);
  const resolvedRoot = path.resolve(scratchRoot);
  if (resolvedWork === resolvedRoot) {
    throw new Error(
      `Refusing to remove the caller-owned scratch root ${resolvedRoot}; only the unique run directory inside it is removable.`,
    );
  }
  if (!pathIsInside(resolvedWork, resolvedRoot)) {
    throw new Error(
      `Refusing to remove ${resolvedWork}: it is not inside the scratch root ${resolvedRoot}.`,
    );
  }
  return resolvedWork;
}

/**
 * Remove the unique run directory exactly once, on normal exit, on error, and
 * on SIGINT/SIGTERM. Signal handlers re-raise the signal after cleaning up so
 * the caller still observes a signal death, not a silent exit.
 */
function createScratchCleanup(workDir, options = {}) {
  const {
    keep = false,
    processRef = process,
    remove = dir => {
      fs.rmSync(dir, { force: true, recursive: true });
    },
    scratchRoot,
    signals = ['SIGINT', 'SIGTERM'],
  } = options;
  const removable = assertRemovableWorkDir(workDir, scratchRoot);

  let settled = false;
  const removeOnce = () => {
    if (settled) {
      return false;
    }
    settled = true;
    if (keep) {
      return false;
    }
    remove(removable);
    return true;
  };

  const handlers = new Map();
  const dispose = () => {
    for (const [signal, handler] of handlers) {
      processRef.off(signal, handler);
    }
    handlers.clear();
  };
  for (const signal of signals) {
    const handler = () => {
      removeOnce();
      dispose();
      processRef.kill(processRef.pid, signal);
    };
    handlers.set(signal, handler);
    processRef.on(signal, handler);
  }

  return {
    dispose,
    finish: () => {
      dispose();
      return removeOnce();
    },
    signals: [...signals],
    workDir: removable,
  };
}

// ---------------------------------------------------------------------------

async function verifySidecarConsumer(options) {
  const workDir = path.join(
    options.scratchRoot,
    `sidecar-consumer-proof-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
  );
  fs.mkdirSync(workDir, { recursive: true });
  const cleanup = createScratchCleanup(workDir, {
    keep: options.keep,
    scratchRoot: options.scratchRoot,
  });

  const npmrc = writeScratchNpmrcSet(
    workDir,
    options.registry,
    options.authToken,
  );
  const env = {
    ...process.env,
    npm_config_registry: options.registry.href,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    // Neither a user-level nor a global .npmrc may redirect this run at a
    // public registry: each role points at its own scratch file.
    npm_config_globalconfig: npmrc.globalPath,
    npm_config_userconfig: npmrc.userPath,
  };

  try {
    const tarballsDir = path.join(workDir, 'tarballs');
    assertEffectiveRegistries(workDir, env, options.registry, 'startup');

    // The sidecars publish in the same alias order the CI lane uses, and the
    // cohort image aliases are checked against them before anything is sent.
    const sidecars = sidecarPublishOrder(collectSidecarPackages(repoRoot));
    const imageVersion = proofImageVersion();
    const stagedImage = stageCohortImagePackage(path.join(workDir, 'image'), {
      sidecars,
      version: imageVersion,
    });
    validateAliasConsistency(
      [{ name: cohortImageTargetName, packageJson: stagedImage.packageJson }],
      sidecars,
    );
    console.log(
      `Sidecar publish order: ${sidecars.map(item => `${item.name}@${item.version}`).join(' -> ')}`,
    );

    const reused = [];
    for (const sidecar of sidecars) {
      const staged = stageSanitizedPackage(
        sidecar.dir,
        path.join(workDir, 'sidecars', sidecar.name.replaceAll('/', '__')),
        { name: sidecar.name, version: sidecar.version },
      );
      const packed = packDirectory(
        staged.stageDir,
        tarballsDir,
        sidecar.name,
        env,
      );
      if (packed.name !== sidecar.name || packed.version !== sidecar.version) {
        throw new Error(
          `Packed ${packed.name}@${packed.version}, expected ${sidecar.name}@${sidecar.version}`,
        );
      }

      // Re-runs are the normal case against a registry a root keeps between
      // runs. The exact stable version is immutable, so it is reused only when
      // the published copy resolves identically to what this run staged; every
      // other state (content drift, a tag pointing elsewhere, a backwards
      // latest) throws instead of hitting E403 halfway through.
      const decision = sidecarRegistryDecision(
        {
          integrity: packed.integrity,
          name: sidecar.name,
          packageJson: packed.packageJson,
          shasum: packed.shasum,
          version: sidecar.version,
        },
        await readRegistryPackument(sidecar.name, options),
        { tag: 'latest' },
      );
      if (decision.action === 'reuse') {
        reused.push(`${sidecar.name}@${sidecar.version}`);
        console.log(`Reusing ${decision.reason}`);
        continue;
      }

      publishPacked(packed, {
        cwd: workDir,
        env,
        label: sidecar.name,
        registry: options.registry,
      });
      console.log(
        `Published ${sidecar.name}@${sidecar.version} to ${options.registry.href}`,
      );
    }

    const packedImage = packDirectory(
      stagedImage.stageDir,
      tarballsDir,
      cohortImageTargetName,
      env,
    );
    const imagePackument = await readRegistryPackument(
      cohortImageTargetName,
      options,
    );
    if (Object.hasOwn(imagePackument?.versions ?? {}, packedImage.version)) {
      throw new Error(
        `${cohortImageTargetName}@${packedImage.version} already exists on ${options.registry.href}; this per-run proof version must be unique.`,
      );
    }
    publishPacked(packedImage, {
      cwd: workDir,
      env,
      label: cohortImageTargetName,
      registry: options.registry,
    });
    console.log(
      `Published ${cohortImageTargetName}@${packedImage.version} to ${options.registry.href}`,
    );

    const consumerDir = path.join(workDir, 'consumer');
    fs.mkdirSync(consumerDir, { recursive: true });
    writeScratchNpmrc(consumerDir, options.registry, options.authToken);
    fs.writeFileSync(
      path.join(consumerDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'ultramodern-sidecar-consumer-proof',
          version: '0.0.0',
          private: true,
          dependencies: {
            [cohortImageTargetName]: packedImage.version,
            react: '^19.2.8',
            'react-dom': '^19.2.8',
          },
        },
        null,
        2,
      )}\n`,
    );

    console.log(
      'Installing the packed consumer with strict peer resolution...',
    );
    run(
      'npm',
      [
        'install',
        '--registry',
        options.registry.href,
        '--strict-peer-deps',
        '--no-audit',
        '--no-fund',
        '--foreground-scripts',
      ],
      { cwd: consumerDir, env, label: 'npm install (strict peers)' },
    );

    const problemCount = assertNoInvalidPeerEdges(consumerDir, env);
    console.log(
      `npm ls reported ${problemCount} tree problem(s); none invalid or missing.`,
    );

    const proofPath = path.join(consumerDir, 'sidecar-consumer-proof.cjs');
    fs.writeFileSync(
      proofPath,
      buildConsumerProofSource({
        coreName: '@bleedingdev/rsbuild-image-core',
        imageName: cohortImageTargetName,
        imageSizeName: '@bleedingdev/image-size',
        imageVersion: packedImage.version,
        ipxName: '@bleedingdev/ipx',
        sharpVersionPattern: '^0\\.35\\.',
      }),
    );
    const proofOutput = run('node', [proofPath], {
      cwd: consumerDir,
      env,
      label: 'packed consumer proof',
    });
    console.log(proofOutput.trim());
    console.log(
      `\nPacked-consumer proof PASSED against ${options.registry.href}\n` +
        `Sidecars: ${sidecars.map(item => `${item.name}@${item.version}`).join(', ')}\n` +
        `Reused:   ${reused.length > 0 ? reused.join(', ') : 'none (all published this run)'}\n` +
        `Cohort:   ${cohortImageTargetName}@${packedImage.version}`,
    );
    return { consumerDir, registry: options.registry.href, workDir };
  } finally {
    const removed = cleanup.finish();
    if (!removed) {
      console.log(`Keeping scratch directory ${workDir} (--keep)`);
    }
  }
}

async function main() {
  await verifySidecarConsumer(parseArgs(process.argv.slice(2)));
}

if (isDirectRun(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export {
  assertLocalRegistry,
  assertOwnedScratchRoot,
  assertPackedManifestHasNoRegistry,
  assertRegistryConfigValue,
  assertRemovableWorkDir,
  buildConsumerProofSource,
  cohortImageTargetName,
  consumerProofMain,
  createScratchCleanup,
  extractNpmConfigValue,
  packDirectory,
  parseArgs,
  proofImageVersion,
  registryConfigKeys,
  resolvePackageFromEntry,
  sanitizePublishManifest,
  scratchNpmrcFileNames,
  stageCohortImagePackage,
  verifySidecarConsumer,
  writeScratchNpmrc,
  writeScratchNpmrcSet,
};
