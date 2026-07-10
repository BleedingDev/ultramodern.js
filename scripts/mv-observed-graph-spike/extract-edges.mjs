#!/usr/bin/env node
// W5 observed-graph spike — extract OBSERVED consumption edges from a generated
// MicroVertical workspace and diff them against DECLARED edges.
//
// Read-only. Run:
//   node scripts/mv-observed-graph-spike/extract-edges.mjs <workspaceDir>
//
// Observed grammars (literal specifiers only — no dynamic/nonliteral resolution):
//   G1  package-subpath import/export-from:  '@<scope>/<unit>/<sub>'
//        sub 'Widget' -> #Widget (MF),  'Route' -> #Route (MF),
//        'api/client' | 'api/clients' -> #api (API)
//   G2  MF runtime literal:  createHydratedRemote(Ident, '<alias>/<Expose>')
//   G3  bare MF runtime:     loadRemote('<literal>')   (expected: 0 — see report)
//
// Consumer unit is attributed from the file path:
//   apps/<id>/**  -> unit <id>       verticals/<id>/** -> unit <id>
//
// Declared edges come from .modernjs/ultramodern.json:
//   shell moduleFederation.verticalRefs[]  -> consumer(shell) -> provider#Widget/#Route
//   api.consumedBy[]                       -> each consumer -> provider#api

import fs from 'node:fs';
import path from 'node:path';

const SRC_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  'dist-ssg',
  '.git',
  'coverage',
]);

const wsRoot = path.resolve(process.argv[2] ?? '');
if (!fs.existsSync(path.join(wsRoot, '.modernjs/ultramodern.json'))) {
  console.error(`Not an ultramodern workspace: ${wsRoot}`);
  process.exit(2);
}

// ---- reused-from-audit.mjs shape: recursive source walker -------------------
function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(path.join(dir, e.name), files);
    } else if (SRC_EXT.has(path.extname(e.name))) {
      files.push(path.join(dir, e.name));
    }
  }
  return files;
}

// ---- consumer-unit attribution from workspace-relative path -----------------
function consumerUnit(relPath) {
  const seg = relPath.split('/');
  if (seg[0] === 'apps' || seg[0] === 'verticals') return seg[1];
  return null; // packages/**, scripts/**, topology/** are not delivery units
}

// ---- surface mapping for a package subpath ----------------------------------
function surfaceForSubpath(sub) {
  if (sub === 'Widget') return 'Widget';
  if (sub === 'Route') return 'Route';
  if (sub === 'api/client' || sub === 'api/clients') return 'api';
  return null;
}

const contract = JSON.parse(
  fs.readFileSync(path.join(wsRoot, '.modernjs/ultramodern.json'), 'utf-8'),
);
const scope = contract.workspace.packageScope; // e.g. mv-spike
const apps = contract.topology.apps;
const unitIds = new Set(apps.map(a => a.id));
// package-suffix -> unit id (suffix is the second path seg of '@scope/<suffix>')
const suffixToUnit = new Map(apps.map(a => [a.packageSuffix, a.id]));
// MF remote alias -> unit id (from shell remotes registration)
const aliasToUnit = new Map();
for (const app of apps) {
  for (const r of app.moduleFederation?.remotes ?? []) {
    aliasToUnit.set(r.alias, r.id);
  }
}

// ---- OBSERVED extraction -----------------------------------------------------
const observed = new Map(); // key -> {consumer,provider,surface,grammar,evidence[]}
function addObserved(consumer, provider, surface, grammar, evidence) {
  if (!consumer || !provider || !surface) return;
  const key = `${consumer}->${provider}#${surface}`;
  if (!observed.has(key)) {
    observed.set(key, { consumer, provider, surface, grammar, evidence: [] });
  }
  observed.get(key).evidence.push(evidence);
}

const importRe = /\b(?:import|export)\b[^'"`]*?\bfrom\s*['"]([^'"]+)['"]/g;
const bareImportRe = /\bimport\s*['"]([^'"]+)['"]/g;
const hydratedRe =
  /createHydratedRemote\s*\(\s*[A-Za-z0-9_$]+\s*,\s*['"]([^'"]+)['"]/g;
const loadRemoteLiteralRe =
  /\bloadRemote\s*(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]/g;

const scopePrefix = `@${scope}/`;
let loadRemoteLiteralHits = 0;

for (const abs of walk(wsRoot)) {
  const rel = path.relative(wsRoot, abs).split(path.sep).join('/');
  const consumer = consumerUnit(rel);
  if (!consumer) continue;
  const code = fs.readFileSync(abs, 'utf-8');

  const specs = [];
  for (const re of [importRe, bareImportRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) specs.push(m[1]);
  }

  // G1: package-subpath imports of a sibling delivery unit
  for (const spec of specs) {
    if (!spec.startsWith(scopePrefix)) continue;
    const rest = spec.slice(scopePrefix.length); // '<suffix>/<sub...>'
    const slash = rest.indexOf('/');
    if (slash === -1) continue;
    const suffix = rest.slice(0, slash);
    const sub = rest.slice(slash + 1);
    const provider = suffixToUnit.get(suffix);
    const surface = surfaceForSubpath(sub);
    if (provider && surface) {
      addObserved(
        consumer,
        provider,
        surface,
        'G1-pkg-subpath',
        `${rel}: ${spec}`,
      );
    }
  }

  // G2: MF runtime literal via createHydratedRemote(Ident, '<alias>/<Expose>')
  hydratedRe.lastIndex = 0;
  let h;
  while ((h = hydratedRe.exec(code))) {
    const [alias, expose] = h[1].split('/');
    const provider = aliasToUnit.get(alias);
    if (provider && expose) {
      addObserved(
        consumer,
        provider,
        expose,
        'G2-hydrated-remote',
        `${rel}: '${h[1]}'`,
      );
    }
  }

  // G3: bare loadRemote('<literal>') — measured to prove the grammar gap
  loadRemoteLiteralRe.lastIndex = 0;
  let l;
  while ((l = loadRemoteLiteralRe.exec(code))) {
    // only count string-literal args (the generator passes a variable)
    loadRemoteLiteralHits += 1;
    const [alias, expose] = l[1].split('/');
    const provider = aliasToUnit.get(alias);
    if (provider && expose) {
      addObserved(
        consumer,
        provider,
        expose,
        'G3-loadRemote-literal',
        `${rel}: '${l[1]}'`,
      );
    }
  }
}

// ---- DECLARED edges ----------------------------------------------------------
const declared = new Map();
function addDeclared(consumer, provider, surface, source) {
  const key = `${consumer}->${provider}#${surface}`;
  if (!declared.has(key))
    declared.set(key, { consumer, provider, surface, source });
}
for (const app of apps) {
  const mf = app.moduleFederation;
  if (mf?.role === 'host') {
    for (const ref of mf.verticalRefs ?? []) {
      // unit-level ref: declares provider available on its exposed surfaces
      const providerApp = apps.find(a => a.id === ref);
      for (const exp of providerApp?.moduleFederation?.exposes ?? [
        './Route',
        './Widget',
      ]) {
        addDeclared(
          app.id,
          ref,
          exp.replace(/^\.\//, ''),
          'verticalRefs+exposes',
        );
      }
    }
  }
  const api = app.api;
  if (api?.consumedBy) {
    for (const consumer of api.consumedBy) {
      addDeclared(consumer, app.id, 'api', 'api.consumedBy');
    }
  }
}

// ---- DIFF --------------------------------------------------------------------
const obsKeys = new Set(observed.keys());
const decKeys = new Set(declared.keys());
const matched = [...obsKeys].filter(k => decKeys.has(k)).sort();
const declaredNotObserved = [...decKeys].filter(k => !obsKeys.has(k)).sort();
const observedNotDeclared = [...obsKeys].filter(k => !decKeys.has(k)).sort();

const report = {
  workspace: wsRoot,
  scope,
  units: [...unitIds].sort(),
  counts: {
    observed: observed.size,
    declared: declared.size,
    matched: matched.length,
    declaredNotObserved: declaredNotObserved.length,
    observedNotDeclared: observedNotDeclared.length,
    loadRemoteLiteralHits,
  },
  observed: [...observed.values()].sort((a, b) =>
    `${a.consumer}${a.provider}${a.surface}`.localeCompare(
      `${b.consumer}${b.provider}${b.surface}`,
    ),
  ),
  declared: [...declared.values()],
  diff: { matched, declaredNotObserved, observedNotDeclared },
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`workspace: ${wsRoot}`);
  console.log(`scope: @${scope}  units: ${report.units.join(', ')}`);
  console.log(
    `\ncounts: observed=${report.counts.observed} declared=${report.counts.declared} ` +
      `matched=${matched.length} declared-not-observed=${declaredNotObserved.length} ` +
      `observed-not-declared=${observedNotDeclared.length} ` +
      `loadRemoteLiteralHits=${loadRemoteLiteralHits}`,
  );
  console.log('\nOBSERVED edges (consumer -> provider#surface  [grammar]):');
  for (const e of report.observed) {
    console.log(
      `  ${e.consumer} -> ${e.provider}#${e.surface}  [${e.grammar}]  (${e.evidence.length} site)`,
    );
  }
  console.log('\nMATCHED:');
  for (const k of matched) console.log(`  = ${k}`);
  console.log('\nDECLARED but NOT OBSERVED:');
  for (const k of declaredNotObserved)
    console.log(`  - ${k}  (${declared.get(k).source})`);
  console.log('\nOBSERVED but NOT DECLARED:');
  for (const k of observedNotDeclared) console.log(`  + ${k}`);
}
