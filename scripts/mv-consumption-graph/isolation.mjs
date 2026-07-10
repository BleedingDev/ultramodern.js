#!/usr/bin/env node
// isolation.mjs (MV-G4/G6) — source-import isolation analyzer.
//
// CONTEXT.md "Isolation Boundary": a MicroVertical depends on another only
// through its PUBLISHED surfaces (a Composition Surface or published API
// package subpath) — never through source imports, internal modules, or another
// vertical's data. This maps every source file to its owning delivery unit (via
// topology/ownership.json) and flags cross-unit RELATIVE/source imports that
// escape the owning unit into another unit's source tree. Published-surface
// package-subpath imports ('@scope/<unit>/<sub>') are legitimate and NOT flagged.
//
// Violations are keyed by deliveryUnitId (not owner). Report-only by default;
// --enforce exits nonzero.
//
// Usage:
//   node isolation.mjs <workspaceDir> [--json] [--enforce]
import fs from 'node:fs';
import path from 'node:path';
import { resolveRelative, walkSourceFiles } from './lib/graph.mjs';
import {
  attributeUnit,
  canonicalUnitId,
  isUltramodernWorkspace,
  loadWorkspace,
  publishedSubpaths,
} from './lib/workspace.mjs';

const REL_IMPORT_RE =
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.[^'"]+)['"]/g;
const REL_SIDE_EFFECT_RE = /\bimport\s*['"](\.[^'"]+)['"]/g;
const REL_REQUIRE_RE = /\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const REL_DYNAMIC_RE = /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

// Any specifier (relative OR package-form) — we discriminate below.
const ANY_IMPORT_RE =
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g;
const ANY_SIDE_EFFECT_RE = /\bimport\s*['"]([^'"]+)['"]/g;
const ANY_REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const ANY_DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function relSpecifiers(code) {
  const specs = [];
  for (const re of [
    REL_IMPORT_RE,
    REL_SIDE_EFFECT_RE,
    REL_REQUIRE_RE,
    REL_DYNAMIC_RE,
  ]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) specs.push(m[1]);
  }
  return specs;
}

function allSpecifiers(code) {
  const specs = [];
  for (const re of [
    ANY_IMPORT_RE,
    ANY_SIDE_EFFECT_RE,
    ANY_REQUIRE_RE,
    ANY_DYNAMIC_RE,
  ]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) specs.push(m[1]);
  }
  return specs;
}

export function checkIsolation(wsRoot) {
  const ws = loadWorkspace(wsRoot);
  const scopePrefix = `@${ws.scope}/`;
  const violations = [];
  for (const abs of walkSourceFiles(wsRoot)) {
    const rel = path.relative(wsRoot, abs).split(path.sep).join('/');
    const owner = attributeUnit(ws, rel);
    if (!owner) continue;
    const code = fs.readFileSync(abs, 'utf-8');

    // (a) cross-unit RELATIVE/source imports into another unit's source tree.
    for (const spec of relSpecifiers(code)) {
      const targetAbs = resolveRelative(abs, spec);
      if (!targetAbs) continue; // unresolved (e.g. asset) — skip
      const targetRel = path
        .relative(wsRoot, targetAbs)
        .split(path.sep)
        .join('/');
      const targetOwner = attributeUnit(ws, targetRel);
      if (targetOwner && targetOwner !== owner) {
        violations.push({
          deliveryUnitId: canonicalUnitId(ws, owner),
          foreignUnitId: canonicalUnitId(ws, targetOwner),
          from: rel,
          to: targetRel,
          specifier: spec,
          rule: 'cross-unit relative/source import bypasses the published surface boundary',
        });
      }
    }

    // (b) cross-unit PACKAGE-FORM deep imports ('@scope/<suffix>/<sub>') into a
    // subpath that is NOT a published surface (exposes / api-client). A bare
    // package import ('@scope/<suffix>') and published-surface subpaths are
    // legitimate; any other subpath reaches into a provider's internals.
    for (const spec of allSpecifiers(code)) {
      if (!spec.startsWith(scopePrefix)) continue;
      const rest = spec.slice(scopePrefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) continue; // bare package entry — allowed
      const suffix = rest.slice(0, slash);
      const sub = rest.slice(slash + 1);
      const provider = ws.suffixToUnit.get(suffix);
      if (!provider || provider === owner) continue; // unknown or self
      if (publishedSubpaths(ws, provider).has(sub)) continue; // published surface
      violations.push({
        deliveryUnitId: canonicalUnitId(ws, owner),
        foreignUnitId: canonicalUnitId(ws, provider),
        from: rel,
        to: spec,
        specifier: spec,
        rule: 'cross-unit package-form deep import into a non-published subpath bypasses the published surface boundary',
      });
    }
  }
  violations.sort((a, b) =>
    `${a.deliveryUnitId}${a.from}`.localeCompare(
      `${b.deliveryUnitId}${b.from}`,
    ),
  );
  // Group by deliveryUnitId.
  const byUnit = {};
  for (const v of violations) (byUnit[v.deliveryUnitId] ??= []).push(v);
  return {
    workspace: wsRoot,
    violationCount: violations.length,
    byDeliveryUnit: byUnit,
    violations,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const enforce = argv.includes('--enforce');
  const wsRoot = path.resolve(argv.find(a => !a.startsWith('--')) ?? '');
  if (!isUltramodernWorkspace(wsRoot)) {
    console.error(`Not an ultramodern workspace: ${wsRoot}`);
    process.exit(2);
  }
  const result = checkIsolation(wsRoot);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`isolation-boundary check: ${wsRoot}`);
    console.log(
      `cross-unit source-import violations: ${result.violationCount}`,
    );
    for (const [unit, vs] of Object.entries(result.byDeliveryUnit)) {
      console.log(`\n  deliveryUnitId=${unit} (${vs.length}):`);
      for (const v of vs)
        console.log(
          `    ${v.from}  ->  ${v.specifier}  (into ${v.foreignUnitId}: ${v.to})`,
        );
    }
    if (result.violationCount === 0)
      console.log('  clean: no cross-unit source imports.');
  }
  process.exit(enforce && result.violationCount > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
