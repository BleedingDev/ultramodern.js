#!/usr/bin/env node
// cycles.mjs (MV-G12a) — unit-level cycle detection over OBSERVED edges.
//
// A cross-vertical import cycle is an invalid MicroVertical state (CONTEXT.md
// "Vertical Dependency"): cycles are detected from the real consumption graph,
// never from declarations. Builds a unit->unit graph from observed edges and
// runs the reused findCycles DFS (lib/graph.mjs, lifted from audit.mjs).
//
// Report-only by default; --enforce exits nonzero with actionable cycle paths.
//
// Usage:
//   node cycles.mjs <workspaceDir> [--json] [--enforce]
import path from 'node:path';
import { extractObservedGraph } from './extract.mjs';
import { findCycles } from './lib/graph.mjs';
import { isUltramodernWorkspace } from './lib/workspace.mjs';

// Accepts either a workspace dir (extract first) or a pre-extracted graph.
export function detectUnitCycles(edgesOrGraph) {
  const edges = Array.isArray(edgesOrGraph) ? edgesOrGraph : edgesOrGraph.edges;
  const graph = new Map();
  // Collect providers per consumer with the surfaces that carry each edge.
  const edgeLabels = new Map(); // 'a->b' -> Set(surface)
  for (const e of edges) {
    if (!graph.has(e.consumer)) graph.set(e.consumer, new Set());
    graph.get(e.consumer).add(e.provider);
    if (!graph.has(e.provider)) graph.set(e.provider, new Set());
    const lk = `${e.consumer}->${e.provider}`;
    if (!edgeLabels.has(lk)) edgeLabels.set(lk, new Set());
    edgeLabels.get(lk).add(e.surface);
  }
  const cycles = findCycles(graph).map(cycle => {
    // Render as an actionable path a->b->...->a with the surfaces on each hop.
    const closed = [...cycle, cycle[0]];
    const hops = [];
    for (let i = 0; i < closed.length - 1; i++) {
      const surfaces = [
        ...(edgeLabels.get(`${closed[i]}->${closed[i + 1]}`) ?? []),
      ].sort();
      hops.push({ from: closed[i], to: closed[i + 1], surfaces });
    }
    return { units: cycle, path: closed.join(' -> '), hops };
  });
  return cycles;
}

function main() {
  const argv = process.argv.slice(2);
  const enforce = argv.includes('--enforce');
  const wsRoot = path.resolve(argv.find(a => !a.startsWith('--')) ?? '');
  if (!isUltramodernWorkspace(wsRoot)) {
    console.error(`Not an ultramodern workspace: ${wsRoot}`);
    process.exit(2);
  }
  const observed = extractObservedGraph(wsRoot);
  const cycles = detectUnitCycles(observed.edges);
  const result = {
    workspace: wsRoot,
    unitCount: observed.units.length,
    cycleCount: cycles.length,
    cycles,
  };
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`unit-level cycle check: ${wsRoot}`);
    console.log(
      `units=${observed.units.length} observed-edges=${observed.edges.length} cycles=${cycles.length}`,
    );
    for (const c of cycles) {
      console.log(`\n  CYCLE: ${c.path}`);
      for (const h of c.hops)
        console.log(`    ${h.from} -> ${h.to}  via #${h.surfaces.join(', #')}`);
      console.log(
        '    fix: merge a wrongly-split vertical or extract a Horizontal Remote (CONTEXT.md).',
      );
    }
    if (cycles.length === 0) console.log('  no cross-unit cycles.');
  }
  process.exit(enforce && cycles.length > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
