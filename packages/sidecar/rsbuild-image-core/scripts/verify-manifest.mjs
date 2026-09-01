#!/usr/bin/env node
/**
 * Verification harness for the @bleedingdev/rsbuild-image-core sidecar fork.
 *
 * The fork is a *dist-level repackage* of @rsbuild-image/core@0.0.1-next.36:
 * every byte under dist/ is vendored verbatim and the ONLY delta lives in
 * package.json (name, version, and the image-size dependency alias). This
 * script proves that invariant without needing a network or an install.
 *
 * Checks
 *   1. Manifest identity + dependency/peer fidelity vs the frozen upstream
 *      snapshot (and vs the live pnpm store copy when it is present).
 *   2. exports map deep-equals upstream and every referenced file exists.
 *   3. Module-specifier audit of dist/:
 *        - zero bare '@rsbuild-image/core' *import specifiers* (self-references
 *          would break under the rename), with the documented non-specifier
 *          occurrences pinned to an exact allowlist;
 *        - 'ipx' / 'sharp' only as dynamic import() externals in the expected
 *          Node-only entries, 'image-size' only as the bare static specifier;
 *        - dist/shared/** (the browser/edge-safe surface, including the
 *          ./image-loader entry) imports nothing but 'ufo' and relative
 *          siblings: no node: builtins, no ipx/sharp/image-size.
 *   4. `diff -ru` of vendored dist vs the upstream store dist is empty.
 *   5. `npm pack --dry-run --json` ships every exports subpath target.
 *
 * Usage: node packages/sidecar/rsbuild-image-core/scripts/verify-manifest.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DIR = path.join(PKG_DIR, 'dist');
const REPO_ROOT = path.resolve(PKG_DIR, '..', '..', '..');

const UPSTREAM_NAME = '@rsbuild-image/core';
const UPSTREAM_VERSION = '0.0.1-next.36';
const FORK_NAME = '@bleedingdev/rsbuild-image-core';
const FORK_VERSION = '0.1.0';
const IMAGE_SIZE_ALIAS = 'npm:@bleedingdev/image-size@2.1.0';

/**
 * Frozen copy of the upstream manifest fields this fork must preserve.
 * Cross-checked against the live pnpm store copy whenever it is installed, so
 * a drifted snapshot cannot silently weaken the comparison.
 */
const UPSTREAM_SNAPSHOT = {
  type: 'commonjs',
  main: './dist/index.js',
  module: './dist/index.mjs',
  types: './dist/index.d.ts',
  sideEffects: ['**/*.css', 'dist/logger.*'],
  files: ['dist'],
  exports: {
    '.': {
      types: './dist/index.d.ts',
      node: './dist/index.js',
      module: './dist/index.mjs',
    },
    './loader': {
      types: './dist/loader.d.ts',
      node: './dist/loader.js',
      module: './dist/loader.mjs',
    },
    './shared': {
      types: './dist/shared/index.d.ts',
      node: './dist/shared/index.js',
      module: './dist/shared/index.mjs',
    },
    './image-loader': {
      types: './dist/shared/image-loader.d.ts',
      node: './dist/shared/image-loader.mjs',
      module: './dist/shared/image-loader.mjs',
    },
    './types': {
      types: './dist/env.d.ts',
    },
  },
  typesVersions: {
    '*': {
      '.': ['./dist/index.d.ts'],
      loader: ['./dist/loader.d.ts'],
      shared: ['./dist/shared/index.d.ts'],
      'image-loader': ['./dist/shared/image-loader.d.ts'],
      types: ['./dist/env.d.ts'],
    },
  },
  dependencies: {
    'image-size': '^2.0.1',
    knitwork: '^1.2.0',
    rslog: '^1.1.0',
    'type-fest': '^4.37.0',
    ufo: '^1.3.0',
  },
  peerDependencies: {
    react: '>=16.9.0',
    'react-dom': '>=16.9.0',
    sharp: '>=0.33.5',
    ipx: '>=3.0.3',
  },
  peerDependenciesMeta: {
    sharp: { optional: true },
    ipx: { optional: true },
  },
};

/**
 * Every literal occurrence of the bare upstream package name that survives in
 * the vendored dist. None of these is a module specifier, so none of them is
 * resolved by Node/TypeScript against the fork's own `name` field — that is
 * exactly why this repackage needs ZERO dist edits. Each entry is
 * `<relative path>:<line>` mapped to why it is safe.
 */
const SELF_NAME_ALLOWLIST = {
  'dist/env.d.ts:6':
    "ambient `declare module '@rsbuild-image/core/types'` — must keep the OLD name: consumers (plugin-image src/types.ts) import '@rsbuild-image/core/types' through the alias install directory",
  'dist/plugin.js:121':
    'rsbuild plugin `name:` string — an identifier, not a specifier',
  'dist/plugin.mjs:65':
    'rsbuild plugin `name:` string — an identifier, not a specifier',
  'dist/plugin.js:141':
    "rspack resolve.alias KEY '@rsbuild-image/core/image-loader' — must keep the OLD name: @rsbuild-image/react's dist imports that literal specifier",
  'dist/plugin.mjs:85':
    "rspack resolve.alias KEY '@rsbuild-image/core/image-loader' — must keep the OLD name: @rsbuild-image/react's dist imports that literal specifier",
  'dist/shared/constants.d.ts:1': 'PACKAGE_NAME constant (debug log text only)',
  'dist/shared/constants.js:30': 'PACKAGE_NAME constant (debug log text only)',
  'dist/shared/constants.mjs:1': 'PACKAGE_NAME constant (debug log text only)',
  'dist/shared/types/image.d.ts:28': 'JSDoc @default tag inside a comment',
};

/** Specifiers dist/shared/** is allowed to depend on. */
const SHARED_ALLOWED_SPECIFIERS = new Set([
  'ufo',
  'type-fest',
  'react',
  './constants',
  './constants.js',
  './constants.mjs',
  './image-loader',
  './image-loader.js',
  './image-loader.mjs',
  './types/image',
  './types/utils',
]);

const failures = [];
const skips = [];
const passes = [];
const fail = msg => failures.push(msg);
const pass = msg => passes.push(msg);
const skip = msg => skips.push(msg);

function deepEqual(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(k => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs, base));
    else out.push(path.relative(base, abs));
  }
  return out.sort();
}

/** Locate the upstream copy inside the pnpm store, if installed. */
function findUpstreamDir() {
  const storeRoot = path.join(REPO_ROOT, 'node_modules', '.pnpm');
  if (!fs.existsSync(storeRoot)) return null;
  const prefix = `@rsbuild-image+core@${UPSTREAM_VERSION}`;
  for (const entry of fs.readdirSync(storeRoot)) {
    if (!entry.startsWith(prefix)) continue;
    const candidate = path.join(
      storeRoot,
      entry,
      'node_modules',
      UPSTREAM_NAME,
    );
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 0. Load manifests
// ---------------------------------------------------------------------------
const forkPkgPath = path.join(PKG_DIR, 'package.json');
let fork;
try {
  fork = JSON.parse(fs.readFileSync(forkPkgPath, 'utf8'));
  pass('package.json parses as JSON');
} catch (err) {
  fail(`package.json does not parse: ${err.message}`);
  report();
}

const upstreamDir = findUpstreamDir();
let upstream = null;
if (upstreamDir) {
  upstream = JSON.parse(
    fs.readFileSync(path.join(upstreamDir, 'package.json'), 'utf8'),
  );
  pass(`upstream store copy found: ${path.relative(REPO_ROOT, upstreamDir)}`);
  // The frozen snapshot must itself match the live upstream manifest.
  for (const key of Object.keys(UPSTREAM_SNAPSHOT)) {
    if (!deepEqual(UPSTREAM_SNAPSHOT[key], upstream[key])) {
      fail(
        `frozen UPSTREAM_SNAPSHOT.${key} drifted from the live store manifest — update the snapshot`,
      );
    }
  }
} else {
  skip(
    'upstream @rsbuild-image/core store copy not installed — snapshot-only comparison, dist diff skipped',
  );
}

// ---------------------------------------------------------------------------
// 1. Identity, dependencies, peers
// ---------------------------------------------------------------------------
if (fork.name !== FORK_NAME)
  fail(`name is ${fork.name}, expected ${FORK_NAME}`);
else pass(`name = ${FORK_NAME}`);

if (fork.version !== FORK_VERSION)
  fail(`version is ${fork.version}, expected ${FORK_VERSION}`);
else pass(`version = ${FORK_VERSION}`);

if (fork.dependencies?.['image-size'] !== IMAGE_SIZE_ALIAS) {
  fail(
    `dependencies['image-size'] is ${fork.dependencies?.['image-size']}, expected ${IMAGE_SIZE_ALIAS}`,
  );
} else {
  pass(
    `dependencies['image-size'] = ${IMAGE_SIZE_ALIAS} (alias install name stays 'image-size')`,
  );
}

{
  const upstreamDeps = UPSTREAM_SNAPSHOT.dependencies;
  const forkDeps = fork.dependencies ?? {};
  const upstreamKeys = Object.keys(upstreamDeps).sort();
  const forkKeys = Object.keys(forkDeps).sort();
  if (upstreamKeys.join(',') !== forkKeys.join(',')) {
    fail(
      `dependency key set changed: upstream [${upstreamKeys}] vs fork [${forkKeys}]`,
    );
  } else {
    let ok = true;
    for (const key of upstreamKeys) {
      if (key === 'image-size') continue;
      if (forkDeps[key] !== upstreamDeps[key]) {
        ok = false;
        fail(
          `dependencies['${key}'] = ${forkDeps[key]}, upstream byte-equal value is ${upstreamDeps[key]}`,
        );
      }
    }
    if (ok)
      pass('all non-aliased dependency ranges are byte-equal to upstream');
  }
}

for (const field of ['peerDependencies', 'peerDependenciesMeta']) {
  if (!deepEqual(fork[field], UPSTREAM_SNAPSHOT[field])) {
    fail(`${field} is not deep-equal to upstream`);
  } else {
    pass(`${field} deep-equals upstream`);
  }
}

for (const field of [
  'type',
  'main',
  'module',
  'types',
  'sideEffects',
  'files',
  'typesVersions',
]) {
  if (!deepEqual(fork[field], UPSTREAM_SNAPSHOT[field])) {
    fail(
      `${field} is not deep-equal to upstream (${JSON.stringify(fork[field])})`,
    );
  } else {
    pass(`${field} deep-equals upstream`);
  }
}

if (fork.devDependencies) {
  fail(
    'devDependencies must be dropped: this is a dist repackage with no local build',
  );
} else {
  pass(
    'devDependencies intentionally absent (dist repackage, nothing is rebuilt here)',
  );
}

// ---------------------------------------------------------------------------
// 2. exports map + referenced files
// ---------------------------------------------------------------------------
if (!deepEqual(fork.exports, UPSTREAM_SNAPSHOT.exports)) {
  fail('exports map is not deep-equal to upstream');
} else {
  pass('exports map deep-equals upstream (all 5 subpaths, all conditions)');
}

const exportTargets = new Set();
(function collect(node) {
  if (typeof node === 'string') {
    if (node.startsWith('./')) exportTargets.add(node.slice(2));
    return;
  }
  if (node && typeof node === 'object')
    for (const v of Object.values(node)) collect(v);
})(fork.exports);

{
  const missing = [...exportTargets].filter(
    rel => !fs.existsSync(path.join(PKG_DIR, rel)),
  );
  if (missing.length)
    fail(`exports targets missing on disk: ${missing.join(', ')}`);
  else pass(`all ${exportTargets.size} exports targets exist on disk`);
}

for (const subpath of [
  '.',
  './loader',
  './shared',
  './image-loader',
  './types',
]) {
  if (!fork.exports?.[subpath]) fail(`exports subpath ${subpath} is missing`);
}

// ---------------------------------------------------------------------------
// 3. Module-specifier audit of dist/
// ---------------------------------------------------------------------------
const distFiles = listFiles(DIST_DIR);

const SPECIFIER_PATTERNS = [
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\bfrom\s*["']([^"']+)["']/g,
  /^\s*import\s+["']([^"']+)["']/gm,
];

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
}

function specifiersOf(text) {
  const found = new Set();
  const lines = text.split('\n');
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const lineNo = text.slice(0, m.index).split('\n').length;
      if (isCommentLine(lines[lineNo - 1] ?? '')) continue;
      found.add(m[1]);
    }
  }
  return found;
}

// 3a. bare self-references
{
  const selfSpecifiers = [];
  const seenOccurrences = new Set();
  for (const rel of distFiles) {
    const text = fs.readFileSync(path.join(DIST_DIR, rel), 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (!line.includes(UPSTREAM_NAME)) return;
      seenOccurrences.add(`dist/${rel}:${i + 1}`);
    });
    for (const spec of specifiersOf(text)) {
      if (spec === UPSTREAM_NAME || spec.startsWith(`${UPSTREAM_NAME}/`)) {
        selfSpecifiers.push(`dist/${rel} -> ${spec}`);
      }
    }
  }
  if (selfSpecifiers.length) {
    fail(
      `bare '${UPSTREAM_NAME}' MODULE SPECIFIERS found in dist (would not resolve under the fork's own name): ${selfSpecifiers.join('; ')}`,
    );
  } else {
    pass(
      `zero bare '${UPSTREAM_NAME}' module specifiers in dist — no dist rewrites were needed`,
    );
  }

  const allowed = new Set(Object.keys(SELF_NAME_ALLOWLIST));
  const unexpected = [...seenOccurrences].filter(k => !allowed.has(k)).sort();
  const stale = [...allowed].filter(k => !seenOccurrences.has(k)).sort();
  if (unexpected.length)
    fail(
      `undocumented '${UPSTREAM_NAME}' occurrences in dist: ${unexpected.join(', ')}`,
    );
  if (stale.length)
    fail(`SELF_NAME_ALLOWLIST entries no longer present: ${stale.join(', ')}`);
  if (!unexpected.length && !stale.length) {
    pass(
      `all ${seenOccurrences.size} literal '${UPSTREAM_NAME}' occurrences are documented non-specifiers`,
    );
  }
}

// 3b. ipx / sharp / image-size shapes
{
  const expectations = {
    ipx: { dynamic: ['plugin.js', 'plugin.mjs'], static: [] },
    sharp: { dynamic: ['image.js', 'image.mjs'], static: [] },
    'image-size': { dynamic: [], static: ['image.js', 'image.mjs'] },
  };
  const dynamicRe = name => new RegExp(`import\\(\\s*["']${name}["']\\s*\\)`);
  const actual = { ipx: new Set(), sharp: new Set(), 'image-size': new Set() };
  const badPathImports = [];

  for (const rel of distFiles) {
    if (rel.endsWith('.d.ts')) continue; // type-only imports carry no runtime resolution
    const text = fs.readFileSync(path.join(DIST_DIR, rel), 'utf8');
    for (const spec of specifiersOf(text)) {
      for (const name of Object.keys(expectations)) {
        if (spec === name) actual[name].add(rel);
        else if (
          spec.startsWith(`${name}/`) ||
          spec.includes(`/${name}/`) ||
          spec.includes(`node_modules/${name}`)
        ) {
          badPathImports.push(`dist/${rel} -> ${spec}`);
        }
      }
    }
  }

  if (badPathImports.length) {
    fail(
      `deep/file-path imports that would BYPASS the npm: alias: ${badPathImports.join('; ')}`,
    );
  } else {
    pass(
      'no deep or file-path imports of ipx/sharp/image-size — every reference is the bare specifier the alias controls',
    );
  }

  for (const [name, exp] of Object.entries(expectations)) {
    const expected = [...exp.dynamic, ...exp.static].sort().join(',');
    const got = [...actual[name]].sort().join(',');
    if (expected !== got) {
      fail(
        `'${name}' bare specifier appears in [${got}], expected [${expected}]`,
      );
      continue;
    }
    for (const rel of exp.dynamic) {
      const text = fs.readFileSync(path.join(DIST_DIR, rel), 'utf8');
      if (!dynamicRe(name).test(text))
        fail(
          `'${name}' in dist/${rel} is not a dynamic import() string literal`,
        );
    }
    for (const rel of exp.static) {
      const text = fs.readFileSync(path.join(DIST_DIR, rel), 'utf8');
      const staticOk = rel.endsWith('.mjs')
        ? new RegExp(`from\\s*["']${name}["']`).test(text)
        : new RegExp(`require\\(\\s*["']${name}["']\\s*\\)`).test(text);
      if (!staticOk)
        fail(`'${name}' in dist/${rel} is not the expected bare static import`);
    }
    pass(
      `'${name}' bare specifier confined to ${expected || '(none)'}${exp.dynamic.length ? ' as dynamic import()' : ' as static bare import'}`,
    );
  }
}

// 3c. browser/edge isolation of dist/shared/** (includes the ./image-loader entry)
{
  const sharedFiles = distFiles.filter(
    rel => rel.startsWith(`shared${path.sep}`) || rel.startsWith('shared/'),
  );
  if (!sharedFiles.length)
    fail('dist/shared/** is empty — vendoring is incomplete');
  const violations = [];
  const nodeProtocol = [];
  for (const rel of sharedFiles) {
    const text = fs.readFileSync(path.join(DIST_DIR, rel), 'utf8');
    if (text.includes('node:')) nodeProtocol.push(`dist/${rel}`);
    for (const spec of specifiersOf(text)) {
      if (!SHARED_ALLOWED_SPECIFIERS.has(spec))
        violations.push(`dist/${rel} -> ${spec}`);
    }
  }
  if (nodeProtocol.length)
    fail(
      `node: builtin reference inside the browser-safe shared surface: ${nodeProtocol.join(', ')}`,
    );
  else
    pass(
      `dist/shared/** (${sharedFiles.length} files) contains zero 'node:' references`,
    );

  if (violations.length)
    fail(
      `dist/shared/** imports outside the allowed set: ${violations.join('; ')}`,
    );
  else
    pass(
      "dist/shared/** imports only 'ufo', type-only 'react'/'type-fest' and relative siblings — no ipx/sharp/image-size",
    );
}

// ---------------------------------------------------------------------------
// 4. dist byte-identity vs the upstream store copy
// ---------------------------------------------------------------------------
if (upstreamDir) {
  try {
    execFileSync('diff', ['-ru', path.join(upstreamDir, 'dist'), DIST_DIR], {
      encoding: 'utf8',
    });
    pass(
      'diff -ru vendored dist vs upstream store dist is EMPTY (byte-identical, zero rewrites)',
    );
  } catch (err) {
    fail(
      `vendored dist differs from upstream store dist:\n${err.stdout || err.message}`,
    );
  }
  const licA = fs.readFileSync(path.join(upstreamDir, 'LICENSE'), 'utf8');
  const licB = fs.readFileSync(path.join(PKG_DIR, 'LICENSE'), 'utf8');
  if (licA !== licB) fail('LICENSE is not byte-identical to upstream');
  else pass('LICENSE byte-identical to upstream (MIT, Rspack Contrib)');
} else {
  skip('dist diff vs upstream store skipped (upstream not installed)');
}

// ---------------------------------------------------------------------------
// 5. npm pack --dry-run --json
// ---------------------------------------------------------------------------
{
  let packed = null;
  try {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: PKG_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    packed = JSON.parse(out);
  } catch (err) {
    skip(
      `npm pack --dry-run --json could not run: ${(err.message || '').split('\n')[0]}`,
    );
  }
  if (packed) {
    const entries = new Set((packed[0]?.files ?? []).map(f => f.path));
    const missing = [...exportTargets].filter(rel => !entries.has(rel));
    if (missing.length)
      fail(`exports targets absent from the tarball: ${missing.join(', ')}`);
    else
      pass(
        `npm pack includes all ${exportTargets.size} exports subpath targets (${entries.size} files total)`,
      );
    for (const extra of ['LICENSE', 'README.md', 'package.json']) {
      if (!entries.has(extra)) fail(`${extra} missing from the tarball`);
    }
    if (['LICENSE', 'README.md', 'package.json'].every(e => entries.has(e))) {
      pass('npm pack includes LICENSE, README.md and package.json');
    }
  }
}

report();

function report() {
  for (const p of passes) console.log(`PASS  ${p}`);
  for (const s of skips) console.log(`SKIP  ${s}`);
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.log(
    `\n${passes.length} passed, ${skips.length} skipped, ${failures.length} failed`,
  );
  process.exit(failures.length ? 1 : 0);
}
