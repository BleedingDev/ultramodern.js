// Real-browser conformance (Puppeteer + Chrome for Testing) for consumers that
// runHttpConformance built and left serving: CSR, hydration, navigation, data,
// action, head assets and HMR edit/restore per renderer x kind x environment.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { auditInstalledConsumer, auditReleaseArtifacts } from './artifacts.mjs';
import {
  assertNativeCompilerObservationUnchanged,
  readCompiledClientModuleGraph,
} from './compiler-observation.mjs';
import { conformanceMatrix } from './matrix.mts';
import {
  observeCompilerStyles,
  runRouteDimension,
} from './release-browser-routes.mjs';
import { prepareBrowserSdkProbe } from './release-browser-sdk.mjs';
import {
  compilerCSSAuthority,
  readCurrentConformanceEntryAuthority,
} from './release-hosts.mjs';
import {
  loadInstalledBuildManifest,
  loadInstalledDataResponseReader,
} from './run.mjs';

const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const require = createRequire(path.join(workspace, 'tests/package.json'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const dimensions = [
  'csr',
  'hydration',
  'navigation',
  'data',
  'action',
  'head-assets',
  'hmr',
];

function contained(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function ordinary(file, root) {
  const stat = await fs.lstat(file);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink(),
    `Expected ordinary input: ${file}`,
  );
  const real = await fs.realpath(file);
  assert.ok(!root || contained(root, real), `Input escapes its owner: ${file}`);
  const bytes = await fs.readFile(real);
  return {
    file: real,
    bytes,
    sha256: sha256(bytes),
    dev: stat.dev,
    ino: stat.ino,
  };
}

async function json(file, root) {
  const record = await ordinary(file, root);
  return { ...record, value: JSON.parse(record.bytes.toString('utf8')) };
}

async function unchanged(record) {
  const current = await ordinary(record.file);
  assert.equal(
    current.sha256,
    record.sha256,
    `Frozen authority changed: ${record.file}`,
  );
  assert.equal(current.dev, record.dev);
  assert.equal(current.ino, record.ino);
}

async function documentIdentity(page, renderer) {
  return page.evaluate(selected => {
    const node = document.getElementById(
      selected === 'react'
        ? 'ultramodern-renderer-identity'
        : '__ULTRAMODERN_RENDERER__',
    );
    if (!node || node.getAttribute('type') !== 'application/json')
      throw new Error('Actual owning document identity is missing');
    const value = JSON.parse(node.textContent);
    return selected === 'react' ? value : value.identity;
  }, renderer);
}

async function owners(page) {
  return page.evaluate(() => {
    const value = globalThis.__ultramodernConformance;
    if (!value)
      throw new Error('Actual authored lifecycle observations are missing');
    return {
      resources: structuredClone(value),
      rootCount: document.querySelectorAll(
        '#root [data-testid="native-layout"]',
      ).length,
      document: String(performance.timeOrigin),
    };
  });
}

async function waitForApplication(page, renderer, timeoutMs) {
  await page.waitForSelector('[data-testid="native-route"]', {
    timeout: timeoutMs,
  });
  await page.waitForFunction(
    selected =>
      document
        .querySelector('[data-testid="native-route"]')
        ?.getAttribute('data-renderer') === selected &&
      globalThis.__ultramodernConformance?.active.counter === 1 &&
      globalThis.__ultramodernConformance.active.stable === 1,
    { timeout: timeoutMs },
    renderer,
  );
}

function pageUrl(host, mode) {
  const probe = host.probes.cases.find(value => value.dimension === 'ssr');
  assert.ok(
    probe && typeof probe.path === 'string',
    'Actual analyzed SSR route is absent from live host',
  );
  const url = new URL(probe.path, host.baseUrl);
  if (mode === 'csr') {
    assert.ok(
      typeof host.authority?.csrRoutePrefix === 'string',
      'Actual analyzed CSR route is required',
    );
    url.pathname = `${host.authority.csrRoutePrefix.replace(/\/$/u, '')}/`;
    url.search = '';
  }
  return url.href;
}

async function heldStartup(
  page,
  url,
  renderer,
  identity,
  timeoutMs,
  hydrating,
) {
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const pending = new Set();
  await page.setRequestInterception(true);
  const intercept = request => {
    if (request.resourceType() !== 'script') {
      void request.continue();
      return;
    }
    const task = gate
      .then(() => request.continue())
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  page.on('request', intercept);
  let beforeNode;
  let response;
  let navigation;
  try {
    navigation = page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    // Observe rejection immediately while startup DOM assertions run.
    void navigation.catch(() => {});
    // This observes parser-created DOM while actual application scripts are held.
    await page.waitForSelector('#root', { timeout: timeoutMs });
    await page.waitForFunction(
      selected =>
        Boolean(
          document.getElementById(
            selected === 'react'
              ? 'ultramodern-renderer-identity'
              : '__ULTRAMODERN_RENDERER__',
          ),
        ),
      { timeout: timeoutMs },
      renderer,
    );
    const serverMarkerCount = await page.$$eval(
      '#root [data-testid="native-layout"]',
      nodes => nodes.length,
    );
    assert.equal(
      serverMarkerCount,
      hydrating ? 1 : 0,
      'Initial server markup contradicts the selected actual entry mode',
    );
    const observedIdentity = await documentIdentity(page, renderer);
    assert.deepEqual(observedIdentity, identity);
    assert.equal(
      await page.evaluate(
        () => globalThis.__ultramodernConformance?.active.stable ?? 0,
      ),
      0,
      'Application already activated before the network bootstrap gate',
    );
    if (hydrating) {
      beforeNode = await page.$('[data-testid="native-edited-component"]');
      assert.ok(
        beforeNode,
        'Actual SSR counter node missing before activation',
      );
    }
    release();
    response = await navigation;
    assert.ok(response);
    assert.equal(response.status(), 200);
    assert.deepEqual(
      JSON.parse(response.headers()['x-ultramodern-renderer-identity']),
      identity,
    );
    await waitForApplication(page, renderer, timeoutMs);
    const state = await owners(page);
    assert.equal(state.rootCount, 1);
    assert.deepEqual(state.resources.active, { counter: 1, stable: 1 });
    assert.equal(
      state.resources.cleanup.stable,
      0,
      'Initial activation mounted and retired another application',
    );
    const bootstrapCount =
      state.resources.active.stable + state.resources.cleanup.stable;
    if (hydrating) {
      const retained = await beforeNode.evaluate(
        node =>
          node ===
          document.querySelector('[data-testid="native-edited-component"]'),
      );
      assert.equal(retained, true, 'Hydration replaced actual server DOM');
      const token = randomUUID();
      return {
        nodeBefore: token,
        nodeAfter: retained ? token : undefined,
        hydrated: retained,
        bootstrapCount,
        bootstrapObservation:
          'cumulative public authored stable-owner activation/cleanup counts',
        responseStatus: response.status(),
      };
    }
    return {
      serverMarkerCount,
      clientMarkerCount: state.rootCount,
      bootstrapCount,
      bootstrapObservation:
        'cumulative public authored stable-owner activation/cleanup counts',
      responseStatus: response.status(),
    };
  } finally {
    release();
    await Promise.allSettled([...pending]);
    if (navigation) await navigation.catch(() => {});
    page.off('request', intercept);
    await page.setRequestInterception(false);
    await beforeNode?.dispose();
  }
}

async function replaceOwnedSource(record, bytes, appRoot) {
  await unchanged(record);
  const temp = path.join(appRoot, 'dist', `.release-hmr-${randomUUID()}.tmp`);
  let handle;
  let created;
  try {
    handle = await fs.open(temp, 'wx');
    created = await handle.stat();
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const staged = await ordinary(temp, appRoot);
    assert.equal(staged.dev, created.dev);
    assert.equal(staged.ino, created.ino);
    assert.equal(staged.sha256, sha256(bytes));
    await unchanged(record);
    await fs.rename(temp, record.file);
  } finally {
    await handle?.close();
    const remaining = await fs
      .lstat(temp)
      .catch(error =>
        error.code === 'ENOENT' ? undefined : Promise.reject(error),
      );
    if (remaining && created) {
      assert.equal(remaining.dev, created.dev);
      assert.equal(remaining.ino, created.ino);
      await fs.unlink(temp);
    }
  }
}

async function hmrSource(row, entryName = 'ssr') {
  const pageFile = path.resolve(
    row.consumerRoot,
    row.applicationRoot,
    row.routeModules[entryName].page,
  );
  const pageSource = (await ordinary(pageFile, row.appRoot)).bytes.toString(
    'utf8',
  );
  const { parseSync } = require('@babel/core');
  const parsed = parseSync(pageSource, {
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
  });
  const imports = parsed.program.body.filter(
    node =>
      node.type === 'ImportDeclaration' &&
      node.specifiers.some(
        specifier =>
          specifier.type === 'ImportDefaultSpecifier' &&
          specifier.local.name === 'Counter',
      ),
  );
  assert.equal(
    imports.length,
    1,
    `Counter must be imported once by actual authored ${entryName} route`,
  );
  assert.ok(imports[0].source.value.startsWith('.'));
  return ordinary(
    path.resolve(path.dirname(pageFile), `${imports[0].source.value}.tsx`),
    row.appRoot,
  );
}

async function developmentMetadata(consumer) {
  const file = path.resolve(
    consumer.consumerRoot,
    consumer.buildProvenance.development.metadataFile,
  );
  const record = await json(file, consumer.applicationRoot);
  const manifest = await loadInstalledBuildManifest({
    applicationRoot: consumer.applicationRoot,
    metadata: record.value,
    renderer: consumer.renderer,
    kind: consumer.kind,
    environment: 'development',
  });
  assert.equal(manifest.promotable, false);
  assert.equal(manifest.cacheAllowed, false);
  return { record, manifest };
}

async function hmrProof({
  page,
  row,
  consumer,
  host,
  environment,
  identity,
  timeoutMs,
  websocketFrames,
  entryMode = 'ssr',
}) {
  await page.goto(pageUrl(host, entryMode), {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  });
  await waitForApplication(page, consumer.renderer, timeoutMs);
  const initial = await owners(page);
  if (environment === 'production') {
    const scripts = await page.$$eval('script[src]', nodes =>
      nodes.map(node => node.src),
    );
    // The authored corpus has no business WebSockets; any observed socket is
    // an unexpected production runtime, even when a client picks another host.
    const sockets = websocketFrames.created;
    const hmrClientPresent = scripts.some(src =>
      /(?:webpack-dev-server|webpack\/hot|rsbuild-hmr|hot-update)/u.test(src),
    );
    assert.equal(hmrClientPresent, false);
    assert.equal(sockets.length, 0);
    return {
      hmrClientPresent,
      hmrSocketCount: sockets.length,
      activeRootCount: initial.rootCount,
      scriptUrls: scripts,
    };
  }
  const source = await hmrSource(row, identity.entryName);
  const original = source.bytes.toString('utf8');
  assert.equal(original.split('Counter before native edit').length, 2);
  const marker = `Counter after native edit ${randomUUID()}`;
  const edited = original.replace('Counter before native edit', marker);
  const metadataBefore = await developmentMetadata(consumer);
  assert.deepEqual(
    metadataBefore.manifest.identities[identity.entryName],
    identity,
  );
  const expectedInitialState = Number(
    await page.$eval('[data-testid="native-count"]', node => node.textContent),
  );
  await page.click('[data-testid="native-edited-component"] button');
  await page.click('[data-testid="native-unaffected-component"] button');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="native-count"]')?.textContent ===
        '1' &&
      document.querySelector('[data-testid="native-unaffected-count"]')
        ?.textContent === '1',
    { timeout: timeoutMs },
  );
  const before = await owners(page);
  const stateBefore = Number(
    await page.$eval('[data-testid="native-count"]', node => node.textContent),
  );
  const unaffectedStateBefore = Number(
    await page.$eval(
      '[data-testid="native-unaffected-count"]',
      node => node.textContent,
    ),
  );
  const updatedMarkerBefore = await page.$eval(
    '[data-testid="native-hmr-marker"]',
    node => node.textContent,
  );
  const frameStart = websocketFrames.received.length;
  let mutationAttempted = false;
  try {
    mutationAttempted = true;
    await replaceOwnedSource(source, Buffer.from(edited), row.appRoot);
    await page.waitForFunction(
      expected =>
        document.querySelector('[data-testid="native-hmr-marker"]')
          ?.textContent === expected &&
        globalThis.__ultramodernConformance?.active.counter === 1 &&
        globalThis.__ultramodernConformance.active.stable === 1,
      { timeout: timeoutMs },
      marker,
    );
    const until = Date.now() + timeoutMs;
    let metadataAfter;
    while (Date.now() < until) {
      try {
        metadataAfter = await developmentMetadata(consumer);
      } catch (error) {
        if (Date.now() >= until) throw error;
      }
      if (
        metadataAfter &&
        metadataAfter.manifest.devCompilation.generation >
          metadataBefore.manifest.devCompilation.generation &&
        metadataAfter.manifest.devCompilation.sourceInputDigest !==
          metadataBefore.manifest.devCompilation.sourceInputDigest
      )
        break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(metadataAfter);
    assert.ok(
      metadataAfter.manifest.devCompilation.generation >
        metadataBefore.manifest.devCompilation.generation,
    );
    assert.notEqual(
      metadataAfter.manifest.devCompilation.sourceInputDigest,
      metadataBefore.manifest.devCompilation.sourceInputDigest,
    );
    assert.ok(
      !isDeepStrictEqual(
        metadataAfter.manifest.devCompilation.compilationHashes,
        metadataBefore.manifest.devCompilation.compilationHashes,
      ),
    );
    assert.deepEqual(
      metadataAfter.manifest.identities,
      metadataBefore.manifest.identities,
      'Actual CLI session identity changed during HMR',
    );
    const currentCSS = await host.readCurrentCssAuthority({ environment });
    assert.equal(
      currentCSS.authority.compilationHash,
      metadataAfter.manifest.devCompilation.compilationHashes.client,
    );
    const cssAfter = await observeCompilerStyles({
      page,
      host: { ...host, cssAuthority: currentCSS.authority },
      renderer: consumer.renderer,
      timeoutMs,
    });
    assert.ok(
      cssAfter.observedStylesheets.length > 0,
      'CSS-authored corpus lost all loaded styles after HMR',
    );
    const appliedLayoutColorAfter = await page.$eval(
      '[data-testid="native-layout"]',
      node => getComputedStyle(node).color,
    );
    assert.equal(appliedLayoutColorAfter, 'rgb(20, 40, 60)');
    const after = await owners(page);
    const owningSockets = new Set(
      websocketFrames.created
        .filter(
          value =>
            new URL(value.url).origin.replace(/^ws/u, 'http') ===
            new URL(host.baseUrl).origin,
        )
        .map(value => value.requestId),
    );
    const actualFrames = websocketFrames.received
      .slice(frameStart)
      .filter(value => owningSockets.has(value.requestId));
    const actualHashes = new Set(
      Object.values(metadataAfter.manifest.devCompilation.compilationHashes),
    );
    assert.ok(
      actualFrames.some(
        frame =>
          frame.message?.type === 'hash' &&
          actualHashes.has(frame.message.data),
      ),
      'Owning HMR socket did not announce the actual completed compilation hash',
    );
    assert.ok(
      actualFrames.some(frame =>
        ['ok', 'warnings'].includes(frame.message?.type),
      ),
      'Owning HMR transport did not complete its update',
    );
    assert.equal(before.document, after.document);
    const current = await ordinary(source.file, row.appRoot);
    assert.equal(current.bytes.toString('utf8'), edited);
    const stateAfter = Number(
      await page.$eval(
        '[data-testid="native-count"]',
        node => node.textContent,
      ),
    );
    const unaffectedStateAfter = Number(
      await page.$eval(
        '[data-testid="native-unaffected-count"]',
        node => node.textContent,
      ),
    );
    assert.equal(unaffectedStateAfter, unaffectedStateBefore);
    assert.deepEqual(after.resources.active, { counter: 1, stable: 1 });
    assert.equal(
      after.resources.cleanup.counter - before.resources.cleanup.counter,
      1,
    );
    assert.equal(
      after.resources.cleanup.stable - before.resources.cleanup.stable,
      0,
    );
    return {
      updatedMarker: await page.$eval(
        '[data-testid="native-hmr-marker"]',
        node => node.textContent,
      ),
      updatedMarkerBefore,
      statePolicy: consumer.admittedProfile.hmr.editedBoundary,
      expectedInitialState,
      stateBefore,
      stateAfter,
      unaffectedStateBefore,
      unaffectedStateAfter,
      documentBefore: before.document,
      documentAfter: after.document,
      nativeUpdate: actualFrames.length > 0,
      sourceBeforeSha256: source.sha256,
      sourceAfterSha256: current.sha256,
      activeRootCount: after.rootCount,
      expectedActiveResourceCount:
        before.resources.active.counter + before.resources.active.stable,
      activeResourceCount:
        after.resources.active.counter + after.resources.active.stable,
      unaffectedResourceCleanupCount:
        after.resources.cleanup.stable - before.resources.cleanup.stable,
      oldResourceCleanupCount:
        after.resources.cleanup.counter - before.resources.cleanup.counter,
      sessionMetadata: {
        beforeSha256: metadataBefore.record.sha256,
        afterSha256: metadataAfter.record.sha256,
        before: metadataBefore.manifest.devCompilation,
        after: metadataAfter.manifest.devCompilation,
      },
      hmrFrames: actualFrames,
      currentCompilerCss: {
        authority: currentCSS.authority,
        receiptPath: currentCSS.receiptPath,
        receiptSha256: currentCSS.receiptSha256,
        observations: cssAfter,
        appliedLayoutColorAfter,
      },
    };
  } finally {
    if (mutationAttempted) {
      const current = await ordinary(source.file, row.appRoot);
      if (current.sha256 !== source.sha256) {
        assert.equal(
          current.bytes.toString('utf8'),
          edited,
          'Another owner changed the edited source; refusing to overwrite',
        );
        await replaceOwnedSource(current, source.bytes, row.appRoot);
        await page.waitForFunction(
          expected =>
            document.querySelector('[data-testid="native-hmr-marker"]')
              ?.textContent === expected,
          { timeout: timeoutMs },
          updatedMarkerBefore,
        );
      }
      assert.equal(
        (await ordinary(source.file, row.appRoot)).sha256,
        source.sha256,
      );
    }
  }
}

async function runCase({
  browser,
  dimension,
  consumer,
  row,
  host,
  environment,
  handoff,
  sdkEvidence,
  timeoutMs,
  signal,
  entryMode,
  requireSdkProof = true,
}) {
  signal.throwIfAborted();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const consoleMessages = [];
  const requestFailures = [];
  const websocketFrames = { created: [], received: [] };
  page.setDefaultTimeout(timeoutMs);
  page.on('pageerror', error =>
    consoleErrors.push(error.stack ?? String(error)),
  );
  page.on('console', message => {
    const value = {
      type: message.type(),
      text: message.text(),
      location: message.location(),
    };
    consoleMessages.push(value);
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request =>
    requestFailures.push({ url: request.url(), failure: request.failure() }),
  );
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketCreated', event =>
    websocketFrames.created.push({
      requestId: event.requestId,
      url: event.url,
    }),
  );
  cdp.on('Network.webSocketFrameReceived', event => {
    let message;
    try {
      message = JSON.parse(event.response.payloadData);
    } catch {}
    websocketFrames.received.push({
      requestId: event.requestId,
      timestamp: event.timestamp,
      opcode: event.response.opcode,
      payloadSha256: sha256(event.response.payloadData),
      message,
    });
  });
  const mode = entryMode ?? (dimension === 'csr' ? 'csr' : 'ssr');
  const key = `${consumer.renderer}:${consumer.kind}:${environment}:${mode}`;
  const identity = handoff.identity.applicationIdentities[key];
  assert.deepEqual(identity, mode === 'csr' ? host.csrIdentity : host.identity);
  try {
    let observation;
    if (dimension === 'csr' || dimension === 'hydration') {
      observation = await heldStartup(
        page,
        pageUrl(host, mode),
        consumer.renderer,
        identity,
        timeoutMs,
        dimension === 'hydration',
      );
      if (dimension === 'csr' && requireSdkProof) {
        const publicProbe = sdkEvidence;
        assert.ok(
          publicProbe?.sdkRuntimeReceipt,
          'CSR proof requires its actual previously executed SDK runtime receipt',
        );
        observation.publicExports = publicProbe.publicExports;
        observation.browserSdkProgram = publicProbe.sdkRuntimeReceipt;
      }
    } else if (dimension === 'hmr')
      observation = await hmrProof({
        page,
        row,
        consumer,
        host,
        environment,
        identity,
        timeoutMs,
        websocketFrames,
        entryMode: mode,
      });
    else
      observation = await runRouteDimension({
        dimension,
        page,
        row: { ...row, consumer },
        host,
        environment,
        identity,
        timeoutMs,
        signal,
      });
    if (entryMode === 'csr' && dimension === 'navigation') {
      await page.waitForFunction(
        () =>
          globalThis.__ultramodernConformance?.active.counter === 0 &&
          globalThis.__ultramodernConformance.active.stable === 1 &&
          globalThis.__ultramodernConformance.cleanup.counter === 2 &&
          globalThis.__ultramodernConformance.cleanup.stable === 0,
        { timeout: timeoutMs },
      );
      observation.lifecycleAfterHistory = await owners(page);
    }
    assert.deepEqual(await documentIdentity(page, consumer.renderer), identity);
    assert.deepEqual(
      consoleErrors,
      [],
      'Actual application browser errors were observed',
    );
    signal.throwIfAborted();
    return {
      ...handoff.identity,
      caseId: entryMode
        ? `${consumer.renderer}:${consumer.kind}:${environment}:${entryMode}:${dimension}`
        : `${consumer.renderer}:${consumer.kind}:${environment}:${dimension}`,
      producer: 'browser-test',
      observations: {
        ...observation,
        rendererIdentity: identity,
        consoleErrors,
        consoleMessages,
        requestFailures,
      },
    };
  } finally {
    await cdp.detach();
    await context.close();
  }
}

const csrNativeDimensions = ['csr', 'navigation', 'data', 'hmr'];

export function assertCsrNativeEntryObservation({
  dimension,
  environment,
  identity,
  hmrPolicy,
  observation: value,
}) {
  assert.equal(identity.entryName, 'csr');
  assert.deepEqual(value.rendererIdentity, identity);
  assert.deepEqual(value.consoleErrors, []);
  assert.deepEqual(value.requestFailures, []);
  if (dimension === 'csr') {
    assert.equal(value.serverMarkerCount, 0);
    assert.equal(value.clientMarkerCount, 1);
    assert.equal(value.bootstrapCount, 1);
    assert.equal(value.responseStatus, 200);
  } else if (dimension === 'navigation') {
    assert.equal(value.nativeLink, true);
    assert.equal(value.documentContinuityObserved, true);
    assert.ok(value.documentBefore);
    assert.equal(value.documentAfter, value.documentBefore);
    assert.notEqual(value.urlBefore, value.urlAfter);
    assert.equal(value.historyBackUrl, value.urlBefore);
    assert.equal(value.historyForwardUrl, value.urlAfter);
    assert.equal(value.destinationMarker, value.expectedDestinationMarker);
    assert.notEqual(value.destinationMarker, value.sourceMarker);
    assert.equal(value.lifecycleAfterHistory.rootCount, 1);
    assert.deepEqual(value.lifecycleAfterHistory.resources.active, {
      counter: 0,
      stable: 1,
    });
    assert.deepEqual(value.lifecycleAfterHistory.resources.cleanup, {
      counter: 2,
      stable: 0,
    });
  } else if (dimension === 'data') {
    assert.equal(value.loaderValue, 'Native loader value');
    for (const key of [
      'nativeDeferredLink',
      'deferredCriticalVisible',
      'deferredPendingVisible',
      'deferredLateVisible',
      'deferredDocumentContinuityObserved',
    ])
      assert.equal(value[key], true, key);
    assert.equal(value.deferredLateBeforeRelease, '');
    assert.equal(value.deferredTransport, 'native-data');
    assert.equal(value.deferredResponseStatus, 200);
    assert.equal(value.deferredDocumentBefore, value.deferredDocumentAfter);
    assert.deepEqual(value.deferredControlBeforeRelease, {
      released: false,
      activeRequests: 1,
      cleanupCount: 0,
      cancelled: false,
    });
    assert.deepEqual(value.deferredControlAfterRelease, {
      released: true,
      activeRequests: 0,
      cleanupCount: 1,
      cancelled: false,
    });
    assert.ok(
      Number.isFinite(value.deferredDomCompletion?.releaseDispatchedAt) &&
        Number.isFinite(value.deferredDomCompletion?.lateSeenAt) &&
        value.deferredDomCompletion.lateSeenAt >
          value.deferredDomCompletion.releaseDispatchedAt,
    );
    assert.equal(
      value.notFoundStatus,
      200,
      'CSR document must remain its native shell',
    );
    assert.equal(
      value.thrownErrorStatus,
      200,
      'CSR document must remain its native shell',
    );
    assert.equal(value.notFoundMarker, 'Native route not found');
    assert.ok(value.thrownErrorMarker.includes('Native route error'));
    assert.ok(value.thrownErrorMarker.includes('Native loader failure'));
    assert.equal(value.serverOnlyDataModulePresent, false);
    assert.equal(value.unresolvedRequirements, undefined);
  } else if (dimension === 'hmr') {
    assert.equal(value.activeRootCount, 1);
    if (environment === 'production') {
      assert.equal(value.hmrClientPresent, false);
      assert.equal(value.hmrSocketCount, 0);
      return;
    }
    assert.ok(['preserved', 'may-reset'].includes(hmrPolicy));
    assert.equal(value.statePolicy, hmrPolicy);
    assert.notEqual(value.stateBefore, value.expectedInitialState);
    if (hmrPolicy === 'preserved')
      assert.equal(value.stateAfter, value.stateBefore);
    else
      assert.ok(
        value.stateAfter === value.stateBefore ||
          value.stateAfter === value.expectedInitialState,
      );
    assert.equal(value.unaffectedStateAfter, value.unaffectedStateBefore);
    assert.equal(value.documentAfter, value.documentBefore);
    assert.equal(value.nativeUpdate, true);
    assert.notEqual(value.updatedMarker, value.updatedMarkerBefore);
    assert.notEqual(value.sourceAfterSha256, value.sourceBeforeSha256);
    assert.equal(value.expectedActiveResourceCount, 2);
    assert.equal(value.activeResourceCount, 2);
    assert.equal(value.oldResourceCleanupCount, 1);
    assert.equal(value.unaffectedResourceCleanupCount, 0);
    assert.equal(
      value.currentCompilerCss.appliedLayoutColorAfter,
      'rgb(20, 40, 60)',
    );
    assert.ok(
      value.currentCompilerCss.observations.observedStylesheets.length > 0,
    );
    assert.ok(
      value.sessionMetadata.after.generation >
        value.sessionMetadata.before.generation,
    );
  } else assert.fail(`Unknown CSR gate dimension: ${dimension}`);
}

async function selectedCsrHost({ input, environment, signal }) {
  const { row, consumer, hosts } = input;
  const attached = hosts[environment];
  const readAuthority = () =>
    readCurrentConformanceEntryAuthority({
      row,
      host: attached,
      environment,
      entryName: 'csr',
      signal,
    });
  const selected = await readAuthority();
  assert.deepEqual(selected.identity, consumer.csrBuiltIdentities[environment]);
  const host = {
    ...attached,
    identity: selected.identity,
    authority: selected,
    probes: {
      ...attached.probes,
      pageRouteId: selected.pageRouteId,
      controlRouteId: selected.controlRouteId,
    },
    runId: `csr_${randomUUID().replaceAll('-', '')}`,
  };
  host.decodeControlResponse = async (response, { method, signal }) => {
    const result = await host.readDataResponse(
      response,
      {
        identity: selected.identity,
        routeId: selected.controlRouteId,
        operation: method === 'GET' ? 'loader' : 'action',
      },
      signal,
    );
    assert.equal(result.kind, 'success');
    assert.equal(result.status, 200);
    return result.value;
  };
  host.readCurrentCssAuthority = async () => {
    const current = await readAuthority();
    return {
      authority: current.cssAuthority,
      receiptPath: current.compilerObservation.receiptPath,
      receiptSha256: current.compilerObservation.receiptSha256,
    };
  };
  host.observeServerOnlyDataIsolation = async () => {
    const graph = selected.compilerObservation;
    const expected = await Promise.all(
      selected.serverDataModules.map(relative =>
        ordinary(
          path.resolve(consumer.applicationRoot, relative),
          consumer.applicationRoot,
        ),
      ),
    );
    assert.ok(expected.length >= 2);
    const resources = graph.compiledModuleResources;
    const browserPaths = resources.browser
      .filter(value => value.source !== null)
      .map(value => value.source.path);
    for (const source of expected) {
      const pin = resources.server.find(
        value => value.source?.path === source.file,
      )?.source;
      assert.ok(pin, 'Actual server graph omits an owning CSR data module');
      assert.equal(pin.sha256, source.sha256);
      assert.equal(pin.size, source.bytes.byteLength);
    }
    return {
      modulePresent: browserPaths.some(
        file =>
          expected.some(source => source.file === file) ||
          /\.data\.[cm]?[jt]s$/u.test(file),
      ),
      evidence: {
        receiptPath: graph.receiptPath,
        receiptSha256: graph.receiptSha256,
        clientGraphSha256: graph.clientModuleGraph.sha256,
        actualServerDataModules: expected.map(source => source.file),
        browserModuleResources: resources.browser,
        serverModuleResources: resources.server,
      },
    };
  };
  return host;
}

/** Supplementary generated-entry cases, never members of the original matrix. */
export async function runCsrNativeEntryProof({
  browser,
  inputs,
  handoff,
  timeoutMs,
  signal,
}) {
  assert.ok(
    inputs.every(
      value =>
        value.consumer.kind === 'generated' &&
        value.consumer.renderer !== 'react',
    ),
  );
  const evidence = [];
  for (const input of inputs)
    for (const environment of ['development', 'production'])
      for (const dimension of csrNativeDimensions) {
        signal.throwIfAborted();
        const caseController = new AbortController();
        const timer = setTimeout(
          () =>
            caseController.abort(
              new Error('CSR entry proof exceeded its case deadline'),
            ),
          timeoutMs,
        );
        const caseSignal = AbortSignal.any([signal, caseController.signal]);
        try {
          const host = await selectedCsrHost({
            input,
            environment,
            signal: caseSignal,
          });
          const row = await runCase({
            browser,
            dimension,
            consumer: input.consumer,
            row: input.row,
            host,
            environment,
            handoff,
            timeoutMs,
            signal: caseSignal,
            entryMode: 'csr',
            requireSdkProof: false,
          });
          assertCsrNativeEntryObservation({
            dimension,
            environment,
            identity: host.identity,
            hmrPolicy: handoff.identity.hmrPolicies[input.consumer.renderer],
            observation: row.observations,
          });
          row.observations.entryAuthority = {
            routePrefix: host.authority.routePrefix,
            pageRouteId: host.authority.pageRouteId,
            controlRouteId: host.authority.controlRouteId,
            metadataFile: host.authority.metadataFile,
            compilerReceiptPath: host.authority.compilerObservation.receiptPath,
            compilerReceiptSha256:
              host.authority.compilerObservation.receiptSha256,
            files: host.authority.files,
          };
          evidence.push(row);
          process.stdout.write(`[browser] ${row.caseId} passed\n`);
        } finally {
          clearTimeout(timer);
        }
      }
  const expectedCases = inputs.flatMap(({ consumer }) =>
    ['development', 'production'].flatMap(environment =>
      csrNativeDimensions.map(
        dimension =>
          `${consumer.renderer}:generated:${environment}:csr:${dimension}`,
      ),
    ),
  );
  assert.deepEqual(
    evidence.map(row => row.caseId).sort(),
    expectedCases.sort(),
  );
  return evidence;
}

function attachHostReaders({ consumer, row, host }) {
  const readGraph = async environment => {
    const metadata = await json(
      path.resolve(
        consumer.consumerRoot,
        consumer.buildProvenance[environment].metadataFile,
      ),
      consumer.applicationRoot,
    );
    const actual = await loadInstalledBuildManifest({
      applicationRoot: consumer.applicationRoot,
      metadata: metadata.value,
      renderer: consumer.renderer,
      kind: consumer.kind,
      environment,
    });
    const graph = await readCompiledClientModuleGraph({
      applicationRoot: consumer.applicationRoot,
      consumerRoot: consumer.consumerRoot,
      distDirectory: path.join(consumer.applicationRoot, 'dist'),
      renderer: consumer.renderer,
      expectedEntryNames: row.entryNames,
      environment,
      ...(environment === 'development'
        ? { expectedDevelopmentManifest: actual }
        : {}),
    });
    return { metadata, actual, graph };
  };
  host.readCurrentCssAuthority = async ({ environment }) => {
    const { metadata, actual, graph } = await readGraph(environment);
    const authority = compilerCSSAuthority({
      compiler: graph,
      identity: actual.identities.ssr,
      headIncludes: host.authority.headIncludes,
      environment,
    });
    await assertNativeCompilerObservationUnchanged(graph);
    await unchanged(metadata);
    return {
      authority,
      receiptPath: graph.receiptPath,
      receiptSha256: graph.receiptSha256,
    };
  };
  host.observeServerOnlyDataIsolation = async ({ environment }) => {
    const { metadata, graph } = await readGraph(environment);
    const expected = await Promise.all(
      host.authority.serverDataModules.map(relative =>
        fs.realpath(path.resolve(consumer.applicationRoot, relative)),
      ),
    );
    assert.ok(expected.length >= 2);
    const sources = side =>
      graph.compiledModuleResources[side]
        .filter(value => value.source !== null)
        .map(value => value.source.path);
    const browserSources = sources('browser');
    const serverSources = sources('server');
    assert.ok(
      expected.every(file => serverSources.includes(file)),
      'Server compiler graph omits an owning server data module',
    );
    const present = browserSources.some(
      file => expected.includes(file) || /\.data\.[cm]?[jt]s$/u.test(file),
    );
    await assertNativeCompilerObservationUnchanged(graph);
    await unchanged(metadata);
    return {
      modulePresent: present,
      evidence: {
        receiptPath: graph.receiptPath,
        receiptSha256: graph.receiptSha256,
        clientGraphSha256: graph.clientModuleGraph.sha256,
        actualServerDataModules: expected,
        browserModuleResources: graph.compiledModuleResources.browser,
        serverModuleResources: graph.compiledModuleResources.server,
      },
    };
  };
  host.runId = `browser_${randomUUID().replaceAll('-', '')}`;
  if (consumer.renderer !== 'react') {
    host.readDataResponse = loadInstalledDataResponseReader({
      applicationRoot: consumer.applicationRoot,
      kind: consumer.kind,
    });
    host.decodeControlResponse = async (response, { method, signal }) => {
      const outcome = await host.readDataResponse(
        response,
        {
          identity: host.identity,
          routeId: host.probes.controlRouteId,
          operation: method === 'GET' ? 'loader' : 'action',
        },
        signal,
      );
      assert.equal(outcome.kind, 'success');
      assert.equal(outcome.status, 200);
      return outcome.value;
    };
  }
}

/**
 * Runs every browser dimension against the live hosts that runHttpConformance
 * attached. `report` is its returned report; `rows` its consumer rows.
 */
export async function runBrowserConformance({
  report,
  rows,
  manifestPath,
  qualifiedNode,
  browserExecutable,
  profileRoot,
  renderers,
  timeoutMs = 60_000,
  csrEntry = true,
  signal = new AbortController().signal,
  onCase = () => {},
}) {
  const releaseArtifacts = auditReleaseArtifacts({
    manifestPath,
    expectedSourceRevision: report.identity.sourceRevision,
  });
  const handoff = report;
  const puppeteer = require('puppeteer');
  await fs.mkdir(profileRoot, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: browserExecutable,
    userDataDir: path.join(profileRoot, 'profile'),
    dumpio: false,
    timeout: 30000,
  });
  const prepared = [];
  const evidence = [];
  const csrInputs = [];
  try {
    for (const consumer of handoff.consumers) {
      signal.throwIfAborted();
      const row = rows.find(
        item =>
          item.renderer === consumer.renderer && item.kind === consumer.kind,
      );
      assert.ok(
        row,
        `No consumer row for ${consumer.renderer}:${consumer.kind}`,
      );
      const hosts = row.environments;
      const routes = await json(
        path.join(consumer.applicationRoot, 'dist/route.json'),
        consumer.applicationRoot,
      );
      const analyzed = routes.value.routes.filter(route => !route.isApi);
      const ssrRoute = analyzed.find(
        route => route.entryName === 'ssr' && route.isSSR === true,
      );
      const csrRoute = analyzed.find(
        route => route.entryName === 'csr' && route.isSSR === false,
      );
      assert.ok(
        ssrRoute && csrRoute,
        'Built app must analyze one SSR and one CSR entry',
      );
      for (const environment of ['development', 'production']) {
        const host = hosts[environment];
        assert.equal(host.authority.routePrefix, ssrRoute.urlPath);
        assert.equal(host.authority.csrRoutePrefix, csrRoute.urlPath);
        attachHostReaders({ consumer, row, host });
      }
      if (
        csrEntry &&
        consumer.kind === 'generated' &&
        consumer.renderer !== 'react'
      )
        csrInputs.push({ consumer, row, hosts });
      const sdk = await prepareBrowserSdkProbe({
        consumer,
        row,
        hosts,
        handoff,
        releaseArtifacts,
        qualifiedNode,
        outputRoot: path.join(consumer.applicationRoot, 'dist'),
        signal,
      });
      prepared.push(sdk);
      const nativeCompilerManifests =
        consumer.renderer === 'octane'
          ? Object.values(hosts).flatMap(host =>
              (host.nativeCompilerManifests ?? []).map(proof => ({
                manifestPath: proof.manifestPath,
                rendererIdentity: [host.identity, host.csrIdentity].find(
                  value => value.entryName === proof.entryName,
                ),
              })),
            )
          : undefined;
      sdk.confirmInstalledAudit(
        auditInstalledConsumer({
          consumerRoot: consumer.consumerRoot,
          applicationRoot: row.applicationRoot,
          renderer: consumer.renderer,
          exactPackages: row.exactPackages,
          testedProfile: {
            renderer: consumer.renderer,
            packages: row.exactPackages,
          },
          entryFiles: [...row.entryFiles, ...sdk.entryFiles],
          releaseArtifacts,
          ...(nativeCompilerManifests ? { nativeCompilerManifests } : {}),
          rendererBuildManifestPath:
            consumer.buildProvenance.production.metadataFile,
          rendererDevelopmentManifestPath:
            consumer.buildProvenance.development.metadataFile,
        }),
      );
      const sdkEvidence = {};
      for (const environment of ['development', 'production']) {
        signal.throwIfAborted();
        sdkEvidence[environment] = structuredClone(
          await sdk.run({
            browser,
            environment,
            identity: consumer.csrBuiltIdentities[environment],
            timeoutMs,
          }),
        );
      }
      await sdk.stop();
      for (const environment of ['development', 'production']) {
        const host = hosts[environment];
        assert.deepEqual(host.identity, consumer.builtIdentities[environment]);
        assert.deepEqual(
          host.csrIdentity,
          consumer.csrBuiltIdentities[environment],
        );
        for (const dimension of dimensions) {
          const row_ = await runCase({
            browser,
            dimension,
            consumer,
            row,
            host,
            environment,
            handoff,
            sdkEvidence: sdkEvidence[environment],
            timeoutMs,
            signal,
          });
          evidence.push(row_);
          onCase(row_.caseId);
        }
      }
    }
    const expected = conformanceMatrix
      .filter(
        value => value.proof !== 'http' && renderers.includes(value.renderer),
      )
      .map(value => value.id)
      .sort();
    assert.deepEqual(evidence.map(value => value.caseId).sort(), expected);
    const csrEvidence = csrInputs.length
      ? await runCsrNativeEntryProof({
          browser,
          inputs: csrInputs,
          handoff,
          timeoutMs,
          signal,
        })
      : [];
    return { evidence, csrEvidence, browserVersion: await browser.version() };
  } finally {
    const failures = [];
    for (const stop of [
      () => browser.close(),
      ...prepared.map(sdk => () => sdk.stop()),
    ])
      try {
        await stop();
      } catch (error) {
        failures.push(error);
      }
    await fs.rm(profileRoot, { recursive: true, force: true });
    if (failures.length)
      process.stderr.write(
        `[browser] cleanup: ${failures.map(String).join('; ')}\n`,
      );
  }
}
