#!/usr/bin/env node
// Packed-release acceptance: the renderer fixture apps, rebuilt from a packed
// cohort the way a user gets them, must pass the same behavior specs as the
// workspace apps.
//
//   /Users/satan/bin/owned-temp-dir --run renderer-release -- \
//     node scripts/ultramodern-renderers/release.mjs \
//       (--version <x.y.z-ultramodern.N> | --cohort-dir <dir>) \
//       [--renderers react,solid,octane] [--with worker,rsc,mf]
//       [--tractor-source <tractor demo checkout>]
//
// For each renderer: generate a workspace with the packed create CLI,
// (Solid, Octane) build and serve its untouched starter, put the
// tests/integration/renderer-<r> app into its shell, install from a local
// registry under the strict release-age policy, recapture the shell's delivery
// unit from the fixture config (sync-delivery-unit), check the installed cohort is
// the packed bytes, typecheck, and run the specs (for Solid and Octane they
// include the no-React bundle check).
// Then the React runners in scripts/ultramodern-production-readiness: worker
// custom entries and RSC on workerd, Module Federation lifecycle, and (with
// --tractor-source, a Tractor repository containing the pinned
// scripts/ultramodern-publish/tractor-baseline-revision) the Tractor
// downstream adoption of that exact baseline.
// Prints a PASS/FAIL/SKIP table and exits 1 on any failure.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { releaseAgeExemptions } from '../ultramodern-production-readiness/published-create-proof/release-age-audit.mjs';
import { runWorkerDispatchProbe } from '../ultramodern-production-readiness/renderer-worker-lifecycle-proof/probe.mjs';
import { readReleaseManifest } from '../ultramodern-publish/lib/source-create-proof/release-manifest.mjs';
import { startEphemeralRegistry } from '../ultramodern-publish/lib/source-create-proof/runtime-proof/registry.mjs';
import { defaultReleaseAgePolicyPath } from '../ultramodern-publish/run-release-acceptance.mjs';
import { checkInstalledCohort, readCohort } from './installed-cohort.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const allRenderers = ['react', 'solid', 'octane'];
const allRunners = ['worker', 'rsc', 'mf'];

const { values: opts } = parseArgs({
  options: {
    version: { type: 'string' },
    'cohort-dir': { type: 'string' },
    renderers: { type: 'string', default: allRenderers.join(',') },
    with: { type: 'string', default: allRunners.join(',') },
    'tractor-source': { type: 'string' },
    'browser-executable': { type: 'string' },
    'work-dir': { type: 'string' },
  },
});
const renderers = opts.renderers.split(',').map(name => name.trim());
for (const renderer of renderers)
  if (!allRenderers.includes(renderer))
    throw new Error(`Unknown renderer ${renderer}`);
const runners = opts.with
  .split(',')
  .map(name => name.trim())
  .filter(Boolean);
for (const runner of runners)
  if (!allRunners.includes(runner)) throw new Error(`Unknown runner ${runner}`);
if (!opts.version === !opts['cohort-dir'])
  throw new Error('Pass exactly one of --version or --cohort-dir');

const workDir = fs.realpathSync(
  opts['work-dir'] ??
    process.env.OWNED_TEMP_DIR ??
    fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-release-')),
);
// Children must not inherit a NODE_PATH from another checkout, and need a
// canonical TMPDIR (/var/folders is a symlink).
delete process.env.NODE_PATH;
process.env.TMPDIR = `${workDir}/`;
const logs = path.join(workDir, 'logs');
fs.mkdirSync(logs, { recursive: true });

const children = new Set();
let registry;
async function stopAll() {
  for (const child of children) child.kill('SIGTERM');
  await registry?.stop();
}
/** Runs a command, logging to logs/<log>.log; rejects with the log tail. */
function sh(command, args, { cwd = root, env = process.env, log }) {
  const file = path.join(logs, `${log}.log`);
  return new Promise((resolve, reject) => {
    const out = fs.openSync(file, 'w');
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', out, out],
    });
    fs.closeSync(out);
    children.add(child);
    child.once('error', reject);
    child.once('close', code => {
      children.delete(child);
      if (code === 0) return resolve();
      const tail = fs.readFileSync(file, 'utf8').trim().split('\n');
      reject(
        new Error(
          `${path.basename(command)} ${args.join(' ')} exited ${code} (${file})\n${tail.slice(-25).join('\n')}`,
        ),
      );
    });
  });
}

const results = [];
/** Runs one table row. Returns false (and runs nothing) once `when` fails. */
async function step(name, body, when = true) {
  if (!when) {
    results.push({ name, status: 'SKIP', seconds: 0, error: '' });
    return false;
  }
  const started = performance.now();
  process.stdout.write(`[release] ${name} ...\n`);
  try {
    await body();
    results.push({ name, status: 'PASS', seconds: 0, error: '' });
    return true;
  } catch (error) {
    const message = String(error?.message ?? error);
    results.push({ name, status: 'FAIL', error: message.split('\n')[0] });
    process.stdout.write(`[release] ${name} FAIL\n${message}\n`);
    return false;
  } finally {
    results.at(-1).seconds = (performance.now() - started) / 1000;
  }
}

function table() {
  const rows = results.map(r => [
    r.name,
    r.status,
    r.seconds.toFixed(0),
    r.error.slice(0, 120),
  ]);
  const widths = [0, 1, 2].map(i =>
    Math.max(...rows.map(row => row[i].length)),
  );
  return rows
    .map(row =>
      row
        .map((cell, i) => (i < 3 ? cell.padEnd(widths[i]) : cell))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) =>
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/**
 * Moves the fixture app into the generated shell: its src/, config and
 * tsconfig replace the starter ones. Each dependency keeps the specifier the
 * generator wrote; framework packages it did not write get the cohort alias.
 */
function overlayFixture(appRoot, renderer, release) {
  const fixture = path.join(root, 'tests/integration', `renderer-${renderer}`);
  fs.rmSync(path.join(appRoot, 'src'), { recursive: true, force: true });
  fs.cpSync(path.join(fixture, 'src'), path.join(appRoot, 'src'), {
    recursive: true,
  });
  for (const file of ['modern.config.ts', 'tsconfig.json'])
    fs.copyFileSync(path.join(fixture, file), path.join(appRoot, file));

  const generated = readJson(path.join(appRoot, 'package.json'));
  const written = { ...generated.dependencies, ...generated.devDependencies };
  const cohort = new Map(
    release.packages.map(item => [
      item.sourceName,
      `npm:${item.targetName}@${item.version}`,
    ]),
  );
  const resolve = deps =>
    Object.fromEntries(
      Object.entries(deps ?? {}).map(([name, spec]) => {
        if (written[name]) return [name, written[name]];
        if (spec.startsWith('workspace:')) {
          if (!cohort.has(name))
            throw new Error(`${name} is not in the cohort`);
          return [name, cohort.get(name)];
        }
        return [name, spec];
      }),
    );
  const app = readJson(path.join(fixture, 'package.json'));
  writeJson(path.join(appRoot, 'package.json'), {
    ...generated,
    dependencies: resolve(app.dependencies),
    devDependencies: {
      ...resolve(app.devDependencies),
      typescript: written.typescript,
    },
  });
}

/** Resolves the installed ultramodern bin of the app (an npm: alias). */
function installedBin(appRoot) {
  const packageRoot = fs.realpathSync(
    path.join(appRoot, 'node_modules/@modern-js/ultramodern-app-tools'),
  );
  const { bin } = readJson(path.join(packageRoot, 'package.json'));
  return path.join(packageRoot, bin.ultramodern);
}

/** Resolves the create CLI the generated workspace installed (an npm: alias). */
function installedCreateBin(workspace) {
  const packageRoot = fs.realpathSync(
    path.join(workspace, 'node_modules/@modern-js/ultramodern-create'),
  );
  const { bin } = readJson(path.join(packageRoot, 'package.json'));
  return path.join(packageRoot, bin['ultramodern-create']);
}

/** A free local port. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Builds and serves the generated app before the fixture replaces it: the
 * untouched starter must build, and its server must answer / with the
 * renderer's own markup.
 */
async function checkStarter(appRoot, renderer, env) {
  const bin = installedBin(appRoot);
  await sh(process.execPath, [bin, 'build'], {
    cwd: appRoot,
    env: { ...env, NODE_ENV: 'production' },
    log: `${renderer}-starter-build`,
  });
  const port = await freePort();
  const out = fs.openSync(
    path.join(logs, `${renderer}-starter-serve.log`),
    'w',
  );
  const server = spawn(process.execPath, [bin, 'serve'], {
    cwd: appRoot,
    env: { ...env, NODE_ENV: 'production', PORT: String(port) },
    stdio: ['ignore', out, out],
  });
  fs.closeSync(out);
  children.add(server);
  try {
    const deadline = Date.now() + 60_000;
    let response;
    while (!response) {
      if (server.exitCode !== null)
        throw new Error(`serve exited ${server.exitCode}`);
      response = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { accept: 'text/html' },
      }).catch(() => undefined);
      if (!response) {
        if (Date.now() > deadline) throw new Error('serve did not start');
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    const html = await response.text();
    if (response.status !== 200)
      throw new Error(`GET / answered ${response.status}`);
    for (const marker of [
      `data-renderer="${renderer}"`,
      'data-testid="native-route"',
    ])
      if (!html.includes(marker)) throw new Error(`GET / lacks ${marker}`);
  } finally {
    server.kill('SIGTERM');
    children.delete(server);
  }
}

/** Chrome for the runners: --browser-executable, then puppeteer's own. */
function browserExecutable() {
  if (opts['browser-executable'])
    return path.resolve(opts['browser-executable']);
  if (process.env.PUPPETEER_EXECUTABLE_PATH)
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  // The same Playwright Chromium the shared renderer specs launch.
  const executable = createRequire(path.join(root, 'tests/package.json'))(
    'playwright',
  ).chromium.executablePath();
  if (!fs.existsSync(executable))
    throw new Error(
      `Playwright Chromium is not installed at ${executable}; run \`pnpm --dir tests exec playwright install chromium\``,
    );
  return executable;
}

/** A directory that resolves the workspace's playwright-core (MF runner). */
function playwrightRoot() {
  const store = path.join(root, 'node_modules/.pnpm');
  const entry = fs
    .readdirSync(store)
    .find(name => name.startsWith('playwright-core@'));
  if (!entry) throw new Error('playwright-core is not installed');
  return path.join(store, entry);
}

async function main() {
  let cohortDir = opts['cohort-dir'] && path.resolve(opts['cohort-dir']);
  // The publish preparer only writes under .modern/bleedingdev-publish; a
  // cohort this run builds is removed again when the run ends.
  let ownedCohortRoot;
  let release;
  let cohort;
  let storeDir;
  let createRoot;
  const apps = {};
  const env = { ...process.env };
  try {
    await step('cohort', async () => {
      if (!cohortDir) {
        ownedCohortRoot = path.join(
          root,
          '.modern/bleedingdev-publish/build',
          `renderer-release-${opts.version}`,
        );
        fs.rmSync(ownedCohortRoot, { recursive: true, force: true });
        cohortDir = path.join(ownedCohortRoot, 'build');
        await sh('pnpm', ['ultramodern:build-bleedingdev-publish'], {
          log: 'cohort-build',
        });
        await sh(
          'pnpm',
          [
            'ultramodern:prepare-bleedingdev-publish',
            '--',
            '--version',
            opts.version,
            '--scope',
            'bleedingdev',
            '--prefix',
            'modern-js-',
            '--tag',
            'latest',
            '--include-sidecars',
            '--out',
            cohortDir,
          ],
          { log: 'cohort-prepare' },
        );
      }
      release = readReleaseManifest({
        manifestPath: path.join(cohortDir, 'manifest.json'),
      });
      cohort = readCohort(release.manifestPath);
    });

    let createBin;
    await step(
      'registry + create install',
      async () => {
        storeDir = execFileSync('pnpm', ['store', 'path'], {
          cwd: workDir,
          encoding: 'utf8',
        }).trim();
        registry = await startEphemeralRegistry({
          release,
          releaseDir: cohortDir,
          rootDir: path.join(workDir, 'registry'),
          storeDir,
        });
        // Strict release-age policy; only our own cohort is exempt.
        Object.assign(env, registry.env, {
          npm_config_store_dir: storeDir,
          pnpm_config_minimum_release_age: '1440',
          pnpm_config_minimum_release_age_strict: 'true',
          pnpm_config_minimum_release_age_ignore_missing_time: 'false',
          pnpm_config_minimum_release_age_exclude: JSON.stringify(
            releaseAgeExemptions(release, {
              policyPath: defaultReleaseAgePolicyPath,
            }),
          ),
        });
        createRoot = path.join(workDir, 'create');
        fs.mkdirSync(createRoot);
        const { targetName, version } = release.createPackage;
        writeJson(path.join(createRoot, 'package.json'), {
          private: true,
          dependencies: { [targetName]: version },
        });
        const { allowBuilds } = parseYaml(
          fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'),
        );
        fs.writeFileSync(
          path.join(createRoot, 'pnpm-workspace.yaml'),
          stringifyYaml({ packages: ['.'], allowBuilds }),
        );
        await sh('pnpm', ['install'], {
          cwd: createRoot,
          env,
          log: 'create-install',
        });
        const packageRoot = path.join(createRoot, 'node_modules', targetName);
        createBin = path.join(
          packageRoot,
          readJson(path.join(packageRoot, 'package.json')).bin[
            'ultramodern-create'
          ],
        );
      },
      Boolean(release),
    );

    for (const renderer of renderers) {
      const workspace = path.join(workDir, `app-${renderer}`);
      let appRoot;
      let ready = await step(
        `${renderer} generate`,
        async () => {
          await sh(
            process.execPath,
            [createBin, workspace, '--renderer', renderer, '--no-agents-md'],
            { cwd: workDir, env, log: `${renderer}-generate` },
          );
          const topology = readJson(
            path.join(workspace, 'topology/reference-topology.json'),
          );
          appRoot = path.join(workspace, topology.shell.path);
        },
        Boolean(createBin),
      );
      if (renderer !== 'react')
        ready = await step(
          `${renderer} starter`,
          async () => {
            await sh('pnpm', ['install'], {
              cwd: workspace,
              env,
              log: `${renderer}-starter-install`,
            });
            await checkStarter(appRoot, renderer, env);
          },
          ready,
        );
      ready = await step(
        `${renderer} overlay`,
        async () => overlayFixture(appRoot, renderer, release),
        ready,
      );
      ready = await step(
        `${renderer} install`,
        () =>
          sh('pnpm', ['install'], {
            cwd: workspace,
            env,
            log: `${renderer}-install`,
          }),
        ready,
      );
      // The fixture config replaces the one the generator captured the shell's
      // entries from (the starter names its main entry `main`, the fixture
      // keeps the default `index`). A user who edits modern.config that way
      // recaptures the delivery unit with the installed create CLI; so do we.
      ready = await step(
        `${renderer} sync delivery unit`,
        () =>
          sh(
            process.execPath,
            [
              installedCreateBin(workspace),
              'ultramodern',
              'sync-delivery-unit',
            ],
            { cwd: workspace, env, log: `${renderer}-sync` },
          ),
        ready,
      );
      ready = await step(
        `${renderer} installed = packed`,
        async () => {
          checkInstalledCohort({ appRoot, cohort });
        },
        ready,
      );
      if (ready) apps[renderer] = { workspace, appRoot };
      await step(
        `${renderer} typecheck`,
        () =>
          sh(
            process.execPath,
            ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
            {
              cwd: appRoot,
              env,
              log: `${renderer}-typecheck`,
            },
          ),
        ready,
      );
      // The specs build and serve the app with its installed bin.
      await step(
        `${renderer} specs`,
        () =>
          sh(
            process.execPath,
            [
              'node_modules/@rstest/core/bin/rstest.js',
              'run',
              '-c',
              'tests/rstest.config.mts',
              `integration/renderer-${renderer}/`,
            ],
            {
              env: {
                ...process.env,
                RENDERER_TARGET_DIR: appRoot,
                RENDERER_TARGET_BIN: installedBin(appRoot),
              },
              log: `${renderer}-specs`,
            },
          ),
        ready,
      );
    }

    // The React runners need a browser, the shared store and the release.
    const owner = `renderer-release-${process.pid}`;
    const proof = (name, script, extraArgs = () => []) =>
      step(
        name,
        async () => {
          const dir = path.join(workDir, name);
          await sh(
            process.execPath,
            [
              path.join(
                root,
                'scripts/ultramodern-production-readiness',
                script,
              ),
              '--manifest',
              release.manifestPath,
              '--expected-source-revision',
              release.source.commit,
              '--expected-version',
              release.release.version,
              '--store-dir',
              storeDir,
              '--work-dir',
              dir,
              '--receipt',
              path.join(dir, 'receipt.json'),
              '--browser-executable',
              browserExecutable(),
              '--owner',
              owner,
              '--owner-pid',
              String(process.pid),
              ...extraArgs(),
            ],
            { env, log: name },
          );
        },
        Boolean(storeDir) && runners.includes(name),
      );
    await step(
      'worker',
      async () => {
        const dir = path.join(workDir, 'worker');
        fs.mkdirSync(dir);
        const receipt = await runWorkerDispatchProbe({
          workDir: dir,
          receiptPath: path.join(dir, 'receipt.json'),
          binding: {
            sourceRevision: cohort.sourceRevision,
            releaseVersion: cohort.release.version,
            manifestSha256: cohort.manifestSha256,
            frameworkCohortDigest: cohort.cohortDigest,
          },
          artifacts: {
            manifestPath: cohort.manifestPath,
            sourceRevision: cohort.sourceRevision,
            manifestSha256: cohort.manifestSha256,
            cohortDigest: cohort.cohortDigest,
          },
          qualifiedNode: process.execPath,
          applicationRoot: apps.react.appRoot,
          consumerRoot: apps.react.workspace,
          generatorPackageRoot: path.join(
            createRoot,
            'node_modules',
            release.createPackage.targetName,
          ),
          generatorConsumerRoot: createRoot,
          owner,
          ownerPid: process.pid,
          env,
        });
        if (receipt.status !== 'passed')
          throw new Error(receipt.error?.message ?? 'worker probe failed');
      },
      Boolean(apps.react) && runners.includes('worker'),
    );
    await proof('rsc', 'react-rsc-worker-proof/main.mjs');
    await proof('mf', 'renderer-mf-lifecycle-proof/index.mjs', () => [
      '--qualified-node',
      process.execPath,
      '--pnpm-executable',
      execFileSync('which', ['pnpm'], { encoding: 'utf8' }).trim(),
      '--browser-dependency-root',
      playwrightRoot(),
    ]);
    await step(
      'tractor',
      async () => {
        // Accept the pinned Tractor baseline the CI lane checks out, not
        // whatever the source checkout happens to have at HEAD.
        const source = path.resolve(opts['tractor-source']);
        const revision = fs
          .readFileSync(
            path.join(
              root,
              'scripts/ultramodern-publish/tractor-baseline-revision',
            ),
            'utf8',
          )
          .trim();
        if (!/^[0-9a-f]{40}$/u.test(revision))
          throw new Error(`Invalid Tractor baseline revision: ${revision}`);
        const clone = path.join(workDir, 'tractor');
        const git = (...args) =>
          execFileSync('git', args, { stdio: ['ignore', 'ignore', 'inherit'] });
        git('clone', '--quiet', '--no-checkout', source, clone);
        git('-C', clone, 'fetch', '--quiet', '--no-tags', source, revision);
        git('-C', clone, 'checkout', '--quiet', '--detach', revision);
        await sh(
          process.execPath,
          [
            path.join(
              root,
              'scripts/ultramodern-production-readiness/run-tractor-downstream-acceptance.mjs',
            ),
            '--mode',
            'source',
            '--manifest',
            release.manifestPath,
            '--workspace',
            clone,
            '--out',
            path.join(workDir, 'tractor-report.json'),
          ],
          { env, log: 'tractor' },
        );
      },
      Boolean(release && opts['tractor-source']),
    );
  } finally {
    await stopAll();
    if (ownedCohortRoot)
      fs.rmSync(ownedCohortRoot, { recursive: true, force: true });
  }
  const failed = results.some(r => r.status === 'FAIL');
  process.stdout.write(
    `\n${table()}\n\nlogs: ${logs}\n${failed ? 'FAILED' : 'PASSED'}\n`,
  );
  return failed ? 1 : 0;
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.once(signal, () => stopAll().finally(() => process.exit(130)));

process.exitCode = await main();
