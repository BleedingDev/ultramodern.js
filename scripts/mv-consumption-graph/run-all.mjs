#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
// run-all.mjs — one entry point for the MV consumption-graph slice (Phase 5
// local: MV-G10 extract, G11a report, G12a cycles, G4/G6 isolation).
//
// Default: generate a scratch MicroVertical workspace under $TMPDIR (via the
// repo's bundled tsx loading the generator source — the @modern-js/create build
// is broken by an unrelated workstream, so we bypass it exactly as the W5 spike
// did), run all four checks, and write a combined JSON + markdown report.
//
//   node run-all.mjs [--out <dir>] [--ws <existingWorkspace>] [--enforce] [--json]
//   node run-all.mjs --selftest       # run fixture assertions only
//
// Exit codes:
//   0  success (report-only, or --enforce with no findings)
//   1  --enforce and a cycle or isolation violation (or observed-not-declared) found
//   2  workspace generation / discovery failed
//   3  --selftest failures
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectUnitCycles } from './cycles.mjs';
import { extractObservedGraph } from './extract.mjs';
import { checkIsolation } from './isolation.mjs';
import { isUltramodernWorkspace } from './lib/workspace.mjs';
import { buildDualReport } from './report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

function findTsxCli() {
  const pnpmDir = path.join(repoRoot, 'node_modules/.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;
  const candidates = fs
    .readdirSync(pnpmDir)
    .filter(n => n.startsWith('tsx@'))
    .sort()
    .reverse()
    .map(n => path.join(pnpmDir, n, 'node_modules/tsx/dist/cli.mjs'))
    .filter(p => fs.existsSync(p));
  return candidates[0] ?? null;
}

function generateWorkspace(outDir) {
  const tsx = findTsxCli();
  if (!tsx)
    throw new Error(
      'bundled tsx loader not found under node_modules/.pnpm (needed to run the generator source)',
    );
  const genScript = path.join(here, 'generate-ws.mts');
  const res = spawnSync(process.execPath, [tsx, genScript, outDir], {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) {
    throw new Error(
      `workspace generation failed (exit ${res.status}):\n${res.stderr || res.stdout}`,
    );
  }
  return outDir;
}

function runSelftest() {
  const res = spawnSync(
    process.execPath,
    ['--test', path.join(here, 'selftest.mjs')],
    {
      cwd: here,
      encoding: 'utf-8',
    },
  );
  process.stdout.write(res.stdout || '');
  if (res.stderr) process.stderr.write(res.stderr);
  const pass = Number((res.stdout.match(/(?:#|ℹ) pass (\d+)/) || [])[1] || 0);
  const fail = Number((res.stdout.match(/(?:#|ℹ) fail (\d+)/) || [])[1] || 0);
  console.log(`\nselftest summary: pass=${pass} fail=${fail}`);
  return { pass, fail, exit: res.status ?? 1 };
}

function toMarkdown(c) {
  const lines = [];
  lines.push(`# MV consumption-graph report`);
  lines.push('');
  lines.push(`- workspace: \`${c.workspace}\``);
  lines.push(`- scope: \`@${c.scope}\`  ·  units: ${c.units.join(', ')}`);
  lines.push('');
  lines.push(`## Observed edges (G10) — ${c.extract.counts.edges}`);
  for (const e of c.extract.edges)
    lines.push(
      `- \`${e.consumer} -> ${e.provider}#${e.surface}\`  [${e.grammar}]`,
    );
  lines.push('');
  lines.push(
    `## Dynamic-consumption warnings (G12a policy input) — ${c.extract.counts.warnings}`,
  );
  for (const w of c.extract.warnings)
    lines.push(
      `- \`${w.consumer}\` @ \`${w.site}\`: loadRemote(${w.argument})`,
    );
  if (!c.extract.warnings.length) lines.push('- none');
  lines.push('');
  lines.push(`## Declared-vs-observed (G11a)`);
  const rc = c.report.counts;
  lines.push(
    `- matched: ${rc.matched} · declared-not-observed: ${rc.declaredNotObserved} · observed-not-declared: ${rc.observedNotDeclared}`,
  );
  for (const d of c.report.declaredNotObserved)
    lines.push(`  - declared-only: \`${d.key}\` (${d.source})`);
  for (const o of c.report.observedNotDeclared)
    lines.push(`  - observed-only: \`${o.key}\` [${o.grammar}]`);
  lines.push('');
  lines.push(`## Unit cycles (G12a) — ${c.cycles.cycleCount}`);
  for (const cy of c.cycles.cycles) lines.push(`- \`${cy.path}\``);
  if (!c.cycles.cycleCount) lines.push('- none');
  lines.push('');
  lines.push(
    `## Isolation-boundary violations (G4/G6) — ${c.isolation.violationCount}`,
  );
  for (const v of c.isolation.violations)
    lines.push(
      `- \`${v.deliveryUnitId}\`: \`${v.from}\` -> \`${v.specifier}\` (into ${v.foreignUnitId})`,
    );
  if (!c.isolation.violationCount) lines.push('- none');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = runSelftest();
    process.exit(r.fail > 0 ? 3 : 0);
  }

  const enforce = argv.includes('--enforce');
  const asJson = argv.includes('--json');
  const outArg = argv[argv.indexOf('--out') + 1];
  const wsArg = argv[argv.indexOf('--ws') + 1];
  const outDir =
    argv.includes('--out') && outArg
      ? path.resolve(outArg)
      : path.join(os.tmpdir(), 'mv-consumption-graph');
  fs.mkdirSync(outDir, { recursive: true });

  let wsRoot;
  try {
    wsRoot =
      argv.includes('--ws') && wsArg
        ? path.resolve(wsArg)
        : generateWorkspace(path.join(outDir, 'workspace'));
  } catch (err) {
    console.error(`generation failed: ${err.message}`);
    process.exit(2);
  }
  if (!isUltramodernWorkspace(wsRoot)) {
    console.error(`not an ultramodern workspace: ${wsRoot}`);
    process.exit(2);
  }

  const extract = extractObservedGraph(wsRoot);
  const report = buildDualReport(wsRoot);
  const cycles = {
    ...(() => {
      const cs = detectUnitCycles(extract.edges);
      return { cycleCount: cs.length, cycles: cs };
    })(),
  };
  const isolation = checkIsolation(wsRoot);

  const combined = {
    workspace: wsRoot,
    scope: extract.scope,
    units: extract.units,
    generatedAt: new Date().toISOString(),
    extract,
    report: {
      counts: report.counts,
      matched: report.matched,
      declaredNotObserved: report.declaredNotObserved,
      observedNotDeclared: report.observedNotDeclared,
    },
    cycles,
    isolation,
  };

  const jsonPath = path.join(outDir, 'consumption-graph.json');
  const mdPath = path.join(outDir, 'consumption-graph.md');
  fs.writeFileSync(jsonPath, JSON.stringify(combined, null, 2));
  fs.writeFileSync(mdPath, toMarkdown(combined));

  if (asJson) {
    console.log(JSON.stringify(combined, null, 2));
  } else {
    console.log(`workspace: ${wsRoot}`);
    console.log(`units: ${extract.units.join(', ')}`);
    console.log(
      `edges=${extract.counts.edges} warnings=${extract.counts.warnings} ` +
        `matched=${report.counts.matched} declared-not-observed=${report.counts.declaredNotObserved} ` +
        `observed-not-declared=${report.counts.observedNotDeclared} ` +
        `cycles=${cycles.cycleCount} isolation-violations=${isolation.violationCount}`,
    );
    console.log(`\nwrote: ${jsonPath}`);
    console.log(`wrote: ${mdPath}`);
  }

  const findings =
    cycles.cycleCount > 0 ||
    isolation.violationCount > 0 ||
    report.counts.observedNotDeclared > 0;
  process.exit(enforce && findings ? 1 : 0);
}

main();
