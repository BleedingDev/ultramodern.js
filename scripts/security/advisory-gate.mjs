#!/usr/bin/env node
// Consumers: check-dependencies.yml (the monorepo lockfile on every PR) and the
// ERP-10 acceptance profile (the lockfile generated from the release cohort).
//
// One general gate: `pnpm audit --prod` must report no high or critical
// advisory. It replaces per-package range floors in sidecars; a vulnerable
// version anywhere in the production closure fails here with the advisory and
// the fix, whichever package pulled it in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import processKit from '../lib/process-kit.js';

const { runCommand } = processKit;

const auditArgs = Object.freeze([
  'audit',
  '--prod',
  '--audit-level=high',
  '--json',
]);
const gatedSeverities = new Set(['high', 'critical']);
const defaultExceptionsPath = fileURLToPath(
  new URL('./advisory-exceptions.json', import.meta.url),
);
const ghsaPattern = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

function readAdvisoryExceptions(exceptionsPath = defaultExceptionsPath) {
  const entries = JSON.parse(fs.readFileSync(exceptionsPath, 'utf8'));
  if (!Array.isArray(entries)) {
    throw new Error(`${exceptionsPath} must contain an array of exceptions`);
  }
  const byId = new Map();
  for (const entry of entries) {
    const keys = Object.keys(entry ?? {})
      .sort()
      .join(',');
    if (
      keys !== 'expires,id,package,reason' ||
      !ghsaPattern.test(entry.id) ||
      typeof entry.package !== 'string' ||
      typeof entry.reason !== 'string' ||
      entry.reason.trim().length === 0 ||
      !datePattern.test(entry.expires)
    ) {
      throw new Error(
        `${exceptionsPath}: every exception needs exactly { id: GHSA-…, package, reason, expires: YYYY-MM-DD }; found ${JSON.stringify(entry)}`,
      );
    }
    if (byId.has(entry.id)) {
      throw new Error(`${exceptionsPath}: duplicate exception ${entry.id}`);
    }
    byId.set(entry.id, entry);
  }
  return byId;
}

function parseAuditReport(result) {
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = undefined;
  }
  if (
    !report ||
    typeof report.advisories !== 'object' ||
    report.advisories === null
  ) {
    const detail = [result.stderr, result.stdout, result.error?.message]
      .filter(Boolean)
      .join('\n')
      .trim();
    throw new Error(
      `pnpm audit returned no advisory report (exit ${result.exitCode}); the gate cannot pass without one. Check registry reachability and rerun.\n${detail}`,
    );
  }
  return Object.values(report.advisories).filter(advisory =>
    gatedSeverities.has(advisory.severity),
  );
}

function formatAdvisory(advisory) {
  const versions = [
    ...new Set((advisory.findings ?? []).map(finding => finding.version)),
  ].join(', ');
  const via = advisory.findings?.[0]?.paths?.[0];
  return [
    `${advisory.severity} ${advisory.github_advisory_id} ${advisory.module_name}@${versions}: ${advisory.title}`,
    `  vulnerable ${advisory.vulnerable_versions}, patched ${advisory.patched_versions}; ${advisory.url}`,
    ...(via ? [`  via ${via}`] : []),
    `  fix: pnpm update --recursive ${advisory.module_name}; if a parent pins it, upgrade the parent on the path above`,
  ].join('\n');
}

/**
 * Fails when the production closure of the lockfile in `cwd` has a high or
 * critical advisory that no unexpired exception acknowledges. Returns the
 * acknowledged advisories so receipts can record them.
 */
function assertNoHighAdvisories({
  cwd,
  env,
  exceptionsPath = defaultExceptionsPath,
  now = new Date(),
  runCommandImpl = runCommand,
}) {
  const exceptions = readAdvisoryExceptions(exceptionsPath);
  const today = now.toISOString().slice(0, 10);
  const expired = [...exceptions.values()].filter(
    entry => entry.expires < today,
  );
  if (expired.length > 0) {
    throw new Error(
      `Advisory exceptions expired in ${path.relative(process.cwd(), exceptionsPath)}; fix the dependency and delete the entry, or renew it with a new reason:\n${expired
        .map(
          entry => `  ${entry.id} ${entry.package} (expired ${entry.expires})`,
        )
        .join('\n')}`,
    );
  }

  const advisories = parseAuditReport(
    runCommandImpl('pnpm', [...auditArgs], { cwd, env, stdio: 'pipe' }),
  );
  const acknowledged = advisories.filter(advisory =>
    exceptions.has(advisory.github_advisory_id),
  );
  const blocking = advisories.filter(
    advisory => !exceptions.has(advisory.github_advisory_id),
  );
  if (blocking.length > 0) {
    throw new Error(
      `pnpm audit --prod found ${blocking.length} high or critical advisor${blocking.length === 1 ? 'y' : 'ies'}:\n${blocking
        .map(formatAdvisory)
        .join('\n')}`,
    );
  }
  return {
    auditLevel: 'high',
    acknowledged: acknowledged.map(advisory => advisory.github_advisory_id),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cwd = path.resolve(process.argv[2] ?? '.');
  try {
    const { acknowledged } = assertNoHighAdvisories({ cwd });
    console.log(
      `No unacknowledged high or critical advisories in ${cwd}${
        acknowledged.length > 0
          ? ` (acknowledged: ${acknowledged.join(', ')})`
          : ''
      }`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export { assertNoHighAdvisories, readAdvisoryExceptions };
