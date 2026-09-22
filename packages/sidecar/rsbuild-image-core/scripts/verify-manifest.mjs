#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
/** Verify the pinned upstream recipe, manifest, browser-safe surface and packed exports. */
import { verifySidecar } from '../../../../scripts/ultramodern-supply/verify-sidecars.mjs';

const PKG_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DIR = path.join(PKG_DIR, 'dist');

const UPSTREAM_NAME = '@rsbuild-image/core';
await verifySidecar('rsbuild-image-core');

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
const passes = [];
const fail = msg => failures.push(msg);
const pass = msg => passes.push(msg);

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs, base));
    else out.push(path.relative(base, abs));
  }
  return out.sort();
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
    fail(
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
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}
