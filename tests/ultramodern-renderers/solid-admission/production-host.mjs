import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { isDirectRun } from '../../../scripts/ultramodern-publish/lib/direct-run.mjs';
import {
  assertNativeCompilerObservationUnchanged,
  assertNativeTypeProgramBindings,
  readNativeCompilerObservation,
} from '../../../scripts/ultramodern-renderers/acceptance/compiler-observation.mjs';
import { executeCommand } from '../../../scripts/ultramodern-renderers/acceptance/run.mjs';

const execute = promisify(execFile);
const toolsPackage = '@bleedingdev/modern-js-ultramodern-app-tools';
const solidPackage = '@bleedingdev/modern-js-renderer-solid';
const lazyKey = 'src/components/Lazy.tsx';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseProductionHostArguments(args) {
  const options = { port: 4195 };
  const keys = new Map([
    ['--consumer-directory', 'consumerDirectory'],
    ['--owner', 'owner'],
    ['--port', 'port'],
    ['--entry-names', 'entryNames'],
  ]);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const key = keys.get(args[index]);
    assert.ok(
      key && args[index + 1],
      `Unknown or incomplete option ${args[index]}`,
    );
    assert.ok(!seen.has(key), `Repeated option ${args[index]}`);
    seen.add(key);
    options[key] =
      key === 'port'
        ? Number(args[index + 1])
        : key === 'entryNames'
          ? args[index + 1].split(',').map(name => name.trim())
          : args[index + 1];
  }
  assert.ok(
    path.isAbsolute(options.consumerDirectory ?? ''),
    'Pass an absolute --consumer-directory',
  );
  assert.ok(options.owner?.trim(), 'Pass the caller registration --owner');
  assert.ok(
    options.entryNames?.length &&
      new Set(options.entryNames).size === options.entryNames.length &&
      options.entryNames.every(name => /^[a-z\d_-]+$/iu.test(name)),
    'Pass the explicit authored --entry-names',
  );
  assert.ok(
    Number.isInteger(options.port) && options.port > 0 && options.port <= 65535,
    'Invalid --port',
  );
  return options;
}

function inside(root, filename) {
  const relative = path.relative(root, filename);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

async function installedPackage(root, resolver, name) {
  const entry = await fs.realpath(resolver.resolve(name));
  assert.ok(inside(root, entry), `${name} escaped the installed consumer`);
  assert.ok(
    !entry.split(path.sep).includes('src'),
    `${name} selected a source export`,
  );
  let directory = path.dirname(entry);
  while (inside(root, directory)) {
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(directory, 'package.json'), 'utf8'),
      );
      if (manifest.name === name) return { entry, directory, manifest };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Cannot locate the installed ${name} package manifest`);
}

/** The caller retains all trees; this command neither registers nor releases them. */
async function requireCallerOwnership(root, owner) {
  const guardian =
    process.env.DISK_GUARDIAN_ARTIFACTS ??
    path.join(os.homedir(), 'bin/disk-guardian-artifacts');
  const { stdout } = await execute(guardian, ['list'], {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const records = JSON.parse(stdout);
  for (const filename of [
    root,
    path.join(root, 'node_modules'),
    path.join(root, 'dist'),
  ]) {
    const actual = await fs.realpath(filename);
    assert.ok(
      inside(root, actual),
      `Caller tree escaped the consumer: ${filename}`,
    );
    const record = records[actual];
    assert.ok(
      record &&
        record.owner === owner &&
        !record.released &&
        Number.isInteger(record.owner_pid),
      `Caller must actively register ${actual} under ${owner} before running the host gate`,
    );
    process.kill(record.owner_pid, 0);
  }
}

export function startProductionHostProcess(
  executable,
  args,
  cwd,
  env,
  signal,
  readStdout,
) {
  signal.throwIfAborted();
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let output = '';
  let requestEventWarnings = 0;
  let spawnError;
  let stopped;
  const closed = new Promise(resolve => {
    child.once('error', error => {
      spawnError = error;
      resolve();
    });
    child.once('close', resolve);
  });
  for (const stream of [child.stdout, child.stderr]) {
    let diagnosticTail = '';
    stream.on('data', bytes => {
      output = `${output}${bytes}`.slice(-8192);
      const diagnostic = diagnosticTail + bytes.toString();
      requestEventWarnings += (
        diagnostic.match(/RequestEvent is missing/gu) ?? []
      ).length;
      diagnosticTail = diagnostic.slice(
        -('RequestEvent is missing'.length - 1),
      );
    });
  }
  if (readStdout) child.stdout.on('data', readStdout);
  const kill = strength => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(strength);
      else process.kill(-child.pid, strength);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const stop = () =>
    (stopped ??= (async () => {
      signal.removeEventListener('abort', interrupted);
      kill('SIGTERM');
      const timer = setTimeout(() => kill('SIGKILL'), 2000);
      try {
        await closed;
      } finally {
        clearTimeout(timer);
        kill('SIGKILL');
      }
    })());
  const interrupted = () => {
    void stop().catch(() => {});
  };
  signal.addEventListener('abort', interrupted, { once: true });
  if (signal.aborted) interrupted();
  return {
    stop,
    async waitForExit() {
      const code = await closed;
      if (spawnError) throw spawnError;
      signal.throwIfAborted();
      return code;
    },
    assertRunning() {
      signal.throwIfAborted();
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, `Native CLI host exited: ${output}`);
    },
    output: () => output,
    requestEventDiagnostics: () => ({ warnings: requestEventWarnings }),
  };
}

async function waitForHost(origin, service, signal) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    service.assertRunning();
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
      });
      if (response.ok) return;
      await response.body?.cancel();
    } catch {
      signal.throwIfAborted();
    }
    await delay(100, undefined, { signal });
  }
  throw new Error(
    `Public native host did not become ready: ${service.output()}`,
  );
}

async function generatedFiles(root, observation, entryNames) {
  const { browser, server } = observation.nativeTypeEntries;
  assert.equal(browser.length, entryNames.length);
  assert.equal(server.length, entryNames.length);
  const entries = [];
  for (const [index, entryName] of entryNames.entries()) {
    const client = browser[index];
    const handler = server[index];
    assert.ok(path.isAbsolute(client) && inside(root, client));
    assert.ok(path.isAbsolute(handler) && inside(root, handler));
    const files = [
      client,
      handler,
      path.join(path.dirname(client), 'application.client.tsx'),
      path.join(path.dirname(handler), 'application.server.tsx'),
      path.join(path.dirname(client), 'routes.client.ts'),
      path.join(path.dirname(handler), 'routes.server.ts'),
      path.join(path.dirname(handler), 'router-view.server.tsx'),
    ];
    for (const file of files) await fs.access(file);
    entries.push({ entryName, files });
  }
  assert.ok(entries.length, 'The public generator emitted no Solid entries');
  return entries;
}

async function readNativeTypePrograms(root) {
  const programs = {};
  for (const name of ['browser', 'server']) {
    const filename = path.join(root, `tsconfig.native-${name}.json`);
    const bytes = await fs.readFile(filename);
    programs[name] = {
      path: filename,
      program: JSON.parse(bytes.toString('utf8')),
      sha256: hash(bytes),
    };
  }
  return programs;
}

async function assertNativeTypeProgramsUnchanged(root, expected) {
  const current = await readNativeTypePrograms(root);
  for (const name of ['browser', 'server'])
    assert.equal(
      current[name].sha256,
      expected[name].sha256,
      `Native ${name} type program changed during qualification`,
    );
  return current;
}

async function strictGeneratedProgram(
  root,
  resolver,
  generated,
  programs,
  env,
  signal,
) {
  signal.throwIfAborted();
  const compiler = resolver.resolve('typescript/bin/tsc');
  const results = {};
  for (const [name, types, roots] of [
    ['browser', [], generated.map(entry => entry.files[0])],
    [
      'server',
      ['node'],
      [
        path.join(root, 'modern.config.ts'),
        ...generated.map(entry => entry.files[1]),
      ],
    ],
  ]) {
    signal.throwIfAborted();
    const project = programs[name].path;
    const config = programs[name].program;
    assert.equal(
      config.compilerOptions?.strict,
      true,
      `${project} must be strict`,
    );
    assert.equal(
      config.compilerOptions?.noEmit,
      true,
      `${project} must not emit`,
    );
    assert.equal(
      config.compilerOptions?.skipLibCheck,
      false,
      `${project} must check declarations`,
    );
    assert.equal(
      config.compilerOptions?.noCheck,
      false,
      `${project} must enable type checking`,
    );
    assert.deepEqual(
      config.compilerOptions?.types,
      types,
      `${project} ambient types changed`,
    );
    assert.deepEqual(
      config.exclude,
      [],
      `${project} must not exclude generated roots`,
    );
    assert.deepEqual(
      config.files?.map(filename => path.resolve(root, filename)).sort(),
      [...roots].sort(),
      `${project} must name the exact generated ${name} roots`,
    );
    const args = [
      compiler,
      '--project',
      project,
      '--skipLibCheck',
      'false',
      '--noCheck',
      'false',
      '--listFiles',
      '--noEmit',
    ];
    let stdout = '';
    let overflow;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    const service = startProductionHostProcess(
      process.execPath,
      args,
      root,
      env,
      deadline,
      bytes => {
        if (overflow) return;
        stdout += bytes;
        if (stdout.length > 16 * 1024 * 1024) {
          overflow = new Error(
            'Strict generated program exceeded its output limit',
          );
          void service.stop().catch(() => {});
        }
      },
    );
    try {
      const code = await service.waitForExit();
      if (overflow) throw overflow;
      assert.equal(code, 0, 'Native generated typecheck failed');
    } catch (error) {
      throw new Error(
        `Strict generated Solid ${name} type program failed.\n${stdout.slice(0, 12_000)}\n${service.output()}`,
        { cause: error },
      );
    } finally {
      await service.stop();
    }
    signal.throwIfAborted();
    const included = new Set(
      stdout
        .split(/\r?\n/u)
        .filter(filename => path.isAbsolute(filename))
        .map(filename => path.normalize(filename)),
    );
    for (const file of roots)
      assert.ok(
        included.has(file),
        `Strict native ${name} type program omitted generated ${file}`,
      );
    assert.ok(
      ![...included].some(filename =>
        /[/\\]@types[/\\](?:react|react-dom)[/\\]/u.test(filename),
      ),
      `Native ${name} type program includes React ambient types`,
    );
    if (name === 'browser')
      assert.ok(
        ![...included].some(filename =>
          /[/\\]@types[/\\]node[/\\]/u.test(filename),
        ),
        'Native browser type program includes Node ambient types',
      );
    results[name] = {
      project,
      programSha256: programs[name].sha256,
      generatedRoots: roots.map(filename => path.relative(root, filename)),
      stdoutSha256: hash(stdout),
    };
  }
  return results;
}

async function compilationManifests(root, generated, resolver, build) {
  const native = await import(
    pathToFileURL(resolver.resolve(`${solidPackage}/manifest`)).href
  );
  const assets = JSON.parse(
    await fs.readFile(path.join(root, 'dist/renderer-assets.json'), 'utf8'),
  );
  const entries = [];
  for (const { entryName } of generated) {
    const identity = build.identities[entryName];
    assert.ok(identity, `No actual build identity for ${entryName}`);
    assert.deepEqual(assets.entries[entryName]?.rendererIdentity, identity);
    assert.ok(
      assets.entries[entryName].assets.some(
        asset => asset.kind === 'script' && asset.scriptType === 'module',
      ),
    );
    const filename = native.solidModuleManifestFilename(entryName);
    const manifest = native.validateSolidModuleManifest(
      JSON.parse(await fs.readFile(path.join(root, 'dist', filename), 'utf8')),
      identity,
    );
    const lazy = native.validateSolidModuleManifest(manifest, identity, [
      lazyKey,
    ]).modules[lazyKey];
    assert.ok(lazy.css?.length, 'Automatic native lazy facade omitted its CSS');
    const facade = await fs.readFile(
      path.join(root, 'dist', lazy.file),
      'utf8',
    );
    assert.match(
      facade,
      /\bexport\s*(?:\{|default\b)/u,
      'Lazy facade is not native ESM',
    );
    assert.match(
      facade,
      /\bimport(?:\s|[{*'"])/u,
      'Lazy facade does not share the application ESM runtime',
    );
    for (const css of lazy.css) await fs.access(path.join(root, 'dist', css));
    assert.throws(() =>
      native.validateSolidModuleManifest(undefined, identity),
    );
    assert.throws(() =>
      native.validateSolidModuleManifest(
        { ...manifest, rendererIdentity: undefined },
        identity,
      ),
    );
    assert.throws(() =>
      native.validateSolidModuleManifest(
        { ...manifest, compilerVersion: 'stale' },
        identity,
      ),
    );
    assert.throws(() =>
      native.validateSolidModuleManifest(
        { ...manifest, rendererIdentity: { ...identity, buildId: 'stale' } },
        identity,
      ),
    );
    assert.throws(() =>
      native.validateSolidModuleManifest(
        { ...manifest, renderer: 'octane' },
        identity,
      ),
    );
    assert.throws(() =>
      native.validateSolidModuleManifest(manifest, identity, [
        'src/missing.tsx',
      ]),
    );
    entries.push({
      identity,
      filename,
      lazy,
      base: manifest.modules._base ?? '/',
    });
  }
  assert.deepEqual(
    Object.keys(assets.entries).sort(),
    generated.map(entry => entry.entryName).sort(),
    'Auxiliary lazy entries leaked into application document assets',
  );
  return entries;
}

async function observations(page) {
  return page.evaluate(() => {
    const resources = globalThis.__ultramodernConformance;
    if (!resources)
      throw new Error('Native lifecycle observations are missing');
    const payload = document.getElementById('__ULTRAMODERN_RENDERER__');
    return {
      resources: structuredClone(resources),
      timeOrigin: performance.timeOrigin,
      bootstrap: payload ? JSON.parse(payload.textContent) : undefined,
    };
  });
}

async function waitForOwners(page, counter) {
  await page.waitForFunction(expected => {
    const value = globalThis.__ultramodernConformance;
    return value?.active.counter === expected && value.active.stable === 1;
  }, counter);
}

async function browserProduction(browser, origin, entries) {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => requests.push(request.url()));
  let release;
  const held = new Promise(resolve => {
    release = resolve;
  });
  await page.route(/\.[cm]?js(?:\?|$)/u, async route => {
    await held;
    await route.continue();
  });
  try {
    const response = await page.goto(origin, { waitUntil: 'commit' });
    assert.equal(response.status(), 200);
    await page.getByTestId('native-lazy').waitFor();
    await page.getByTestId('native-edited-component').waitFor();
    await page.evaluate(() => {
      globalThis.__nativeServerNodes = [
        '[data-testid="native-layout"]',
        '[data-testid="native-edited-component"]',
        '[data-testid="native-edited-component"] button',
        '[data-testid="native-count"]',
        '[data-testid="native-unaffected-component"]',
        '[data-testid="native-unaffected-count"]',
        '[data-testid="native-lazy"]',
        '[data-testid="native-lazy"] button',
        '[data-testid="native-lazy-count"]',
      ].map(selector => {
        const node = document.querySelector(selector);
        if (!node) throw new Error(`Missing server DOM ${selector}`);
        return { selector, node };
      });
    });
    release();
    await waitForOwners(page, 1);
    const identity = (await observations(page)).bootstrap.identity;
    const entry = entries.find(
      candidate => candidate.identity.entryName === identity.entryName,
    );
    assert.ok(entry, 'Document selected an unknown application entry');
    assert.deepEqual(identity, entry.identity);
    assert.equal(
      await page.evaluate(() =>
        globalThis.__nativeServerNodes.every(
          ({ selector, node }) => node === document.querySelector(selector),
        ),
      ),
      true,
      'Hydration replaced server DOM',
    );
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await page
      .getByTestId('native-count')
      .filter({ hasText: /^1$/u })
      .waitFor();
    await page
      .getByRole('button', { name: 'Increment lazy', exact: true })
      .click();
    await page
      .getByTestId('native-lazy-count')
      .filter({ hasText: /^1$/u })
      .waitFor();
    const lazyUrl = new URL(
      `${entry.base.endsWith('/') ? entry.base : `${entry.base}/`}${entry.lazy.file}`,
      origin,
    ).href;
    assert.ok(
      requests.includes(lazyUrl),
      'Native lazy hydration did not issue the compiler manifest URL import',
    );
    assert.equal(
      await page.evaluate(
        async url => typeof (await import(url)).default,
        lazyUrl,
      ),
      'function',
      'Native facade lacks a genuine component default export',
    );
    assert.equal(
      await page
        .getByTestId('native-lazy')
        .evaluate(node => getComputedStyle(node).borderInlineStartWidth),
      '2px',
      'Native lazy CSS did not load',
    );
    assert.deepEqual(errors, []);
    return {
      identity,
      lazyUrl,
      hydrationPreservedServerDOM: true,
      nativeEsmExports: true,
      lazyCss: true,
    };
  } finally {
    release();
    await page.close();
  }
}

async function browserDevelopment(browser, origin, root, restores) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    await page.goto(origin);
    await waitForOwners(page, 1);
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await page
      .getByRole('button', { name: 'Increment stable state', exact: true })
      .click();
    await page
      .getByTestId('native-count')
      .filter({ hasText: /^1$/u })
      .waitFor();
    await page
      .getByTestId('native-unaffected-count')
      .filter({ hasText: /^1$/u })
      .waitFor();
    const before = await observations(page);
    await page.evaluate(() => {
      globalThis.__nativeStableNodes = [
        document.querySelector('[data-testid="native-layout"]'),
        document.querySelector('[data-testid="native-unaffected-component"]'),
      ];
    });
    const file = path.join(root, 'src/components/Counter.tsx');
    const original = await fs.readFile(file, 'utf8');
    assert.equal(
      original.split('Counter before native edit').length,
      2,
      'Canonical Counter HMR marker must occur exactly once',
    );
    const edited = original.replace(
      'Counter before native edit',
      'Counter after native edit',
    );
    restores.push({ file, original, edited });
    await fs.writeFile(file, edited);
    await page
      .getByTestId('native-hmr-marker')
      .filter({ hasText: 'Counter after native edit' })
      .waitFor();
    await waitForOwners(page, 1);
    assert.equal(await page.getByTestId('native-count').textContent(), '0');
    assert.equal(
      await page.getByTestId('native-unaffected-count').textContent(),
      '1',
    );
    const after = await observations(page);
    assert.equal(
      after.timeOrigin,
      before.timeOrigin,
      'HMR reloaded the document',
    );
    assert.deepEqual(after.resources.active, { counter: 1, stable: 1 });
    assert.equal(
      after.resources.cleanup.counter,
      before.resources.cleanup.counter + 1,
      'Edited boundary cleanup was not exactly once',
    );
    assert.equal(
      after.resources.cleanup.stable,
      before.resources.cleanup.stable,
      'HMR disposed the unaffected component',
    );
    const assertStable = async () => {
      assert.equal((await observations(page)).timeOrigin, before.timeOrigin);
      assert.equal(
        await page.getByTestId('native-unaffected-count').textContent(),
        '1',
      );
      assert.equal(
        await page.evaluate(
          () =>
            globalThis.__nativeStableNodes[0] ===
              document.querySelector('[data-testid="native-layout"]') &&
            globalThis.__nativeStableNodes[1] ===
              document.querySelector(
                '[data-testid="native-unaffected-component"]',
              ),
        ),
        true,
        'Native navigation replaced its layout or stable owner',
      );
    };
    const about = page
      .getByRole('navigation', { name: 'Fixture navigation' })
      .getByRole('link', { name: 'About', exact: true });
    assert.equal(await about.evaluate(node => node.tagName), 'A');
    await about.click();
    await page.getByTestId('native-about').waitFor();
    await waitForOwners(page, 0);
    assert.equal(new URL(page.url()).pathname, '/about');
    assert.equal(
      (await observations(page)).resources.cleanup.counter,
      before.resources.cleanup.counter + 2,
    );
    await assertStable();
    await page.goBack();
    await page.getByTestId('native-route').waitFor();
    await waitForOwners(page, 1);
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(
      (await observations(page)).resources.cleanup.counter,
      before.resources.cleanup.counter + 2,
    );
    await assertStable();
    await page.goForward();
    await page.getByTestId('native-about').waitFor();
    await waitForOwners(page, 0);
    assert.equal(new URL(page.url()).pathname, '/about');
    assert.equal(
      (await observations(page)).resources.cleanup.counter,
      before.resources.cleanup.counter + 3,
    );
    await assertStable();
    assert.equal(
      (await observations(page)).resources.cleanup.stable,
      before.resources.cleanup.stable,
    );
    assert.deepEqual(errors, []);
    return {
      hmr: {
        editedReset: true,
        unaffectedPreserved: true,
        cleanupExactlyOnce: true,
      },
      navigation: {
        nativeLink: true,
        documentPreserved: true,
        historyBackAndForward: true,
      },
    };
  } finally {
    await page.close();
  }
}

/** Runs only against caller-owned, already installed, mapped release packages. */
export async function runProductionHost(options) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(
    major > 26 || (major === 26 && minor >= 10),
    'Public host requires Node >=26.10.0',
  );
  assert.ok(
    !/modern:source/u.test(
      `${process.env.NODE_OPTIONS ?? ''} ${process.execArgv.join(' ')}`,
    ),
    'Packed public proof cannot select modern:source',
  );
  const root = await fs.realpath(options.consumerDirectory);
  await requireCallerOwnership(root, options.owner);
  const resolver = createRequire(path.join(root, 'package.json'));
  const tools = await installedPackage(root, resolver, toolsPackage);
  const runtime = await installedPackage(root, resolver, solidPackage);
  const cli = path.join(tools.directory, tools.manifest.bin.ultramodern);
  await fs.access(cli);
  const origin = `http://127.0.0.1:${options.port}`;
  try {
    const existing = await fetch(origin, { signal: AbortSignal.timeout(500) });
    await existing.body?.cancel();
    assert.fail(`Host port ${options.port} is already in use`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
  }
  const controller = new AbortController();
  const services = [];
  const restores = [];
  let browser;
  let failure;
  let failed = false;
  let result;
  const interrupted = signal => {
    controller.abort(new Error(`Public host interrupted by ${signal}`));
    void browser?.close().catch(error => {
      failure ??= error;
      failed = true;
    });
  };
  const onInterrupt = () => interrupted('SIGINT');
  const onTerminate = () => interrupted('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  const environment = mode => ({
    ...process.env,
    NODE_ENV: mode,
    PORT: String(options.port),
  });
  const command = async (args, mode) => {
    controller.signal.throwIfAborted();
    const result = await executeCommand(
      { command: process.execPath, args: [cli, ...args] },
      root,
      {
        timeoutMs: 300_000,
        env: environment(mode),
      },
    );
    controller.signal.throwIfAborted();
    return result;
  };
  try {
    const programsBeforeBuild = await readNativeTypePrograms(root);
    const observationFile = path.join(
      root,
      'dist/native-compiler-observation.json',
    );
    const previousObservation = await fs
      .stat(observationFile, { bigint: true })
      .catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
    const buildCommand = await command(['build'], 'production');
    const currentObservation = await fs.stat(observationFile, {
      bigint: true,
    });
    assert.ok(
      !previousObservation ||
        currentObservation.dev !== previousObservation.dev ||
        currentObservation.ino !== previousObservation.ino,
      'Actual build did not publish a fresh native compiler observation',
    );
    const programs = await assertNativeTypeProgramsUnchanged(
      root,
      programsBeforeBuild,
    );
    const publicTools = resolver(toolsPackage);
    const build = publicTools.validateRendererBuildManifest(
      JSON.parse(
        await fs.readFile(path.join(root, 'dist/renderer-build.json'), 'utf8'),
      ),
      publicTools.resolveRendererProfile('solid'),
    );
    assert.deepEqual(
      Object.keys(build.identities).sort(),
      [...options.entryNames].sort(),
      'Actual committed entry identities differ from the authored corpus',
    );
    const observation = await readNativeCompilerObservation({
      applicationRoot: root,
      distDirectory: path.join(root, 'dist'),
      renderer: 'solid',
      expectedEntryNames: options.entryNames,
      expectedRsbuildVersion: '2.2.9',
    });
    const configured = observation.observation.configuredPlugins;
    assert.equal(
      configured.names.filter(name => name === 'ultramodern:solid:compiler')
        .length,
      1,
      'Actual build did not configure exactly one production Solid compiler',
    );
    assert.ok(
      !configured.names.some(name =>
        /(?:plugin-react|react-refresh|solid-admission-compiler)/u.test(name),
      ),
      'Actual build configured an unrelated compiler',
    );
    const generated = await generatedFiles(
      root,
      observation,
      options.entryNames,
    );
    await assertNativeTypeProgramBindings(observation, programs);
    const typeProgram = await strictGeneratedProgram(
      root,
      resolver,
      generated,
      programs,
      environment('production'),
      controller.signal,
    );
    await assertNativeTypeProgramBindings(
      observation,
      await assertNativeTypeProgramsUnchanged(root, programs),
    );
    await assertNativeCompilerObservationUnchanged(observation);
    const entries = await compilationManifests(
      root,
      generated,
      resolver,
      build,
    );
    controller.signal.throwIfAborted();
    const { chromium } = resolver('playwright');
    browser = await chromium.launch({ headless: true });
    controller.signal.throwIfAborted();
    const production = startProductionHostProcess(
      process.execPath,
      [cli, 'serve'],
      root,
      environment('production'),
      controller.signal,
    );
    services.push(production);
    await waitForHost(origin, production, controller.signal);
    const productionProof = await browserProduction(browser, origin, entries);
    await production.stop();
    assert.equal(
      production.requestEventDiagnostics().warnings,
      0,
      `Actual generated production Node handler emitted native request-scope warnings.\n${production.output()}`,
    );
    const development = startProductionHostProcess(
      process.execPath,
      [cli, 'dev'],
      root,
      environment('development'),
      controller.signal,
    );
    services.push(development);
    await waitForHost(origin, development, controller.signal);
    const developmentProof = await browserDevelopment(
      browser,
      origin,
      root,
      restores,
    );
    await development.stop();
    assert.equal(
      development.requestEventDiagnostics().warnings,
      0,
      `Actual generated development Node handler emitted native request-scope warnings.\n${development.output()}`,
    );
    result = {
      status: 'passed',
      packedPublicProof: true,
      productionCompiler: 'ultramodern:solid:compiler',
      packages: {
        [toolsPackage]: tools.manifest.version,
        [solidPackage]: runtime.manifest.version,
      },
      typeProgram,
      buildCommand,
      compilerObservation: {
        receiptPath: observation.receiptPath,
        receiptSha256: observation.receiptSha256,
        freshPublication: true,
        device: String(currentObservation.dev),
        inode: String(currentObservation.ino),
        configuredPlugins: configured,
        environments: observation.observation.environments.map(environment => ({
          name: environment.name,
          target: environment.target,
          mode: environment.mode,
          compiledEntryNames: environment.compiledEntryNames,
          compilationHash: environment.compilationHash,
        })),
      },
      entries,
      production: productionProof,
      development: developmentProof,
      nativeRequestScope: {
        production: production.requestEventDiagnostics(),
        development: development.requestEventDiagnostics(),
      },
    };
  } catch (error) {
    failure = error;
    failed = true;
  } finally {
    const cleanup = await Promise.allSettled([
      ...services.reverse().map(service => service.stop()),
      browser?.close(),
    ]);
    for (const restore of restores.reverse()) {
      try {
        const current = await fs.readFile(restore.file, 'utf8');
        if (current === restore.edited)
          await fs.writeFile(restore.file, restore.original);
        else
          assert.equal(
            current,
            restore.original,
            `Preserving concurrent changes to ${restore.file}; the HMR edit could not be restored automatically`,
          );
      } catch (error) {
        cleanup.push({ status: 'rejected', reason: error });
      }
    }
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    const errors = cleanup
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);
    if (errors.length) {
      failure = new AggregateError(
        [...(failed ? [failure] : []), ...errors],
        'Public host cleanup failed; caller-owned trees were retained',
      );
      failed = true;
    }
  }
  if (failed) throw failure;
  controller.signal.throwIfAborted();
  return result;
}

if (isDirectRun(import.meta.url)) {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'Usage: node production-host.mjs --consumer-directory <installed-packed-solid-corpus> --owner <active-disk-guardian-owner> [--port 4195]\nCaller owns registered consumer, node_modules and dist; the harness retains all trees.\n',
    );
  } else {
    runProductionHost(parseProductionHostArguments(process.argv.slice(2)))
      .then(result =>
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
      )
      .catch(error => {
        process.stderr.write(`${error.stack ?? error}\n`);
        process.exitCode = 1;
      });
  }
}
