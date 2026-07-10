#!/usr/bin/env node
// report.mjs (MV-G11a) — declared-vs-observed dual report.
//
// Compares the OBSERVED consumption graph (extract.mjs) against the DECLARED
// topology (contract verticalRefs+exposes / api.consumedBy), classifying every
// edge as matched / declared-not-observed / observed-not-declared with source
// attribution. Report-only: exits 0 always UNLESS --enforce is passed, in which
// case any observed-not-declared edge (undeclared real consumption) exits 1.
//
// Usage:
//   node report.mjs <workspaceDir> [--json] [--enforce]
import path from 'node:path';
import { extractObservedGraph } from './extract.mjs';
import {
  declaredEdges,
  isUltramodernWorkspace,
  loadWorkspace,
} from './lib/workspace.mjs';

export function buildDualReport(wsRoot) {
  const observed = extractObservedGraph(wsRoot);
  const ws = loadWorkspace(wsRoot);
  const declared = declaredEdges(ws);

  const obsByKey = new Map(
    observed.edges.map(e => [`${e.consumer}->${e.provider}#${e.surface}`, e]),
  );
  const obsKeys = new Set(obsByKey.keys());
  const decKeys = new Set(declared.keys());

  const matched = [...obsKeys].filter(k => decKeys.has(k)).sort();
  const declaredNotObserved = [...decKeys].filter(k => !obsKeys.has(k)).sort();
  const observedNotDeclared = [...obsKeys].filter(k => !decKeys.has(k)).sort();

  return {
    workspace: wsRoot,
    scope: observed.scope,
    warnings: observed.warnings,
    counts: {
      observed: obsKeys.size,
      declared: decKeys.size,
      matched: matched.length,
      declaredNotObserved: declaredNotObserved.length,
      observedNotDeclared: observedNotDeclared.length,
    },
    matched: matched.map(k => ({
      key: k,
      source: declared.get(k).source,
      grammar: obsByKey.get(k).grammar,
    })),
    declaredNotObserved: declaredNotObserved.map(k => ({
      key: k,
      source: declared.get(k).source,
    })),
    observedNotDeclared: observedNotDeclared.map(k => ({
      key: k,
      grammar: obsByKey.get(k).grammar,
      evidence: obsByKey.get(k).evidence,
    })),
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
  const report = buildDualReport(wsRoot);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const c = report.counts;
    console.log(`declared-vs-observed report: ${wsRoot}`);
    console.log(
      `counts: observed=${c.observed} declared=${c.declared} matched=${c.matched} ` +
        `declared-not-observed=${c.declaredNotObserved} observed-not-declared=${c.observedNotDeclared}`,
    );
    console.log('\nMATCHED:');
    for (const m of report.matched)
      console.log(`  = ${m.key}  [${m.grammar}] (${m.source})`);
    console.log('\nDECLARED but NOT OBSERVED (over-declaration / noise):');
    for (const d of report.declaredNotObserved)
      console.log(`  - ${d.key}  (${d.source})`);
    console.log('\nOBSERVED but NOT DECLARED (undeclared real consumption):');
    for (const o of report.observedNotDeclared)
      console.log(`  + ${o.key}  [${o.grammar}]`);
  }
  const violated = enforce && report.counts.observedNotDeclared > 0;
  process.exit(violated ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
