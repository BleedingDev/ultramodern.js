#!/usr/bin/env node
// Run through owned-temp-dir. This proof edits only its disposable remote app.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inspectOwnedProcessGroup } from '../../../scripts/ultramodern-production-readiness/react-rsc-worker-proof/runtime.mjs';
import {
  createOctaneFederationFixtures,
  decodeOctaneSSRDocument,
  linkOctaneFederationDependencies,
} from './fixtures.mjs';
import { createSSRMarkerProxy } from './marker-proxy.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const temporary = process.env.OWNED_TEMP_DIR;
assert.ok(temporary, 'Run through owned-temp-dir so the apps have an owner.');
const owner = `octane-mf-dev-${process.pid}`;
const cancellation = new AbortController();
const children = [];
const artifacts = new Set();
const results = {};
let browserOpened = false;
let proxy;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.once(signal, () =>
    cancellation.abort(new Error(`Received ${signal}`)),
  );

async function registerArtifact(directory, kind) {
  await fs.mkdir(directory, { recursive: true });
  await execute('/Users/satan/bin/disk-guardian-artifacts', [
    'register',
    directory,
    '--owner',
    owner,
    '--owner-pid',
    String(process.pid),
    '--kind',
    kind,
    '--grace-hours',
    '24',
  ]);
  artifacts.add(directory);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function writeApp(directory, files) {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(directory, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  await linkOctaneFederationDependencies({ root, directory, registerArtifact });
}

async function startDev(directory, port) {
  await registerArtifact(path.join(directory, 'dist'), 'build');
  const child = spawn(
    process.execPath,
    [
      path.join(
        root,
        'packages/solutions/ultramodern-app-tools/bin/ultramodern.mjs',
      ),
      'dev',
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        NODE_PATH: '',
        NODE_ENV: 'development',
        PORT: String(port),
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.log = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', chunk => {
      child.log = (child.log + chunk).slice(-128 * 1024);
    });
  child.completion = new Promise(resolve => {
    child.once('error', error => {
      child.failure = error;
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  children.push(child);
  return child;
}

async function groupAlive(child) {
  if (!child.pid) return false;
  if (process.platform === 'win32')
    return child.exitCode === null && child.signalCode === null;
  const group = inspectOwnedProcessGroup(child.pid);
  if (
    (child.exitCode !== null || child.signalCode !== null) &&
    group.members.some(member => member.pid === child.pid && member.live)
  )
    throw new Error('The proof process group identity was reused.');
  return group.liveMemberCount > 0;
}

async function stopChild(child) {
  if (child.retirement) return child.retirement;
  child.retirement = (async () => {
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      if (!(await groupAlive(child))) break;
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      const deadline = Date.now() + 5000;
      while (await groupAlive(child)) {
        if (Date.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    assert.equal(
      await groupAlive(child),
      false,
      'the dev process group retired',
    );
    await child.completion;
  })();
  return child.retirement;
}

async function waitFor(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    cancellation.signal.throwIfAborted();
    for (const child of children)
      if (child.failure || child.exitCode !== null || child.signalCode !== null)
        throw child.failure ?? new Error(`Dev server exited: ${child.log}`);
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for ${label}${last ? `: ${last.message}` : ''}`,
  );
}

const request = (url, timeout = 2000) =>
  fetch(url, {
    signal: AbortSignal.any([
      cancellation.signal,
      AbortSignal.timeout(timeout),
    ]),
  });

// Delay only the initial native entries until the completed streamed SSR node
// can be observed. Redirects preserve their native module URLs and HMR runtime.
// This measures exact node reuse after completion; native stream probes cover
// bootstrap overlap with segments that are still arriving.
async function markingProxy(target, port, allowedEntrySources) {
  const sockets = new Set();
  const server = createSSRMarkerProxy({
    target,
    signal: cancellation.signal,
    absoluteEntries: 'redirect',
    allowedEntrySources,
  });
  const track = socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  server.on('connection', track);
  server.on('upgrade', (incoming, socket, head) => {
    const url = new URL(target);
    const upstream = track(net.connect(Number(url.port), url.hostname));
    upstream.once('connect', () => {
      upstream.write(
        `${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n${incoming.rawHeaders.reduce((text, value, index) => text + (index % 2 ? `${value}\r\n` : `${value}: `), '')}\r\n`,
      );
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.once('error', () => socket.destroy());
    socket.once('error', () => upstream.destroy());
    socket.once('close', () => upstream.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  };
  close.proof = server.proof;
  return close;
}

async function browser(...args) {
  if (args[0] === 'open') browserOpened = true;
  const { stdout } = await execute('agent-browser', args, {
    env: {
      ...process.env,
      AGENT_BROWSER_SESSION: owner,
      AGENT_BROWSER_HEADED: 'false',
    },
    maxBuffer: 8 * 1024 * 1024,
    timeout: 180_000,
    signal: cancellation.signal,
  });
  return stdout.trim();
}
const evaluate = async source =>
  JSON.parse(JSON.parse(await browser('eval', `JSON.stringify(${source})`)));
const text = testId => browser('get', 'text', `[data-testid="${testId}"]`);
const click = testId => browser('click', `[data-testid="${testId}"]`);

let failure;
try {
  const remotePort = await freePort();
  const hostPort = await freePort();
  const proxyPort = await freePort();
  const remoteUrl = `http://127.0.0.1:${remotePort}`;
  const hostUrl = `http://127.0.0.1:${hostPort}`;
  const fixtures = createOctaneFederationFixtures({
    remoteUrl,
    failures: false,
    development: true,
  });
  const remoteDirectory = path.join(temporary, 'remote');
  const hostDirectory = path.join(temporary, 'host');
  await writeApp(remoteDirectory, fixtures.remote);
  await writeApp(hostDirectory, fixtures.host);
  await startDev(remoteDirectory, remotePort);
  const manifest = await waitFor(
    async () => {
      const response = await request(`${remoteUrl}/mf-manifest.json`);
      return response.ok && response.json();
    },
    'the remote dev manifest',
    120_000,
  );
  assert.equal(
    manifest.metaData.ultramodernRenderer.profile.renderer,
    'octane',
  );
  results.remoteManifest = {
    renderer: manifest.metaData.ultramodernRenderer.profile.renderer,
    remoteEntry: manifest.metaData.remoteEntry,
    ssrRemoteEntry: manifest.metaData.ssrRemoteEntry,
    publicPath: manifest.metaData.publicPath,
    ssrPublicPath: manifest.metaData.ssrPublicPath,
  };
  process.stdout.write(
    `${JSON.stringify({ stage: 'remote-published', remoteUrl, ...results.remoteManifest })}\n`,
  );
  await startDev(hostDirectory, hostPort);
  const document = await waitFor(
    async () => {
      // The native remote load timeout is 3000ms. Keep its actual fallback/error
      // document observable instead of aborting HTTP before that deadline.
      const response = await request(hostUrl, 10_000);
      const html = await response.text();
      const decoded = decodeOctaneSSRDocument(html);
      results.lastSSRResponse = {
        status: response.status,
        remoteMarkup: decoded.markup.includes('data-testid="remote-widget"'),
        segments: decoded.segments.map(({ id, markup, completed }) => ({
          id,
          completed,
          remoteMarkup: markup.includes('data-testid="remote-widget"'),
        })),
        sample: html.slice(0, 2000),
      };
      return (
        response.ok &&
        decoded.markup.includes('data-testid="remote-widget"') &&
        decoded
      );
    },
    'native dev SSR of the remote',
    120_000,
  );
  assert.match(document.markup, /Remote native v1/u);
  assert.match(document.markup, /data-owner="host-owned"/u);
  results.ssr = {
    remoteMarkup: true,
    renderer: 'octane',
    completedRemoteSegments: document.segments.filter(
      segment =>
        segment.completed &&
        segment.markup.includes('data-testid="remote-widget"'),
    ).length,
  };
  process.stdout.write(
    `${JSON.stringify({ stage: 'native-ssr', hostUrl, ...results.ssr })}\n`,
  );
  const nativeHostOrigin = `http://localhost:${hostPort}`;
  const assetsResponse = await request(
    `${nativeHostOrigin}/renderer-assets.json`,
  );
  assert.equal(assetsResponse.status, 200);
  const assets = await assetsResponse.json();
  assert.equal(assets.schema, 'ultramodern-renderer-assets');
  assert.equal(assets.version, 1);
  assert.equal(assets.renderer, 'octane');
  const hostAssets = assets.entries.index;
  assert.equal(hostAssets.rendererIdentity.appId, 'octane-mf-proof-host');
  const allowedEntrySources = hostAssets.assets
    .filter(asset => asset.kind === 'script')
    .map(asset => {
      assert.equal(
        asset.scriptType,
        'module',
        'the native host entries use modules',
      );
      const url = new URL(asset.href, nativeHostOrigin);
      assert.equal(
        url.origin,
        nativeHostOrigin,
        'the admitted entries belong to the owned host compiler',
      );
      assert.match(
        url.pathname,
        /\.[cm]?js$/u,
        'the compiler entry is JavaScript',
      );
      return url.href;
    });
  assert.ok(allowedEntrySources.length > 0);
  proxy = await markingProxy(nativeHostOrigin, proxyPort, allowedEntrySources);
  await browser('open', `http://127.0.0.1:${proxyPort}`);
  await waitFor(
    async () =>
      (await text('remote-increment')) === 'Count 0' &&
      (await browser(
        'get',
        'attr',
        '[data-testid="remote-widget"]',
        'data-hydrated',
      )) === 'true',
    'the native remote hydration',
  );
  assert.equal(
    await evaluate(
      `window.__ssrRemoteWidget !== null && window.__ssrRemoteWidget === document.querySelector('[data-testid="remote-widget"]') && window.__ssrRemoteWidget.isConnected`,
    ),
    true,
  );
  assert.equal(await evaluate('window.__ssrRemoteAlreadyHydrated'), false);
  results.entryBarrier = proxy.proof;
  assert.equal(results.entryBarrier.markerCaptured, true);
  assert.equal(
    results.entryBarrier.redirectedEntries.length,
    allowedEntrySources.length,
  );
  const redirectedSources = results.entryBarrier.redirectedEntries.map(
    entry => entry.url,
  );
  assert.equal(new Set(redirectedSources).size, allowedEntrySources.length);
  assert.deepEqual(
    [...redirectedSources].sort(),
    [...allowedEntrySources].sort(),
  );
  assert.ok(
    results.entryBarrier.redirectedEntries.every(entry => entry.markerCaptured),
  );
  assert.equal(
    await browser('get', 'count', '[data-testid="remote-fallback"]'),
    '0',
  );
  assert.equal(await evaluate('window.__remoteFallbackSeen'), false);
  assert.equal(
    await browser('get', 'attr', '[data-testid="remote-widget"]', 'data-owner'),
    'host-owned',
  );
  await click('host-increment');
  await click('host-increment');
  await click('remote-increment');
  await click('remote-increment');
  await click('host-relabel');
  assert.equal(await text('remote-label'), 'relabelled');
  assert.equal(await text('remote-increment'), 'Count 2');
  assert.equal(await text('host-increment'), 'Host count 2');
  const sentinel = await evaluate(`(() => {
    globalThis.__octaneMFDocumentSentinel = crypto.randomUUID();
    return { sentinel: globalThis.__octaneMFDocumentSentinel, timeOrigin: performance.timeOrigin, location: location.href };
  })()`);
  const before = await evaluate('globalThis.__octaneMFRemoteLifecycle');
  assert.equal(before.mounts, 1);
  assert.equal(before.cleanups, 0);
  assert.deepEqual(before.instances, [{ id: 1, cleanups: 0 }]);
  process.stdout.write(
    `${JSON.stringify({ stage: 'hydrated-before-edit', retainedServerNode: true, owner: 'host-owned', hostCount: 2, remoteCount: 2, label: 'relabelled' })}\n`,
  );
  const widgetFile = path.join(remoteDirectory, 'src/components/Widget.tsx');
  const widgetSource = await fs.readFile(widgetFile, 'utf8');
  assert.equal(
    widgetSource.split('Remote native v1').length,
    2,
    'one native remote marker changes',
  );
  await fs.writeFile(
    widgetFile,
    widgetSource.replace('Remote native v1', 'Remote native v2'),
  );
  const updates = await Promise.allSettled([
    waitFor(
      async () => (await text('remote-version')) === 'Remote native v2',
      'the remote component HMR update',
    ),
    (async () => {
      await waitFor(async () => {
        const response = await request(remoteUrl, 10_000);
        const { markup } = decodeOctaneSSRDocument(await response.text());
        return (
          response.ok &&
          markup.includes('data-testid="remote-widget"') &&
          /data-testid="remote-version">Remote native v2</u.test(markup)
        );
      }, 'the completed remote server compilation');
      const response = await request(hostUrl, 10_000);
      const { markup, segments } = decodeOctaneSSRDocument(
        await response.text(),
      );
      results.freshSSR = {
        status: response.status,
        remoteMarkup: markup.includes('data-testid="remote-widget"'),
        currentRemote: /data-testid="remote-version">Remote native v2</u.test(
          markup,
        ),
        staleRemote: markup.includes('Remote native v1'),
        segments: segments.map(({ completed, markup }) => ({
          completed,
          remoteMarkup: markup.includes('data-testid="remote-widget"'),
        })),
      };
      assert.equal(
        response.status,
        200,
        'fresh dev SSR still answers a document',
      );
      assert.equal(
        results.freshSSR.remoteMarkup,
        true,
        'fresh dev SSR renders its remote',
      );
      assert.equal(
        results.freshSSR.currentRemote,
        true,
        'the same host process loads the edited remote',
      );
      assert.equal(
        results.freshSSR.staleRemote,
        false,
        'SSR does not retain the old remote module',
      );
    })(),
  ]);
  results.postEdit = updates.map((update, index) => ({
    observation:
      index === 0
        ? 'browser remote update'
        : 'same-process server remote update',
    status: update.status,
    ...(update.status === 'rejected' ? { error: String(update.reason) } : {}),
  }));
  results.browserAfterEdit = await evaluate(`({
    version: document.querySelector('[data-testid="remote-version"]')?.textContent,
    hostCount: document.querySelector('[data-testid="host-increment"]')?.textContent,
    remoteCount: document.querySelector('[data-testid="remote-increment"]')?.textContent,
    label: document.querySelector('[data-testid="remote-label"]')?.textContent,
    sentinel: globalThis.__octaneMFDocumentSentinel,
    timeOrigin: performance.timeOrigin,
    location: location.href
  })`);
  const updateErrors = updates
    .filter(update => update.status === 'rejected')
    .map(update => update.reason);
  if (updateErrors.length)
    throw new AggregateError(
      updateErrors,
      'Native remote edit acceptance failed',
    );
  assert.equal(
    await text('host-increment'),
    'Host count 2',
    'remote HMR retains host state',
  );
  assert.equal(
    await text('remote-label'),
    'relabelled',
    'remote HMR retains host props',
  );
  const editedCounter = await text('remote-increment');
  assert.match(
    editedCounter,
    /^Count (?:0|2)$/u,
    'the admitted edited boundary may reset its own state',
  );
  await click('remote-increment');
  assert.equal(
    await text('remote-increment'),
    `Count ${Number(editedCounter.slice('Count '.length)) + 1}`,
    'the edited remote keeps exactly one native event handler',
  );
  assert.equal(
    await browser('get', 'attr', '[data-testid="remote-widget"]', 'data-owner'),
    'host-owned',
    'remote HMR retains the host application context',
  );
  assert.equal(
    await browser('get', 'attr', '[data-testid="remote-widget"]', 'data-path'),
    new URL(sentinel.location).pathname,
    'remote HMR retains the host router context',
  );
  assert.deepEqual(
    await evaluate(
      `({ sentinel: globalThis.__octaneMFDocumentSentinel, timeOrigin: performance.timeOrigin, location: location.href })`,
    ),
    sentinel,
  );
  assert.equal(
    await browser('get', 'count', '[data-testid="remote-widget"]'),
    '1',
  );
  const edited = await evaluate('globalThis.__octaneMFRemoteLifecycle');
  assert.equal(
    edited.mounts - edited.cleanups,
    1,
    'HMR leaves one live remote mount',
  );
  assert.ok(
    edited.mounts >= before.mounts,
    'HMR does not discard lifecycle observations',
  );
  assert.equal(edited.instances.length, edited.mounts);
  assert.equal(
    new Set(edited.instances.map(instance => instance.id)).size,
    edited.mounts,
  );
  assert.ok(
    edited.instances.every(instance => instance.cleanups <= 1),
    'HMR cleans each previous remote mount at most once',
  );
  await click('host-toggle');
  await waitFor(
    async () =>
      (await browser('get', 'count', '[data-testid="remote-widget"]')) === '0',
    'normal Octane remote removal',
  );
  const removed = await evaluate('globalThis.__octaneMFRemoteLifecycle');
  assert.equal(
    removed.cleanups,
    removed.mounts,
    'each remote mount cleans up exactly once',
  );
  assert.equal(removed.instances.length, removed.mounts);
  assert.ok(
    removed.instances.every(instance => instance.cleanups === 1),
    'each individual remote mount cleans up exactly once',
  );
  assert.equal(await text('host-increment'), 'Host count 2');
  results.hmr = {
    unaffectedHostState: true,
    hostProps: true,
    documentRetained: true,
    singleRemoteRoot: true,
    nativeCleanup: removed,
    freshServerRemote: true,
  };
  results.pageErrors = await browser('errors');
  results.console = await browser('console');
  assert.equal(results.pageErrors, '', 'no uncaught browser errors');
  assert.doesNotMatch(
    results.console,
    /hydration|hydrating|mismatch/iu,
    'no hydration diagnostics',
  );
  results.verdict = 'PASS';
} catch (error) {
  failure = error;
  results.verdict = 'FAIL';
  results.failure = String(error);
  if (browserOpened && !cancellation.signal.aborted) {
    results.pageErrors = await browser('errors').catch(String);
    results.console = await browser('console').catch(String);
    results.html = await browser('get', 'html', 'body').catch(String);
  }
  results.serverLogs = children.map(child =>
    child.log.length <= 8192
      ? child.log
      : `${child.log.slice(0, 4096)}\n[intermediate log omitted]\n${child.log.slice(-4096)}`,
  );
} finally {
  const cleanupErrors = [];
  if (browserOpened)
    await execute('agent-browser', ['close'], {
      env: {
        ...process.env,
        AGENT_BROWSER_SESSION: owner,
        AGENT_BROWSER_HEADED: 'false',
      },
      timeout: 15_000,
    }).catch(error => cleanupErrors.push(error));
  let processesRetired = true;
  for (const child of children)
    await stopChild(child).catch(error => {
      processesRetired = false;
      cleanupErrors.push(error);
    });
  await proxy?.().catch(error => cleanupErrors.push(error));
  if (processesRetired)
    for (const directory of artifacts)
      await execute('/Users/satan/bin/disk-guardian-artifacts', [
        'release',
        directory,
        '--owner',
        owner,
      ]).catch(error => cleanupErrors.push(error));
  else results.retainedArtifacts = [...artifacts];
  if (cleanupErrors.length) {
    results.verdict = 'FAIL';
    results.cleanupErrors = cleanupErrors.map(String);
    failure = new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors],
      'The Octane dev proof did not retire all owned resources.',
    );
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}
if (failure) throw failure;
