// Reused graph primitives, lifted per the spike's reuse verdict (§6 of
// docs/research/research_observed_graph_spike_20260710.md) from
// scripts/skills/dependency-audit/scripts/audit.mjs:
//   - walkSourceFiles  (recursive source walker, skips build/vendor dirs)
//   - resolveRelative  (extension/index relative resolution)
//   - findCycles       (WHITE/GRAY/BLACK iterative DFS, dedups by sorted key)
// Only the mechanics are reused; the unit/surface consumption model is new.
import fs from 'node:fs';
import path from 'node:path';

export const SRC_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const SRC_EXT_SET = new Set(SRC_EXT);
export const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  'dist-ssg',
  'coverage',
  '.git',
  '.nx',
  '.output',
  '.turbo',
  'compiled',
]);

// Recursive source-file walker (audit.mjs walkSourceFiles, without the nested
// package.json boundary stop — an MV workspace is one tree of many units and we
// want every unit's source).
export function walkSourceFiles(dir, root = dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      walkSourceFiles(full, root, files);
    } else if (SRC_EXT_SET.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

// Relative specifier resolution (audit.mjs resolveRelative).
export function resolveRelative(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [];
  if (SRC_EXT_SET.has(path.extname(base))) candidates.push(base);
  for (const ext of SRC_EXT) candidates.push(base + ext);
  for (const ext of SRC_EXT) candidates.push(path.join(base, `index${ext}`));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

// Cycle detection (audit.mjs findCycles). `graph` is a Map<node, Iterable<node>>.
// Returns an array of cycles (each an array of nodes), deduped by sorted key.
export function findCycles(graph) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const state = new Map();
  const stack = [];
  const cycles = [];
  const seen = new Set();

  function dfs(node) {
    state.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      const nextState = state.get(next) || WHITE;
      if (nextState === WHITE) {
        dfs(next);
      } else if (nextState === GRAY) {
        const index = stack.indexOf(next);
        if (index !== -1) {
          const cycle = stack.slice(index);
          const key = [...cycle].sort().join('|');
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(cycle);
          }
        }
      }
    }
    stack.pop();
    state.set(node, BLACK);
  }

  for (const node of graph.keys()) {
    if ((state.get(node) || WHITE) === WHITE) dfs(node);
  }
  return cycles;
}
