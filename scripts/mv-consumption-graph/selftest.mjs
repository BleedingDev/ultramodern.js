#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
// selftest.mjs — assertions over fixtures/mini-ws covering the four checks.
// Run standalone (`node selftest.mjs`) or via `node run-all.mjs --selftest`.
// Uses node:test so failures are precise; returns a {passed,failed} summary.
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { detectUnitCycles } from './cycles.mjs';
import { extractObservedGraph } from './extract.mjs';
import { checkIsolation } from './isolation.mjs';
import { buildDualReport } from './report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures/mini-ws');

const hasEdge = (edges, consumer, provider, surface) =>
  edges.some(
    e =>
      e.consumer === consumer &&
      e.provider === provider &&
      e.surface === surface,
  );

test('extract: known G1 + G2 edges detected', () => {
  const g = extractObservedGraph(FIX);
  assert.ok(hasEdge(g.edges, 'shell', 'alpha', 'api'), 'G1 shell->alpha#api');
  assert.ok(
    hasEdge(g.edges, 'shell', 'alpha', 'Widget'),
    'G2 shell->alpha#Widget',
  );
  assert.ok(
    hasEdge(g.edges, 'shell', 'beta', 'Widget'),
    'G2 bare-literal shell->beta#Widget',
  );
  const g1 = g.edges.find(
    e =>
      e.consumer === 'shell' && e.provider === 'alpha' && e.surface === 'api',
  );
  assert.match(g1.grammar, /G1/);
});

test('extract: dynamic-consumption warning for loadRemote(non-literal)', () => {
  const g = extractObservedGraph(FIX);
  const w = g.warnings.filter(w => w.kind === 'dynamic-consumption');
  assert.ok(w.length >= 1, 'at least one dynamic-consumption warning');
  assert.equal(w[0].consumer, 'shell');
});

test('extract: dynamic-consumption warning for consumeSurface(non-literal ref)', () => {
  const g = extractObservedGraph(FIX);
  const consumeWarn = g.warnings.filter(
    w => w.kind === 'dynamic-consumption' && /consumeSurface/.test(w.reason),
  );
  assert.ok(
    consumeWarn.length >= 1,
    'consumeSurface with a non-literal ref surfaces a warning, not silence',
  );
  assert.equal(consumeWarn[0].consumer, 'shell');
  // The literal consumeSurface (AlphaCart) must NOT be flagged as dynamic.
  assert.ok(
    g.edges.some(e => /G4-consume-surface/.test(e.grammar)),
    'literal consumeSurface still produces an edge',
  );
});

test('cycles: synthetic alpha<->beta cycle detected', () => {
  const g = extractObservedGraph(FIX);
  const cycles = detectUnitCycles(g.edges);
  assert.ok(cycles.length >= 1, 'a cycle exists');
  const units = new Set(cycles.flatMap(c => c.units));
  assert.ok(
    units.has('alpha') && units.has('beta'),
    'cycle spans alpha and beta',
  );
});

test('isolation: cross-unit relative source import flagged (canonical ids)', () => {
  const r = checkIsolation(FIX);
  assert.ok(r.violationCount >= 1, 'at least one violation');
  const v = r.violations.find(
    v => v.deliveryUnitId === 'fx/alpha' && v.foreignUnitId === 'fx/beta',
  );
  assert.ok(v, 'alpha->beta source leak keyed by canonical deliveryUnitId');
  assert.match(v.from, /leak\.ts$/);
});

test('isolation: cross-unit package-form deep import flagged', () => {
  const r = checkIsolation(FIX);
  const v = r.violations.find(
    v =>
      v.deliveryUnitId === 'fx/alpha' &&
      v.foreignUnitId === 'fx/beta' &&
      /pkgleak\.ts$/.test(v.from),
  );
  assert.ok(v, 'package-form deep import into beta internals is a violation');
  assert.equal(v.specifier, '@fx/beta/src/internal');
});

test('isolation: published-surface package subpath is NOT flagged', () => {
  const r = checkIsolation(FIX);
  // beta/src/page.tsx imports '@fx/alpha/Widget' — a published surface.
  const bad = r.violations.find(v => v.specifier === '@fx/alpha/Widget');
  assert.equal(bad, undefined, 'published Widget subpath must be allowed');
});

test('extract: G4-consume-surface + loadRemote literal edges', () => {
  const g = extractObservedGraph(FIX);
  const g4 = g.edges.find(e => /G4-consume-surface/.test(e.grammar));
  assert.ok(g4, 'a G4-consume-surface edge is detected');
  assert.ok(
    g.counts.loadRemoteLiteralHits >= 1,
    'loadRemote literal hits counted',
  );
});

test('report: undeclared cross-unit consumption surfaces as observed-not-declared', () => {
  const rep = buildDualReport(FIX);
  const keys = rep.observedNotDeclared.map(o => o.key);
  assert.ok(
    keys.includes('alpha->beta#Widget'),
    'alpha->beta#Widget is undeclared',
  );
  assert.ok(
    keys.includes('beta->alpha#Widget'),
    'beta->alpha#Widget is undeclared',
  );
});
