#!/usr/bin/env node
// UltraModern renderer release acceptance: one driver, real behavioral checks.
//
//   /Users/satan/bin/owned-temp-dir --run renderer-release -- \
//     node scripts/ultramodern-renderers/acceptance/release.mjs \
//       [--cohort-dir <dir> | --version <x.y.z-ultramodern.N>] \
//       [--only http,browser,reject,worker,mf,rsc,tractor] \
//       [--renderers react,solid,octane] [--node <bin>] [--browser-executable <bin>]
//
// Prints a PASS/FAIL/SKIP matrix, writes report.json and exits 1 on any FAIL.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  assertBinding,
  atomicJson,
  readEvidence,
  registerArtifact,
  releaseRegisteredArtifacts,
} from './release-support.mjs';

const scriptFile = fileURLToPath(import.meta.url);
const acceptanceDir = path.dirname(scriptFile);
const workspaceRoot = path.resolve(acceptanceDir, '../../..');
const allSteps = [
  'http',
  'browser',
  'reject',
  'worker',
  'mf',
  'rsc',
  'tractor',
];
const allRenderers = ['react', 'solid', 'octane'];
const minimumFreeBytes = 12 * 1024 ** 3;

const usage = `Usage: node release.mjs [options]
  --cohort-dir <dir>          reuse a prepared cohort (contains manifest.json)
  --version <version>         build + prepare a cohort from the clean committed tree
  --only <steps>              comma list of ${allSteps.join(',')} (default: all)
  --renderers <list>          comma list of ${allRenderers.join(',')} (default: all)
  --node <bin>                qualified Node (must match manifest tools.node)
  --pnpm <bin>                pnpm executable (default: from PATH)
  --store-dir <dir>           pnpm store (default: \`pnpm store path\`)
  --browser-executable <bin>  Chrome for Testing (default: auto-discover)
  --browser-dependency-root <dir>  directory resolving playwright-core (default: provisioned)
  --tractor-source <dir>      clean tractor-store-vertical-demo checkout
  --work-dir <dir>            scratch root (default: $OWNED_TEMP_DIR)
  --report <file>             report path (default: .modern/renderer-release/<stamp>/report.json)
  --step-timeout-min <n>      per-step timeout in minutes (default: 120)`;

export function parseReleaseOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      'cohort-dir': { type: 'string' },
      version: { type: 'string' },
      only: { type: 'string' },
      renderers: { type: 'string' },
      node: { type: 'string' },
      pnpm: { type: 'string' },
      'store-dir': { type: 'string' },
      'browser-executable': { type: 'string' },
      'browser-dependency-root': { type: 'string' },
      'tractor-source': { type: 'string' },
      'work-dir': { type: 'string' },
      report: { type: 'string' },
      'step-timeout-min': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    process.stdout.write(`${usage}\n`);
    process.exit(0);
  }
  const list = (value, all, label) => {
    const selected = value
      ? value
          .split(',')
          .map(item => item.trim())
          .filter(Boolean)
      : all;
    for (const item of selected)
      assert(all.includes(item), `Unknown ${label}: ${item}`);
    return all.filter(item => selected.includes(item));
  };
  assert(
    values['cohort-dir'] || values.version,
    'Pass --cohort-dir <dir> or --version <version> to build one',
  );
  return {
    ...values,
    steps: list(values.only, allSteps, 'step'),
    renderers: list(values.renderers, allRenderers, 'renderer'),
    stepTimeoutMs: Number(values['step-timeout-min'] ?? 120) * 60_000,
  };
}

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\..+$/u, '')
    .replace('T', '-');
}

function findOnPath(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`${name} was not found on PATH`);
}

function newestMatch(roots, relative) {
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root).sort().reverse()) {
      const candidate = path.join(root, name, relative);
      if (fs.existsSync(candidate)) found.push(candidate);
    }
  }
  return found[0];
}

export function discoverBrowserExecutable(explicit) {
  if (explicit) return explicit;
  if (process.env.PUPPETEER_EXECUTABLE_PATH)
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  const home = os.homedir();
  const app =
    process.platform === 'darwin'
      ? `chrome-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
      : 'chrome-linux64/chrome';
  return (
    newestMatch([path.join(home, '.cache/puppeteer/chrome')], app) ??
    newestMatch(
      [
        path.join(home, 'Library/Caches/ms-playwright'),
        path.join(home, '.cache/ms-playwright'),
      ],
      app,
    )
  );
}

function freeBytes(directory) {
  const stat = fs.statfsSync(directory);
  return Number(stat.bavail) * Number(stat.bsize);
}

function assertDiskSpace(directory) {
  const free = freeBytes(directory);
  assert(
    free >= minimumFreeBytes,
    `Only ${(free / 1024 ** 3).toFixed(1)} GiB free under ${directory}; need >= 12 GiB`,
  );
}

function firstLine(error) {
  const text = String(error?.message ?? error ?? '');
  return (
    text
      .split('\n')
      .map(line => line.trim())
      .find(Boolean) ?? 'failed'
  ).slice(0, 200);
}

function run(
  command,
  args,
  { cwd = workspaceRoot, env = process.env, log } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (log) fs.writeFileSync(log, output);
  if (result.error || result.status !== 0)
    throw new Error(
      `${path.basename(command)} ${args.join(' ')} exited ${result.status ?? result.signal}${log ? `; see ${log}` : ''}\n${output.slice(-2000)}`,
    );
  return output.trim();
}

/** Builds the clean committed tree and prepares a publishable cohort directory. */
function buildCohort({ version, pnpm, logs, owner }) {
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']);
  assert.equal(
    dirty,
    '',
    'Cohort build requires a clean committed tree (tracked files)',
  );
  const out = path.join(
    workspaceRoot,
    '.modern/bleedingdev-publish/build',
    `renderer-release-${stamp()}`,
    'build',
  );
  run(pnpm, ['ultramodern:build-bleedingdev-publish'], {
    log: path.join(logs, 'cohort-build.log'),
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  registerArtifact(path.dirname(out), {
    owner,
    ownerPid: process.pid,
    kind: 'build',
  });
  run(
    pnpm,
    [
      'ultramodern:prepare-bleedingdev-publish',
      '--',
      '--version',
      version,
      '--scope',
      'bleedingdev',
      '--prefix',
      'modern-js-',
      '--tag',
      'latest',
      '--include-sidecars',
      '--out',
      out,
    ],
    { log: path.join(logs, 'cohort-prepare.log') },
  );
  return out;
}

/** Clones the workspace's locked playwright-core into an owned resolvable root. */
function provisionBrowserDependencies(root) {
  const store = path.join(workspaceRoot, 'node_modules/.pnpm');
  const source = newestMatch([store], 'node_modules/playwright-core');
  assert(
    source &&
      fs.readdirSync(store).some(name => name.startsWith('playwright-core@')),
    'playwright-core is not installed in the workspace; pass --browser-dependency-root',
  );
  const target = path.join(root, 'node_modules/playwright-core');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'renderer-release-browser-deps', private: true }, null, 2)}\n`,
  );
  if (process.platform === 'darwin')
    execFileSync('cp', ['-cR', source, target]);
  else fs.cpSync(source, target, { recursive: true });
  return root;
}

/** Copies *.log files out of the work root, which is deleted after the run. */
function keepLogs(root, destination) {
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.pnpm-store', 'storage'].includes(entry.name))
          visit(file);
      } else if (entry.isFile() && entry.name.endsWith('.log')) {
        const target = path.join(destination, path.relative(root, file));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target);
      }
    }
  };
  try {
    visit(root);
  } catch (error) {
    process.stderr.write(`[release] could not keep logs: ${error.message}\n`);
  }
}

function spawnProof(node, args, { cwd, env, log, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const descriptor = fs.openSync(log, 'w');
    const child = spawn(node, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', descriptor, descriptor],
    });
    fs.closeSync(descriptor);
    const kill = signalName => {
      try {
        process.kill(-child.pid, signalName);
      } catch {}
    };
    const timer = setTimeout(() => kill('SIGTERM'), timeoutMs);
    const onAbort = () => kill('SIGTERM');
    signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      kill('SIGKILL');
      if (code === 0) resolve();
      else {
        const tail = fs
          .readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .slice(-30)
          .join('\n');
        reject(
          new Error(
            `${path.basename(args[0])} exited ${code}; log ${log}\n${tail}`,
          ),
        );
      }
    });
  });
}

export function formatMatrix(results) {
  const rows = results.map(result => [
    result.name,
    result.status,
    result.seconds.toFixed(1),
    result.error ?? '',
  ]);
  const header = ['step', 'result', 'seconds', 'first error'];
  const widths = header.map((title, index) =>
    Math.max(title.length, ...rows.map(row => row[index].length)),
  );
  const line = row =>
    row
      .map((cell, index) => cell.padEnd(widths[index]))
      .join(' | ')
      .trimEnd();
  return [
    line(header),
    widths.map(width => '-'.repeat(width)).join('-|-'),
    ...rows.map(line),
  ].join('\n');
}

async function main(opts) {
  const workRoot = fs.realpathSync(
    opts['work-dir'] ??
      process.env.OWNED_TEMP_DIR ??
      fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-release-')),
  );
  assertDiskSpace(workRoot);
  // Children must not inherit a NODE_PATH that points at another checkout
  // (pnpm .bin launchers in cloned worktrees set one), and must see a
  // canonical TMPDIR: /var/folders is a symlink that breaks realpath checks.
  delete process.env.NODE_PATH;
  const tmp = path.join(workRoot, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  process.env.TMPDIR = `${tmp}/`;
  const owner = `renderer-release-${process.pid}`;
  const ownerPid = process.pid;
  const runStamp = stamp();
  const reportPath = path.resolve(
    opts.report ??
      path.join(
        workspaceRoot,
        '.modern/renderer-release',
        runStamp,
        'report.json',
      ),
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const logs = path.join(workRoot, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const controller = new AbortController();
  const abort = name => () =>
    controller.abort(new Error(`Interrupted by ${name}`));
  const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(name => [
    name,
    abort(name),
  ]);
  for (const [name, handler] of handlers) process.on(name, handler);

  const results = [];
  const state = {};
  const step = async (name, body, { skip } = {}) => {
    const started = performance.now();
    if (skip) {
      results.push({ name, status: 'SKIP', seconds: 0, error: skip });
      return undefined;
    }
    process.stdout.write(`[release] ${name} ...\n`);
    let timer;
    const deadline = new AbortController();
    const signal = AbortSignal.any([controller.signal, deadline.signal]);
    try {
      signal.throwIfAborted();
      assertDiskSpace(workRoot);
      const detail = await Promise.race([
        body(signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(
              `${name} exceeded ${opts.stepTimeoutMs / 60_000} min`,
            );
            deadline.abort(error);
            reject(error);
          }, opts.stepTimeoutMs);
        }),
      ]);
      results.push({
        name,
        status: 'PASS',
        seconds: (performance.now() - started) / 1000,
        detail,
      });
      process.stdout.write(`[release] ${name} PASS\n`);
      return detail ?? true;
    } catch (error) {
      results.push({
        name,
        status: 'FAIL',
        seconds: (performance.now() - started) / 1000,
        error: firstLine(error),
        stack: String(error?.stack ?? error),
      });
      process.stdout.write(`[release] ${name} FAIL: ${firstLine(error)}\n`);
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  };

  const wants = name => opts.steps.includes(name);
  const native = opts.renderers.filter(renderer => renderer !== 'react');
  const hasReact = opts.renderers.includes('react');
  let hostHandles = [];
  try {
    const qualifiedNode = fs.realpathSync(process.execPath);
    const pnpm = opts.pnpm ? path.resolve(opts.pnpm) : findOnPath('pnpm');
    let storeDir;

    // 1. Cohort: reuse or build+prepare, then audit packed artifacts.
    const cohort = await step('cohort', async () => {
      const cohortDir = opts['cohort-dir']
        ? path.resolve(opts['cohort-dir'])
        : buildCohort({ version: opts.version, pnpm, logs, owner });
      const manifestPath = path.join(cohortDir, 'manifest.json');
      const { readReleaseManifest } = await import(
        '../../ultramodern-publish/lib/source-create-proof/release-manifest.mjs'
      );
      const { auditReleaseArtifacts } = await import('./artifacts.mjs');
      const release = readReleaseManifest({ manifestPath });
      const wantedNode = release.tools.node.replace(/^v/u, '');
      assert.equal(
        process.versions.node,
        wantedNode,
        `Driver runs Node ${process.versions.node}; the cohort requires ${wantedNode} (use --node)`,
      );
      // proto shims resolve pnpm per directory; pin the cohort's pnpm for
      // every child (consumer roots live outside this repository).
      process.env.PROTO_PNPM_VERSION ??= release.tools.pnpm;
      assert.equal(
        run(pnpm, ['--version'], { cwd: workRoot }),
        release.tools.pnpm,
        'pnpm version differs from the cohort tools',
      );
      storeDir = opts['store-dir']
        ? path.resolve(opts['store-dir'])
        : run(pnpm, ['store', 'path'], { cwd: workRoot });
      const artifacts = auditReleaseArtifacts({
        manifestPath,
        expectedSourceRevision: release.source.commit,
      });
      state.manifestPath = manifestPath;
      state.release = release;
      state.artifacts = artifacts;
      state.binding = {
        sourceRevision: artifacts.sourceRevision,
        releaseVersion: artifacts.release.version,
        manifestSha256: artifacts.manifestSha256,
        frameworkCohortDigest: artifacts.cohortDigest,
      };
      return {
        manifestPath,
        version: release.release.version,
        sourceRevision: release.source.commit,
        artifacts: artifacts.artifacts.length,
      };
    });
    const noCohort = cohort ? undefined : 'cohort unavailable';

    const needsBrowser = ['browser', 'mf', 'rsc'].some(wants);
    const browserExecutable = needsBrowser
      ? discoverBrowserExecutable(opts['browser-executable'])
      : undefined;
    if (needsBrowser)
      assert(
        browserExecutable,
        'No Chrome for Testing found; pass --browser-executable',
      );

    // 2. Consumers: installed generator -> generated + hand-authored apps.
    const consumerRenderers = new Set();
    if (wants('http') || wants('browser'))
      for (const renderer of opts.renderers) consumerRenderers.add(renderer);
    if (wants('reject'))
      for (const renderer of native) consumerRenderers.add(renderer);
    if (wants('worker') && hasReact) consumerRenderers.add('react');
    const consumerRoot = path.join(workRoot, 'consumer');
    const provisioned =
      consumerRenderers.size &&
      (await step(
        'provision',
        async signal => {
          const { provisionConsumers } = await import(
            './release-consumers.mjs'
          );
          fs.mkdirSync(consumerRoot);
          state.provisioned = await provisionConsumers({
            manifestPath: state.manifestPath,
            qualifiedNode,
            pnpm,
            storeDir,
            consumerRoot,
            renderers: allRenderers.filter(renderer =>
              consumerRenderers.has(renderer),
            ),
            baselines: wants('http') ? native : [],
            owner,
            ownerPid,
          });
          return {
            generator: state.provisioned.bareReport.generator.version,
            consumers: state.provisioned.rows.map(
              row => `${row.renderer}:${row.kind}`,
            ),
          };
        },
        { skip: noCohort },
      ));
    const noConsumers =
      noCohort ?? (provisioned ? undefined : 'provision failed');
    const conformanceRenderers = opts.renderers;
    const rowsFor = renderers =>
      state.provisioned.rows.filter(row => renderers.includes(row.renderer));

    // 3. HTTP conformance: untouched starters, build/typecheck/exports/HTTP probes.
    const http =
      wants('http') || wants('browser')
        ? await step(
            'http',
            async signal => {
              const { runHttpConformance, runUntouchedStarters } = await import(
                './release-consumers.mjs'
              );
              const untouched = await runUntouchedStarters({
                provisioned: state.provisioned,
                qualifiedNode,
                signal,
              });
              const result = await runHttpConformance({
                provisioned: {
                  ...state.provisioned,
                  rows: rowsFor(conformanceRenderers),
                },
                manifestPath: state.manifestPath,
                qualifiedNode,
                renderers: conformanceRenderers,
                captureCsrAuthority: wants('browser'),
                signal,
              });
              hostHandles = result.handles;
              state.http = result;
              if (!wants('browser')) {
                const { stopHandles } = await import('./release-consumers.mjs');
                await stopHandles(hostHandles);
              }
              return {
                untouchedStarters: untouched.map(receipt => receipt.renderer),
                httpCases: result.report.evidence.length,
                protocolCases: result.report.protocolEvidence.length,
                consumers: result.report.consumers.length,
              };
            },
            { skip: noConsumers },
          )
        : undefined;

    // 4. Browser: hydration, CSR, navigation, data, action, head assets, HMR.
    if (wants('browser'))
      await step(
        'browser',
        async signal => {
          const { runBrowserConformance } = await import(
            './release-browser.mjs'
          );
          try {
            const result = await runBrowserConformance({
              report: state.http.report,
              rows: state.http.rows,
              manifestPath: state.manifestPath,
              qualifiedNode,
              browserExecutable,
              profileRoot: path.join(workRoot, 'browser-profile'),
              renderers: conformanceRenderers,
              signal,
              onCase: id => process.stdout.write(`[browser] ${id} passed\n`),
            });
            return {
              browser: result.browserVersion,
              cases: result.evidence.length,
              csrEntryCases: result.csrEvidence.length,
            };
          } finally {
            const { stopHandles } = await import('./release-consumers.mjs');
            await stopHandles(hostHandles);
          }
        },
        { skip: noConsumers ?? (http ? undefined : 'http failed') },
      );

    // 5. Capability rejections: native renderers refuse worker/MF/RSC before setup.
    if (wants('reject'))
      await step(
        'reject',
        async signal => {
          const directory = path.join(workRoot, 'reject');
          fs.mkdirSync(directory, { recursive: true });
          const outcomes = [];
          for (const row of rowsFor(native))
            for (const capability of ['worker', 'module-federation', 'rsc']) {
              const stem = `${row.renderer}-${row.kind}-${capability}`;
              const input = path.join(directory, `${stem}-input.json`);
              const output = path.join(directory, `${stem}-proof.json`);
              atomicJson(input, {
                applicationRoot: row.appRoot,
                renderer: row.renderer,
                kind: row.kind,
                capability,
                configFile: path.join(row.appRoot, 'modern.config.ts'),
                binding: state.binding,
              });
              await spawnProof(
                qualifiedNode,
                [path.join(acceptanceDir, 'release-reject.mjs'), input, output],
                {
                  cwd: row.appRoot,
                  env: process.env,
                  log: path.join(directory, `${stem}.log`),
                  timeoutMs: 60_000,
                  signal,
                },
              );
              const result = readEvidence(output).value;
              assertBinding(result, state.binding);
              assert.equal(result.status, 'passed');
              assert.equal(
                result.diagnosticCode,
                'unsupported-renderer-capability',
              );
              assert.equal(result.setupObserverCalls, 0);
              outcomes.push(stem);
            }
          return { rejected: outcomes.length };
        },
        {
          skip:
            noConsumers ??
            (native.length ? undefined : 'no native renderer selected'),
        },
      );

    const env = {
      ...process.env,
      PATH: [
        path.dirname(qualifiedNode),
        path.dirname(pnpm),
        process.env.PATH,
      ].join(path.delimiter),
      npm_config_store_dir: storeDir,
    };
    const capabilityDir = path.join(workRoot, 'capabilities');
    fs.mkdirSync(capabilityDir, { recursive: true });
    const probeOptions = signal => ({
      workDir: capabilityDir,
      binding: state.binding,
      artifacts: state.artifacts,
      qualifiedNode,
      pnpmExecutable: pnpm,
      storeDir,
      browserExecutable,
      owner,
      ownerPid,
      signal,
      env,
    });

    // 6. React worker: installed public worker dispatch + SSR on workerd.
    if (wants('worker'))
      await step(
        'worker',
        async signal => {
          const { runWorkerDispatchProbe } = await import(
            './release-worker.mjs'
          );
          const react = state.provisioned.rows.find(
            row => row.renderer === 'react' && row.kind === 'generated',
          );
          const receipt = await runWorkerDispatchProbe({
            ...probeOptions(signal),
            receiptPath: path.join(capabilityDir, 'worker-dispatch-proof.json'),
            applicationRoot: react.appRoot,
            consumerRoot: react.consumerRoot,
            kind: 'generated',
            generatorPackageRoot: state.provisioned.generatorPackageRoot,
            generatorConsumerRoot: consumerRoot,
          });
          assert.equal(receipt.status, 'passed');
          return { dispatchForms: receipt.observations?.dispatchForms };
        },
        { skip: noConsumers ?? (hasReact ? undefined : 'react not selected') },
      );

    // 7. Module Federation: SSR + hydration + renderer guard, then MF lifecycle.
    if (wants('mf'))
      await step(
        'mf',
        async signal => {
          const browserDependencyRoot = opts['browser-dependency-root']
            ? path.resolve(opts['browser-dependency-root'])
            : provisionBrowserDependencies(path.join(workRoot, 'browser-deps'));
          const { runFederationProbe } = await import('./release-mf.mjs');
          const receipt = await runFederationProbe({
            ...probeOptions(signal),
            browserDependencyRoot,
            receiptPath: path.join(capabilityDir, 'native-mf-proof.json'),
          });
          assert.equal(receipt.status, 'passed');
          assert.equal(receipt.rendererGuardProof?.status, 'passed');
          const lifecycleDir = path.join(workRoot, 'mf-lifecycle');
          const lifecycleReceipt = path.join(
            workRoot,
            'mf-lifecycle-receipt.json',
          );
          await spawnProof(
            qualifiedNode,
            [
              path.join(
                workspaceRoot,
                'scripts/ultramodern-production-readiness/renderer-mf-lifecycle-proof/index.mjs',
              ),
              '--manifest',
              state.manifestPath,
              '--expected-source-revision',
              state.binding.sourceRevision,
              '--expected-version',
              state.binding.releaseVersion,
              '--qualified-node',
              qualifiedNode,
              '--pnpm-executable',
              pnpm,
              '--store-dir',
              storeDir,
              '--browser-dependency-root',
              browserDependencyRoot,
              '--browser-executable',
              browserExecutable,
              '--work-dir',
              lifecycleDir,
              '--receipt',
              lifecycleReceipt,
              '--owner',
              owner,
              '--owner-pid',
              String(ownerPid),
            ],
            {
              cwd: workspaceRoot,
              env,
              log: path.join(logs, 'mf-lifecycle.log'),
              timeoutMs: opts.stepTimeoutMs,
              signal,
            },
          );
          assert.equal(
            JSON.parse(fs.readFileSync(lifecycleReceipt, 'utf8')).status,
            'passed',
          );
          return {
            guardObservations:
              receipt.rendererGuardProof.receipt?.observations?.length,
            lifecycle: 'passed',
          };
        },
        { skip: noCohort ?? (hasReact ? undefined : 'react not selected') },
      );

    // 8. React RSC on workerd: Flight + HTML through the installed cohort.
    if (wants('rsc'))
      await step(
        'rsc',
        async signal => {
          const receiptPath = path.join(workRoot, 'rsc-receipt.json');
          await spawnProof(
            qualifiedNode,
            [
              path.join(
                workspaceRoot,
                'scripts/ultramodern-production-readiness/react-rsc-worker-proof/main.mjs',
              ),
              '--manifest',
              state.manifestPath,
              '--expected-source-revision',
              state.binding.sourceRevision,
              '--expected-version',
              state.binding.releaseVersion,
              '--work-dir',
              path.join(workRoot, 'rsc'),
              '--receipt',
              receiptPath,
              '--store-dir',
              storeDir,
              '--browser-executable',
              browserExecutable,
              '--owner',
              owner,
              '--owner-pid',
              String(ownerPid),
            ],
            {
              cwd: workspaceRoot,
              env,
              log: path.join(logs, 'rsc.log'),
              timeoutMs: opts.stepTimeoutMs,
              signal,
            },
          );
          assert.equal(
            JSON.parse(fs.readFileSync(receiptPath, 'utf8')).status,
            'passed',
          );
          return { receipt: 'passed' };
        },
        { skip: noCohort ?? (hasReact ? undefined : 'react not selected') },
      );

    // 9. Tractor downstream: real consumer adoption against a private clone.
    if (wants('tractor'))
      await step(
        'tractor',
        async signal => {
          const source = path.resolve(
            opts['tractor-source'] ??
              path.join(workspaceRoot, '../../tractor-adoption-20260924/demo'),
          );
          assert(
            fs.existsSync(path.join(source, 'package.json')),
            `No tractor demo at ${source}`,
          );
          const clone = path.join(workRoot, 'tractor-workspace');
          if (process.platform === 'darwin')
            execFileSync('cp', ['-cR', source, clone]);
          else fs.cpSync(source, clone, { recursive: true });
          registerArtifact(clone, { owner, ownerPid, kind: 'build' });
          const out = path.join(workRoot, 'tractor-report.json');
          await spawnProof(
            qualifiedNode,
            [
              path.join(
                workspaceRoot,
                'scripts/ultramodern-production-readiness/run-tractor-downstream-acceptance.mjs',
              ),
              '--mode',
              'source',
              '--manifest',
              state.manifestPath,
              '--workspace',
              clone,
              '--out',
              out,
            ],
            {
              cwd: workspaceRoot,
              env,
              log: path.join(logs, 'tractor.log'),
              timeoutMs: opts.stepTimeoutMs,
              signal,
            },
          );
          return { report: out };
        },
        { skip: noCohort },
      );
  } finally {
    for (const [name, handler] of handlers)
      process.removeListener(name, handler);
    if (hostHandles.length) {
      const { stopHandles } = await import('./release-consumers.mjs');
      await stopHandles(hostHandles).catch(error =>
        process.stderr.write(`[release] host teardown: ${error.message}\n`),
      );
    }
    releaseRegisteredArtifacts();
  }

  process.stdout.write(`\n${formatMatrix(results)}\n`);
  const failed = results.some(result => result.status === 'FAIL');
  if (failed) keepLogs(workRoot, path.join(path.dirname(reportPath), 'logs'));
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        schema: 'ultramodern-renderer-release-acceptance',
        version: 1,
        status: failed ? 'failed' : 'passed',
        startedStamp: runStamp,
        node: process.version,
        steps: opts.steps,
        renderers: opts.renderers,
        workRoot,
        results,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `\nreport: ${reportPath}\n${failed ? 'FAILED' : 'PASSED'}\n`,
  );
  return failed ? 1 : 0;
}

function reexecUnder(node) {
  const child = spawn(node, process.argv.slice(1), { stdio: 'inherit' });
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(name, () => child.kill(name));
  child.on('close', code => process.exit(code ?? 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  let opts;
  try {
    opts = parseReleaseOptions(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage}\n`);
    process.exit(2);
  }
  if (
    opts.node &&
    fs.realpathSync(opts.node) !== fs.realpathSync(process.execPath)
  )
    reexecUnder(path.resolve(opts.node));
  else
    main(opts).then(
      code => {
        process.exitCode = code;
      },
      error => {
        process.stderr.write(`${error.stack ?? error}\n`);
        process.exitCode = 1;
      },
    );
}
