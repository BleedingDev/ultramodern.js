#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = process.cwd();
const DEFAULT_OUTPUT_DIR = '.modern/full-test-run';
const DEFAULT_RUN_PREFIX = 'parallel';

const parseArgs = argv => {
  const parsed = {
    mode: 'run',
    outputDir: DEFAULT_OUTPUT_DIR,
    runDir: undefined,
    maxLanes: 4,
    timeoutDefaultMs: 7 * 60 * 1000,
    timeoutHeavyMs: 15 * 60 * 1000,
    timeoutRunawayMs: 3 * 60 * 1000,
    quiet: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--mode':
        parsed.mode = argv[index + 1];
        index += 1;
        break;
      case '--output-dir':
        parsed.outputDir = argv[index + 1];
        index += 1;
        break;
      case '--run-dir':
        parsed.runDir = argv[index + 1];
        index += 1;
        break;
      case '--max-lanes':
        parsed.maxLanes = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case '--timeout-default-ms':
        parsed.timeoutDefaultMs = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case '--timeout-heavy-ms':
        parsed.timeoutHeavyMs = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case '--timeout-runaway-ms':
        parsed.timeoutRunawayMs = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['run', 'analyze'].includes(parsed.mode)) {
    throw new Error(
      `Invalid --mode value "${parsed.mode}". Use "run" or "analyze".`,
    );
  }

  if (!Number.isFinite(parsed.maxLanes) || parsed.maxLanes <= 0) {
    throw new Error(`Invalid --max-lanes value "${parsed.maxLanes}".`);
  }

  return parsed;
};

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const ensureDir = dirPath => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const rel = filePath => path.relative(REPO_ROOT, filePath);

const nowStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const collectPackageJsonFiles = () => {
  const roots = [
    path.join(REPO_ROOT, 'package.json'),
    path.join(REPO_ROOT, 'packages'),
    path.join(REPO_ROOT, 'tests'),
    path.join(REPO_ROOT, 'benchmark'),
  ];

  const files = new Set();
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    if (root.endsWith('package.json')) {
      files.add(root);
      continue;
    }

    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === '.modern' ||
          entry.name === 'dist' ||
          entry.name.startsWith('.')
        ) {
          continue;
        }

        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile() && entry.name === 'package.json') {
          files.add(fullPath);
        }
      }
    }
  }

  return [...files].sort((a, b) => a.localeCompare(b));
};

const EXCLUDED_SCRIPT_NAMES = new Set([
  'test:ut:update',
  'test:all:parallel',
  'test:all:parallel:analyze',
]);
const EXCLUDED_SCRIPT_PATTERN = /watch/i;
const TEST_WORKSPACE_WRAPPER_SCRIPT_NAMES = new Set([
  'test',
  'test:rstest',
  'test:ut',
]);

const discoverCommands = () => {
  const packageFiles = collectPackageJsonFiles();
  const commands = [];
  const seen = new Set();

  for (const pkgFile of packageFiles) {
    let packageJson;
    try {
      packageJson = readJson(pkgFile);
    } catch {
      continue;
    }

    const packageDir = path.dirname(pkgFile);
    const packagePath = rel(pkgFile) || 'package.json';
    const scripts = packageJson.scripts || {};
    const scriptNames = Object.keys(scripts)
      .filter(name => /^test(?::|$)/.test(name))
      .filter(name => !EXCLUDED_SCRIPT_NAMES.has(name))
      .filter(name => !EXCLUDED_SCRIPT_PATTERN.test(name))
      .filter(
        name =>
          !(
            packagePath === 'tests/package.json' &&
            TEST_WORKSPACE_WRAPPER_SCRIPT_NAMES.has(name)
          ),
      )
      .sort((a, b) => a.localeCompare(b));

    if (scriptNames.length === 0) {
      continue;
    }

    for (const scriptName of scriptNames) {
      const dedupeKey = `${packageDir}::${scriptName}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      commands.push({
        packageDir,
        packagePath,
        scriptName,
        scriptCommand: scripts[scriptName],
      });
    }
  }

  commands.sort((left, right) => {
    const leftRoot = left.packagePath === 'package.json' ? 0 : 1;
    const rightRoot = right.packagePath === 'package.json' ? 0 : 1;
    if (leftRoot !== rightRoot) {
      return leftRoot - rightRoot;
    }
    if (left.packagePath !== right.packagePath) {
      return left.packagePath.localeCompare(right.packagePath);
    }
    return left.scriptName.localeCompare(right.scriptName);
  });

  return commands.map((command, index) => ({
    ...command,
    index: index + 1,
    id: `${command.packagePath}#${command.scriptName}`,
  }));
};

const detectRunawayScript = command =>
  /\btest-orchestrator-runaway\b/i.test(
    `${command.scriptName} ${command.scriptCommand}`,
  );

const detectFrameworkScript = command => {
  const source = `${command.packagePath}#${command.scriptName} ${command.scriptCommand}`;
  return /test:framework/i.test(source);
};

const detectBuilderScript = command => {
  const source = `${command.packagePath}#${command.scriptName} ${command.scriptCommand}`;
  return /test:builder|playwright/i.test(source);
};

const detectGeneratorScript = command =>
  command.packagePath === 'tests/package.json' &&
  ['test:module', 'test:monorepo', 'test:mwa'].includes(command.scriptName);

const detectRstestAdapterScript = command =>
  command.packagePath === 'tests/package.json' &&
  command.scriptName === 'test:rstest-adapter';

const laneForCommand = command => {
  if (detectRunawayScript(command)) {
    return 'runaway';
  }
  if (detectFrameworkScript(command)) {
    return 'framework';
  }
  if (detectBuilderScript(command)) {
    return 'builder';
  }
  if (detectGeneratorScript(command)) {
    return 'generators';
  }
  if (detectRstestAdapterScript(command)) {
    return 'rstest-adapter';
  }
  if (/--passWithNoTests/.test(command.scriptCommand)) {
    return 'fast-passwithnotests';
  }
  if (
    command.packagePath === 'package.json' &&
    command.scriptName === 'test:ut'
  ) {
    return 'root-ut';
  }
  return 'default';
};

const timeoutForCommand = ({ command, args }) => {
  if (detectRunawayScript(command)) {
    return args.timeoutRunawayMs;
  }
  if (
    detectFrameworkScript(command) ||
    detectBuilderScript(command) ||
    detectRstestAdapterScript(command)
  ) {
    return args.timeoutHeavyMs;
  }
  return args.timeoutDefaultMs;
};

const killProcessTree = pid => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  try {
    spawnSync('pkill', ['-TERM', '-P', String(pid)], {
      stdio: 'ignore',
    });
  } catch {}

  try {
    process.kill(pid, 'SIGTERM');
  } catch {}

  setTimeout(() => {
    try {
      spawnSync('pkill', ['-KILL', '-P', String(pid)], {
        stdio: 'ignore',
      });
    } catch {}
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }, 10000);
};

const toMillis = value => {
  const matched = String(value).match(/^([0-9]+(?:\.[0-9]+)?)(ms|s)$/);
  if (!matched) {
    return null;
  }
  const numeric = Number(matched[1]);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return matched[2] === 's' ? Math.round(numeric * 1000) : Math.round(numeric);
};

const SLOW_FILE_PATTERNS = [
  /^\s*[✓✔]\s+(.+?)\s+\((?:[^)]*?)\)\s+([0-9]+(?:\.[0-9]+)?(?:ms|s))\s*$/,
  /^\s*[✓✔]\s+\d+\s+\[[^\]]+\]\s+›\s+(.+?)\s+\(([0-9]+(?:\.[0-9]+)?(?:ms|s))\)\s*$/,
];

const FAILURE_PATTERNS = [
  /CACError: .+/,
  /TimeoutError: .+/,
  /AssertionError: .+/,
  /Error: .+/,
  /No test files found.*/,
  /CrossOriginEnvelopePolicyError: .+/,
  /Cannot find module .+/,
  /Unknown option `--filter`/,
  /ELIFECYCLE.*Command failed.*/,
  /ELIFECYCLE.*Test failed.*/,
  /ABORT_ERR/,
];

const parseLogInsights = logContent => {
  const slowItems = [];
  const failures = [];
  const seenFailures = new Set();
  let failedTestFilesLine;
  let failedTestsLine;

  const lines = logContent.split('\n');
  for (const line of lines) {
    for (const pattern of SLOW_FILE_PATTERNS) {
      const matched = line.match(pattern);
      if (!matched) {
        continue;
      }
      const durationMs = toMillis(matched[2]);
      if (durationMs != null) {
        slowItems.push({
          name: matched[1].trim(),
          durationMs,
          raw: line.trim(),
        });
      }
      break;
    }

    if (!failedTestFilesLine && /Test Files\s+\d+\s+failed/.test(line)) {
      failedTestFilesLine = line.trim();
    }
    if (!failedTestsLine && /Tests\s+\d+\s+failed/.test(line)) {
      failedTestsLine = line.trim();
    }

    for (const pattern of FAILURE_PATTERNS) {
      const matched = line.match(pattern);
      if (!matched) {
        continue;
      }
      const key = matched[0];
      if (!seenFailures.has(key)) {
        seenFailures.add(key);
        failures.push(key);
      }
    }
  }

  slowItems.sort((left, right) => right.durationMs - left.durationMs);

  return {
    slowItems,
    failureSignatures: failures.slice(0, 50),
    failedTestFilesLine,
    failedTestsLine,
  };
};

const runCommand = ({ command, logFilePath, args, quiet }) =>
  new Promise(resolve => {
    ensureDir(path.dirname(logFilePath));
    const logStream = fs.createWriteStream(logFilePath);
    const startedAt = Date.now();
    const lane = laneForCommand(command);
    const timeoutMs = timeoutForCommand({ command, args });

    if (!quiet) {
      console.log(
        `[test-orchestrator] start #${command.index} (${lane}) ${command.id}`,
      );
    }

    const child = spawn(
      'npm',
      [
        'exec',
        '--yes',
        'pnpm@11',
        '--',
        '--dir',
        command.packageDir,
        'run',
        command.scriptName,
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          CI: '1',
          FORCE_COLOR: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      logStream.write(
        `\n[test-orchestrator-timeout] exceeded ${String(timeoutMs)}ms\n`,
      );
      killProcessTree(child.pid);
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      logStream.write(chunk);
    });
    child.stderr.on('data', chunk => {
      logStream.write(chunk);
    });

    const finalize = ({ exitCode, signal, parseError }) => {
      clearTimeout(timeoutHandle);
      const finishedAt = Date.now();
      logStream.end();

      let logContent = '';
      try {
        logContent = fs.readFileSync(logFilePath, 'utf8');
      } catch {
        // Keep empty log content if unavailable.
      }
      const parsed = parseLogInsights(logContent);

      const durationMs = finishedAt - startedAt;
      const status = timedOut ? 'timeout' : exitCode === 0 ? 'pass' : 'fail';

      if (!quiet) {
        console.log(
          `[test-orchestrator] done  #${command.index} (${lane}) ${command.id} status=${status} duration=${String(durationMs)}ms`,
        );
      }

      resolve({
        ...command,
        lane,
        timeoutMs,
        timedOut,
        status,
        exitCode,
        signal,
        parseError,
        durationMs,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        logPath: rel(logFilePath),
        topSlowItems: parsed.slowItems.slice(0, 30),
        failureSignatures: parsed.failureSignatures,
        failedTestFilesLine: parsed.failedTestFilesLine,
        failedTestsLine: parsed.failedTestsLine,
      });
    };

    child.on('error', error => {
      logStream.write(`\n[test-orchestrator-error] ${String(error)}\n`);
      finalize({
        exitCode: -1,
        signal: null,
        parseError: String(error),
      });
    });

    child.on('close', (code, signal) => {
      finalize({
        exitCode: code ?? 0,
        signal: signal ?? null,
        parseError: undefined,
      });
    });
  });

const runInParallelLanes = async ({ commands, runRoot, args, quiet }) => {
  const laneBuckets = new Map();
  for (const command of commands) {
    const lane = laneForCommand(command);
    if (!laneBuckets.has(lane)) {
      laneBuckets.set(lane, []);
    }
    laneBuckets.get(lane).push(command);
  }

  const orderedLaneNames = [...laneBuckets.keys()];
  orderedLaneNames.sort((left, right) => left.localeCompare(right));

  const selectedLaneNames = orderedLaneNames.slice(
    0,
    Math.max(1, args.maxLanes),
  );
  const deferredLaneNames = orderedLaneNames.slice(selectedLaneNames.length);

  const activeLaneNames = [...selectedLaneNames];
  for (const laneName of deferredLaneNames) {
    let smallestLaneName = activeLaneNames[0];
    for (const candidate of activeLaneNames) {
      if (
        laneBuckets.get(candidate).length <
        laneBuckets.get(smallestLaneName).length
      ) {
        smallestLaneName = candidate;
      }
    }
    laneBuckets.set(smallestLaneName, [
      ...laneBuckets.get(smallestLaneName),
      ...laneBuckets.get(laneName),
    ]);
    laneBuckets.delete(laneName);
  }

  const laneEntries = [...laneBuckets.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  );

  if (!quiet) {
    console.log(
      `[test-orchestrator] lane plan: ${laneEntries
        .map(([name, bucket]) => `${name}=${String(bucket.length)}`)
        .join(', ')}`,
    );
  }

  const runLogDir = path.join(runRoot, 'logs');
  const results = [];
  const laneWorkers = laneEntries.map(async ([laneName, laneCommands]) => {
    for (const command of laneCommands) {
      const logFileName = `${String(command.index).padStart(3, '0')}--${command.packagePath
        .replace(/[\\/]/g, '__')
        .replace(/[^a-zA-Z0-9._-]/g, '_')}--${command.scriptName.replace(
        /[^a-zA-Z0-9._-]/g,
        '_',
      )}.log`;
      const result = await runCommand({
        command: {
          ...command,
          laneName,
        },
        logFilePath: path.join(runLogDir, logFileName),
        args,
        quiet,
      });
      results.push(result);
    }
  });

  await Promise.all(laneWorkers);
  return results.sort((left, right) => left.index - right.index);
};

const aggregateSlowTests = results => {
  const allItems = [];
  for (const result of results) {
    for (const item of result.topSlowItems || []) {
      allItems.push({
        scriptId: result.id,
        scriptIndex: result.index,
        scriptDurationMs: result.durationMs,
        logPath: result.logPath,
        ...item,
      });
    }
  }
  allItems.sort((left, right) => right.durationMs - left.durationMs);

  const uniqueMap = new Map();
  for (const item of allItems) {
    const key = item.name;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, {
        name: key,
        maxDurationMs: item.durationMs,
        occurrences: 1,
        maxSource: {
          scriptId: item.scriptId,
          scriptIndex: item.scriptIndex,
          logPath: item.logPath,
        },
      });
      continue;
    }
    const current = uniqueMap.get(key);
    current.occurrences += 1;
    if (item.durationMs > current.maxDurationMs) {
      current.maxDurationMs = item.durationMs;
      current.maxSource = {
        scriptId: item.scriptId,
        scriptIndex: item.scriptIndex,
        logPath: item.logPath,
      };
    }
  }

  const unique = [...uniqueMap.values()].sort(
    (left, right) => right.maxDurationMs - left.maxDurationMs,
  );

  return {
    allItems,
    unique,
  };
};

const aggregateFailures = results =>
  results
    .filter(result => result.status !== 'pass')
    .map(result => ({
      scriptIndex: result.index,
      scriptId: result.id,
      lane: result.lane,
      status: result.status,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      signal: result.signal,
      logPath: result.logPath,
      failedTestFilesLine: result.failedTestFilesLine,
      failedTestsLine: result.failedTestsLine,
      failureSignatures: result.failureSignatures,
    }));

const summarizeRun = ({ results, runRoot, args }) => {
  const rankedScripts = [...results].sort(
    (left, right) => right.durationMs - left.durationMs,
  );
  const slowTests = aggregateSlowTests(results);
  const failures = aggregateFailures(results);

  const counts = {
    total: results.length,
    pass: results.filter(result => result.status === 'pass').length,
    fail: results.filter(result => result.status === 'fail').length,
    timeout: results.filter(result => result.status === 'timeout').length,
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    host: {
      platform: os.platform(),
      release: os.release(),
      cpus: os.cpus().length,
      node: process.version,
    },
    config: {
      mode: args.mode,
      maxLanes: args.maxLanes,
      timeoutDefaultMs: args.timeoutDefaultMs,
      timeoutHeavyMs: args.timeoutHeavyMs,
      timeoutRunawayMs: args.timeoutRunawayMs,
    },
    runRoot: rel(runRoot),
    totalDurationMs: results.reduce(
      (total, result) => total + result.durationMs,
      0,
    ),
    counts,
    rankedScripts,
    failures,
    slowTests: {
      rawTop: slowTests.allItems.slice(0, 500),
      uniqueTop: slowTests.unique.slice(0, 500),
    },
  };

  return summary;
};

const writeSummaryArtifacts = ({ runRoot, summary }) => {
  const summaryPath = path.join(runRoot, 'summary.json');
  const rankingsPath = path.join(runRoot, 'script-rankings.json');
  const failuresPath = path.join(runRoot, 'failures.json');
  const slowRawPath = path.join(runRoot, 'slowest-tests.raw.json');
  const slowUniquePath = path.join(runRoot, 'slowest-tests.unique.json');
  const reportPath = path.join(runRoot, 'REPORT.md');

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(
    rankingsPath,
    JSON.stringify(summary.rankedScripts, null, 2),
  );
  fs.writeFileSync(failuresPath, JSON.stringify(summary.failures, null, 2));
  fs.writeFileSync(
    slowRawPath,
    JSON.stringify(summary.slowTests.rawTop, null, 2),
  );
  fs.writeFileSync(
    slowUniquePath,
    JSON.stringify(summary.slowTests.uniqueTop, null, 2),
  );

  const reportLines = [];
  reportLines.push('# Parallel Test Run Report');
  reportLines.push('');
  reportLines.push(`- Run dir: \`${summary.runRoot}\``);
  reportLines.push(`- Generated at: ${summary.generatedAt}`);
  reportLines.push(
    `- Totals: ${summary.counts.total} scripts (${summary.counts.pass} pass, ${summary.counts.fail} fail, ${summary.counts.timeout} timeout)`,
  );
  reportLines.push(
    `- Cumulative wall-time: ${(summary.totalDurationMs / 1000).toFixed(3)}s`,
  );
  reportLines.push('');

  reportLines.push('## Slowest Scripts');
  reportLines.push('');
  for (const item of summary.rankedScripts.slice(0, 30)) {
    reportLines.push(
      `- #${String(item.index).padStart(2, '0')} \`${item.id}\` :: ${(item.durationMs / 1000).toFixed(3)}s :: ${item.status}`,
    );
  }
  reportLines.push('');

  reportLines.push('## Slowest Test Files (Unique)');
  reportLines.push('');
  for (const item of summary.slowTests.uniqueTop.slice(0, 30)) {
    reportLines.push(
      `- \`${item.name}\` :: ${(item.maxDurationMs / 1000).toFixed(3)}s (occurrences=${item.occurrences})`,
    );
  }
  reportLines.push('');

  reportLines.push('## Failures');
  reportLines.push('');
  if (summary.failures.length === 0) {
    reportLines.push('- None');
  } else {
    for (const failure of summary.failures) {
      reportLines.push(
        `- #${String(failure.scriptIndex).padStart(2, '0')} \`${failure.scriptId}\` :: ${failure.status} :: ${(failure.durationMs / 1000).toFixed(3)}s`,
      );
      if (failure.failureSignatures.length > 0) {
        reportLines.push(
          `  signatures: ${failure.failureSignatures.slice(0, 3).join(' | ')}`,
        );
      }
      reportLines.push(`  log: \`${failure.logPath}\``);
    }
  }
  reportLines.push('');

  fs.writeFileSync(reportPath, reportLines.join('\n'));

  return {
    summaryPath: rel(summaryPath),
    rankingsPath: rel(rankingsPath),
    failuresPath: rel(failuresPath),
    slowRawPath: rel(slowRawPath),
    slowUniquePath: rel(slowUniquePath),
    reportPath: rel(reportPath),
  };
};

const resolveCurrentCommandForAnalyze = ({ packagePath, scriptName }) => {
  const discoveredCommands = discoverCommands();
  const discovered = discoveredCommands.find(
    command =>
      command.packagePath === packagePath && command.scriptName === scriptName,
  );
  if (discovered) {
    return discovered;
  }

  const pkgFile = path.join(REPO_ROOT, packagePath);
  if (fs.existsSync(pkgFile)) {
    try {
      const packageJson = readJson(pkgFile);
      const scriptCommand = packageJson.scripts?.[scriptName];
      if (typeof scriptCommand === 'string') {
        return {
          packageDir: path.dirname(pkgFile),
          packagePath,
          scriptName,
          scriptCommand,
          id: `${packagePath}#${scriptName}`,
          index: 0,
        };
      }
    } catch {}
  }

  return {
    packageDir: path.dirname(path.join(REPO_ROOT, packagePath)),
    packagePath,
    scriptName,
    scriptCommand: 'n/a (analyze mode)',
    id: `${packagePath}#${scriptName}`,
    index: 0,
  };
};

const resolveRunDirForAnalyze = args => {
  if (args.runDir) {
    const resolved = path.resolve(args.runDir);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Run directory not found: ${resolved}`);
    }
    return resolved;
  }

  const outputRoot = path.resolve(args.outputDir);
  if (!fs.existsSync(outputRoot)) {
    throw new Error(`Output directory not found: ${outputRoot}`);
  }
  const entries = fs
    .readdirSync(outputRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(outputRoot, entry.name))
    .sort((left, right) => right.localeCompare(left));
  if (entries.length === 0) {
    throw new Error(`No run directories found in ${outputRoot}`);
  }
  return entries[0];
};

const buildSummaryFromExistingRun = ({ runDir, args }) => {
  const logsDir = path.join(runDir, 'logs');
  if (!fs.existsSync(logsDir)) {
    throw new Error(`Logs directory not found: ${logsDir}`);
  }

  const logFiles = fs
    .readdirSync(logsDir)
    .filter(file => file.endsWith('.log'))
    .sort((left, right) => left.localeCompare(right));
  const results = logFiles.map(logFile => {
    const logPath = path.join(logsDir, logFile);
    const logContent = fs.readFileSync(logPath, 'utf8');
    const parsed = parseLogInsights(logContent);

    const match = logFile.match(/^(\d+)--(.+)--(.+)\.log$/);
    const index = match ? Number.parseInt(match[1], 10) : 0;
    const packagePath = match ? match[2].replace(/__/g, '/') : 'unknown';
    const scriptName = match ? match[3].replace(/_/g, ':') : 'test';
    const command = resolveCurrentCommandForAnalyze({
      packagePath,
      scriptName,
    });

    const status =
      /\[test-orchestrator-timeout\]|\[tail-timeout\]|\[manual-timeout\]/.test(
        logContent,
      )
        ? 'timeout'
        : /ELIFECYCLE.*Command failed|Test Files\s+\d+\s+failed|CACError:|Cannot find module/.test(
              logContent,
            )
          ? 'fail'
          : 'pass';

    return {
      index,
      id: command.id,
      packagePath,
      scriptName,
      scriptCommand: command.scriptCommand,
      lane: laneForCommand(command),
      timeoutMs: timeoutForCommand({
        command,
        args,
      }),
      timedOut: status === 'timeout',
      status,
      exitCode: status === 'pass' ? 0 : 1,
      signal: null,
      parseError: undefined,
      durationMs: 0,
      startedAt: undefined,
      finishedAt: undefined,
      logPath: rel(logPath),
      topSlowItems: parsed.slowItems.slice(0, 30),
      failureSignatures: parsed.failureSignatures,
      failedTestFilesLine: parsed.failedTestFilesLine,
      failedTestsLine: parsed.failedTestsLine,
    };
  });

  return summarizeRun({
    results,
    runRoot: runDir,
    args,
  });
};

const run = async args => {
  const outputRoot = path.resolve(args.outputDir);
  ensureDir(outputRoot);

  const runRoot = path.join(outputRoot, `${DEFAULT_RUN_PREFIX}-${nowStamp()}`);
  ensureDir(runRoot);

  const commands = discoverCommands();
  console.log(
    `[test-orchestrator] discovered ${String(commands.length)} scripts`,
  );

  const results = await runInParallelLanes({
    commands,
    runRoot,
    args,
    quiet: args.quiet,
  });

  const summary = summarizeRun({
    results,
    runRoot,
    args,
  });
  const artifactPaths = writeSummaryArtifacts({
    runRoot,
    summary,
  });

  console.log(
    `[test-orchestrator] completed with ${summary.counts.pass} pass, ${summary.counts.fail} fail, ${summary.counts.timeout} timeout`,
  );
  console.log(
    `[test-orchestrator] report: ${artifactPaths.reportPath}\n[test-orchestrator] summary: ${artifactPaths.summaryPath}`,
  );

  if (summary.counts.fail > 0 || summary.counts.timeout > 0) {
    process.exitCode = 1;
  }
};

const analyze = args => {
  const runDir = resolveRunDirForAnalyze(args);
  const summary = buildSummaryFromExistingRun({
    runDir,
    args,
  });
  const artifactPaths = writeSummaryArtifacts({
    runRoot: runDir,
    summary,
  });

  console.log(
    `[test-orchestrator] analyzed ${summary.counts.total} scripts in ${rel(runDir)}`,
  );
  console.log(
    `[test-orchestrator] report: ${artifactPaths.reportPath}\n[test-orchestrator] summary: ${artifactPaths.summaryPath}`,
  );
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'analyze') {
    analyze(args);
    return;
  }
  await run(args);
};

main().catch(error => {
  console.error(`[test-orchestrator] failed: ${error.message}`);
  process.exit(1);
});
