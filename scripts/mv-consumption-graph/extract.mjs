#!/usr/bin/env node
import fs from 'node:fs';
// extract.mjs (MV-G10) — productionized observed-edge extractor.
//
// Walks a generated MicroVertical workspace, attributes each source file to its
// owning delivery unit via topology/ownership.json, extracts observed
// consumption edges under grammars G1 (package-subpath) + G2 (MF runtime
// literal), and emits machine JSON. Dynamic loadRemote(<non-literal>) sites are
// collected as a 'dynamic-consumption' warning list (G12a policy input, not an
// error) per the spike's documented limitation.
//
// Usage:
//   node extract.mjs <workspaceDir> [--json]
// Exit: 0 on success, 2 if <workspaceDir> is not an ultramodern workspace.
import path from 'node:path';
import { extractFromFile } from './lib/grammars.mjs';
import { walkSourceFiles } from './lib/graph.mjs';
import {
  attributeUnit,
  isUltramodernWorkspace,
  loadWorkspace,
} from './lib/workspace.mjs';

export function extractObservedGraph(wsRoot) {
  const ws = loadWorkspace(wsRoot);

  const observed = new Map(); // key -> {consumer,provider,surface,grammars:Set,evidence[]}
  const warnings = [];
  let loadRemoteLiteralHits = 0;

  const emit = (consumer, provider, surface, grammar, evidence) => {
    if (!consumer || !provider || !surface) return;
    if (consumer === provider) return; // self-consumption is not a cross-unit edge
    const key = `${consumer}->${provider}#${surface}`;
    if (!observed.has(key)) {
      observed.set(key, {
        consumer,
        provider,
        surface,
        grammars: new Set(),
        evidence: [],
      });
    }
    const e = observed.get(key);
    e.grammars.add(grammar);
    e.evidence.push({ grammar, at: evidence });
  };
  const warn = w => warnings.push({ kind: 'dynamic-consumption', ...w });

  for (const abs of walkSourceFiles(wsRoot)) {
    const rel = path.relative(wsRoot, abs).split(path.sep).join('/');
    const consumer = attributeUnit(ws, rel);
    if (!consumer) continue;
    const code = fs.readFileSync(abs, 'utf-8');
    const r = extractFromFile({ ws, consumer, rel, code, emit, warn });
    loadRemoteLiteralHits += r.loadRemoteLiteralHits;
  }

  const edges = [...observed.values()]
    .map(e => ({
      consumer: e.consumer,
      provider: e.provider,
      surface: e.surface,
      grammar: [...e.grammars].sort().join('+'),
      evidence: e.evidence,
    }))
    .sort((a, b) =>
      `${a.consumer}${a.provider}${a.surface}`.localeCompare(
        `${b.consumer}${b.provider}${b.surface}`,
      ),
    );

  return {
    workspace: wsRoot,
    scope: ws.scope,
    units: [...ws.unitIds].sort(),
    edges,
    warnings,
    counts: {
      edges: edges.length,
      warnings: warnings.length,
      loadRemoteLiteralHits,
    },
  };
}

function main() {
  const argv = process.argv.slice(2);
  const wsRoot = path.resolve(argv.find(a => !a.startsWith('--')) ?? '');
  if (!isUltramodernWorkspace(wsRoot)) {
    console.error(`Not an ultramodern workspace: ${wsRoot}`);
    process.exit(2);
  }
  const result = extractObservedGraph(wsRoot);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`workspace: ${wsRoot}`);
    console.log(`scope: @${result.scope}  units: ${result.units.join(', ')}`);
    console.log(
      `\ncounts: edges=${result.counts.edges} warnings=${result.counts.warnings} ` +
        `loadRemoteLiteralHits=${result.counts.loadRemoteLiteralHits}`,
    );
    console.log('\nOBSERVED edges (consumer -> provider#surface  [grammar]):');
    for (const e of result.edges) {
      console.log(
        `  ${e.consumer} -> ${e.provider}#${e.surface}  [${e.grammar}]  (${e.evidence.length} site)`,
      );
    }
    if (result.warnings.length) {
      console.log('\nDYNAMIC-CONSUMPTION warnings (G12a policy input):');
      for (const w of result.warnings) {
        console.log(`  ! ${w.consumer} @ ${w.site}: loadRemote(${w.argument})`);
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
