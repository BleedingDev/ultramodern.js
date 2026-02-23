#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  constants,
  accessSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const repoRoot = resolve(process.cwd());

function parseArgs(argv) {
  const options = {
    strict: false,
    timeoutMs: 20000,
    maxFiles: 0,
    forceInstallTsgo: false,
    configList: '',
    reportTag: 'full',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--force-install-tsgo') {
      options.forceInstallTsgo = true;
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[i + 1] || options.timeoutMs);
      i++;
      continue;
    }
    if (arg === '--max-files') {
      options.maxFiles = Number(argv[i + 1] || 0);
      i++;
      continue;
    }
    if (arg === '--config-list') {
      options.configList = argv[i + 1] || '';
      i++;
      continue;
    }
    if (arg === '--report-tag') {
      options.reportTag = argv[i + 1] || options.reportTag;
      i++;
      continue;
    }
  }
  return options;
}

function runCommand(bin, args, options = {}) {
  const started = performance.now();
  const result = spawnSync(bin, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  const durationMs = Number((performance.now() - started).toFixed(2));
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const merged = `${stdout}\n${stderr}`.trim();
  const firstDiag =
    merged.split('\n').find(line => line.includes('error TS')) ||
    merged.split('\n')[0] ||
    '';
  const codeMatch = firstDiag.match(/TS\d{4}/);
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  return {
    status: result.status ?? -1,
    signal: result.signal ?? null,
    timedOut,
    durationMs,
    code: codeMatch ? codeMatch[0] : null,
    firstDiag,
  };
}

function ensureTsgoBin(forceInstallTsgo) {
  const envTsgoBin = process.env.TSGO_BIN;
  if (envTsgoBin && canExecute(envTsgoBin)) {
    return envTsgoBin;
  }

  const tempTsgoBin = '/tmp/tsgo-bench/node_modules/.bin/tsgo';
  if (canExecute(tempTsgoBin)) {
    return tempTsgoBin;
  }

  const toolDir = join(repoRoot, '.codex-gate-logs', 'tsgo-tool');
  const packageJsonPath = join(toolDir, 'package.json');
  const tsgoBin = join(toolDir, 'node_modules', '.bin', 'tsgo');

  mkdirSync(toolDir, { recursive: true });
  try {
    readFileSync(packageJsonPath, 'utf8');
  } catch {
    writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          name: 'tsgo-tool',
          private: true,
          version: '0.0.0',
          description: 'Local tool package for tsgo compare runs',
        },
        null,
        2,
      ),
    );
  }

  const needsInstall = forceInstallTsgo || !canExecute(tsgoBin);
  if (needsInstall) {
    execFileSync('pnpm', ['add', '@typescript/native-preview'], {
      cwd: toolDir,
      stdio: 'inherit',
    });
  }

  if (!canExecute(tsgoBin)) {
    throw new Error(`tsgo binary not found at ${tsgoBin}`);
  }

  return tsgoBin;
}

function canExecute(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readConfigList(configListPath) {
  const raw = readFileSync(configListPath, 'utf8');
  const listed = raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  const unique = [...new Set(listed)];
  for (const file of unique) {
    const abs = join(repoRoot, file);
    try {
      accessSync(abs, constants.R_OK);
    } catch {
      throw new Error(
        `Config list entry does not exist or is unreadable: ${file}`,
      );
    }
  }
  return unique.sort();
}

function discoverTsconfigs(maxFiles, configListPath) {
  const files = configListPath
    ? readConfigList(configListPath)
    : execFileSync('rg', ['--files', '-g', '**/tsconfig.json'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
        .split('\n')
        .map(v => v.trim())
        .filter(Boolean)
        .sort();

  if (maxFiles > 0) {
    return files.slice(0, maxFiles);
  }
  return files;
}

function summaryFromRows(rows) {
  let bothPass = 0;
  let ts6PassTs7Fail = 0;
  let ts6FailTs7Pass = 0;
  let bothFail = 0;
  for (const row of rows) {
    if (row.ts6.status === 0 && row.ts7.status === 0) {
      bothPass++;
      continue;
    }
    if (row.ts6.status === 0 && row.ts7.status !== 0) {
      ts6PassTs7Fail++;
      continue;
    }
    if (row.ts6.status !== 0 && row.ts7.status === 0) {
      ts6FailTs7Pass++;
      continue;
    }
    bothFail++;
  }

  const ts7FailCodes = {};
  const ts6FailCodes = {};
  for (const row of rows) {
    if (row.ts7.status !== 0) {
      const key = row.ts7.timedOut ? 'TIMEOUT' : row.ts7.code || 'UNKNOWN';
      ts7FailCodes[key] = (ts7FailCodes[key] || 0) + 1;
    }
    if (row.ts6.status !== 0) {
      const key = row.ts6.timedOut ? 'TIMEOUT' : row.ts6.code || 'UNKNOWN';
      ts6FailCodes[key] = (ts6FailCodes[key] || 0) + 1;
    }
  }

  return {
    total: rows.length,
    bothPass,
    ts6PassTs7Fail,
    ts6FailTs7Pass,
    bothFail,
    ts7FailCodes,
    ts6FailCodes,
  };
}

function latestReportPath(reportDir) {
  const files = readdirSync(reportDir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.json'))
    .map(e => join(reportDir, e.name))
    .sort();
  if (!files.length) {
    return null;
  }
  return files[files.length - 1];
}

function formatPercent(part, total) {
  if (!total) return '0.00%';
  return `${((part / total) * 100).toFixed(2)}%`;
}

function writeMarkdownReport(
  reportPathBase,
  summary,
  rows,
  previousSummary,
  options,
) {
  const markdownPath = `${reportPathBase}.md`;
  const lines = [];
  lines.push('# TypeScript Compiler Compare');
  lines.push('');
  lines.push(`- Mode: ${options.reportTag}`);
  if (options.configList) {
    lines.push(`- Config list: ${options.configList}`);
  }
  lines.push(`- Timeout per compiler run: ${options.timeoutMs}ms`);
  lines.push('');
  lines.push(`- Total configs: ${summary.total}`);
  lines.push(
    `- Both pass: ${summary.bothPass} (${formatPercent(summary.bothPass, summary.total)})`,
  );
  lines.push(
    `- TS6 pass / TS7 fail: ${summary.ts6PassTs7Fail} (${formatPercent(summary.ts6PassTs7Fail, summary.total)})`,
  );
  lines.push(
    `- TS6 fail / TS7 pass: ${summary.ts6FailTs7Pass} (${formatPercent(summary.ts6FailTs7Pass, summary.total)})`,
  );
  lines.push(
    `- Both fail: ${summary.bothFail} (${formatPercent(summary.bothFail, summary.total)})`,
  );
  lines.push('');

  if (previousSummary) {
    lines.push('## Delta vs previous run');
    lines.push('');
    lines.push(
      `- TS6 pass / TS7 fail: ${summary.ts6PassTs7Fail - previousSummary.ts6PassTs7Fail}`,
    );
    lines.push(
      `- TS6 fail / TS7 pass: ${summary.ts6FailTs7Pass - previousSummary.ts6FailTs7Pass}`,
    );
    lines.push(`- Both pass: ${summary.bothPass - previousSummary.bothPass}`);
    lines.push('');
  }

  lines.push('## Top TS7 failure codes');
  lines.push('');
  const ts7Codes = Object.entries(summary.ts7FailCodes).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [code, count] of ts7Codes.slice(0, 10)) {
    lines.push(`- ${code}: ${count}`);
  }
  lines.push('');

  lines.push('## Sample TS6 pass / TS7 fail');
  lines.push('');
  const sampleRegression = rows
    .filter(r => r.ts6.status === 0 && r.ts7.status !== 0)
    .slice(0, 15);
  for (const row of sampleRegression) {
    lines.push(
      `- ${row.file}: ${row.ts7.code || 'UNKNOWN'} ${row.ts7.firstDiag}`,
    );
  }
  if (!sampleRegression.length) {
    lines.push('- none');
  }
  lines.push('');

  lines.push('## Sample TS6 fail / TS7 pass');
  lines.push('');
  const sampleOpposite = rows
    .filter(r => r.ts6.status !== 0 && r.ts7.status === 0)
    .slice(0, 15);
  for (const row of sampleOpposite) {
    lines.push(
      `- ${row.file}: ${row.ts6.code || 'UNKNOWN'} ${row.ts6.firstDiag}`,
    );
  }
  if (!sampleOpposite.length) {
    lines.push('- none');
  }
  lines.push('');

  writeFileSync(markdownPath, `${lines.join('\n')}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const ts7Bin = ensureTsgoBin(options.forceInstallTsgo);
  const ts6Bin = join(repoRoot, 'node_modules', '.bin', 'tsc');

  const files = discoverTsconfigs(options.maxFiles, options.configList);
  const rows = [];

  console.log(`Comparing TS6 vs TS7 on ${files.length} tsconfig files...`);
  for (const file of files) {
    const args = ['-p', file, '--noEmit', '--pretty', 'false'];
    const ts6 = runCommand(ts6Bin, args, { timeoutMs: options.timeoutMs });
    const ts7 = runCommand(ts7Bin, args, { timeoutMs: options.timeoutMs });
    rows.push({ file, ts6, ts7 });
  }

  const summary = summaryFromRows(rows);
  const reportDir = join(
    repoRoot,
    '.codex-gate-logs',
    'ts-compare',
    options.reportTag,
  );
  mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPathBase = join(reportDir, `ts-compare-${ts}`);
  const jsonPath = `${reportPathBase}.json`;

  const previousJsonPath = latestReportPath(reportDir);
  let previousSummary = null;
  if (previousJsonPath) {
    try {
      previousSummary = JSON.parse(
        readFileSync(previousJsonPath, 'utf8'),
      ).summary;
    } catch {
      previousSummary = null;
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    compilers: {
      ts6: ts6Bin,
      ts7: ts7Bin,
    },
    options,
    summary,
    rows,
  };
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeMarkdownReport(reportPathBase, summary, rows, previousSummary, options);

  console.log(`Report JSON: ${jsonPath}`);
  console.log(`Report Markdown: ${reportPathBase}.md`);
  console.log(
    `Summary: bothPass=${summary.bothPass}, ts6PassTs7Fail=${summary.ts6PassTs7Fail}, ts6FailTs7Pass=${summary.ts6FailTs7Pass}, bothFail=${summary.bothFail}`,
  );

  if (
    options.strict &&
    (summary.ts6PassTs7Fail > 0 || summary.ts6FailTs7Pass > 0)
  ) {
    process.exitCode = 1;
  }
}

main();
