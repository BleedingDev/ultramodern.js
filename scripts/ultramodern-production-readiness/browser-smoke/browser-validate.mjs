import fs from 'node:fs';
import path from 'node:path';
import fsKit from '../../lib/fs-kit.js';
import { assertion, assertPass, joinUrl } from './http-validate.mjs';

const { writeJsonFile } = fsKit;
const fatalConsoleTypes = new Set(['error']);
const distributedSsrBoundarySelector = '[data-modern-distributed-ssr-boundary]';

function distributedSsrServerBoundarySelector(runtime) {
  return runtime === 'workerd'
    ? `${distributedSsrBoundarySelector}[data-modern-distributed-ssr-status="ready"]`
    : distributedSsrBoundarySelector;
}

export function extractBackendDrivenTitle(responseJson) {
  const titles = [];
  const visit = value => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value.items)) {
      const title = value.items.at(0)?.title;
      if (typeof title === 'string' && title.trim().length > 0) {
        titles.push(title.trim());
      }
    }
    for (const nested of Object.values(value)) {
      visit(nested);
    }
  };

  visit(responseJson);
  const uniqueTitles = [...new Set(titles)];
  return uniqueTitles.length === 1 ? uniqueTitles[0] : undefined;
}

export function serializeConsoleMessage(message) {
  return {
    location: message.location?.(),
    text: message.text?.(),
    type: message.type?.(),
  };
}

export function isFatalConsoleMessage(message) {
  if (!fatalConsoleTypes.has(message.type)) {
    return false;
  }

  const url = message.location?.url;
  const text = message.text ?? '';
  if (typeof url === 'string' && text.includes('Failed to load resource')) {
    try {
      if (new URL(url).pathname.endsWith('/favicon.ico')) {
        return false;
      }
    } catch {
      // Keep non-URL console locations fatal.
    }
  }

  return true;
}

export function isSameOriginAsset(target, url) {
  try {
    return new URL(url).origin === new URL(target.baseUrl).origin;
  } catch {
    return false;
  }
}

export function findDuplicateStylesheetHrefs(stylesheetHrefs) {
  const counts = new Map();
  for (const href of stylesheetHrefs) {
    if (typeof href !== 'string' || href.length === 0) {
      continue;
    }
    counts.set(href, (counts.get(href) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([href, count]) => ({ count, href }));
}

export function remoteBoundaryCandidates(remote) {
  return [remote?.id, remote?.alias, remote?.name]
    .filter(value => typeof value === 'string' && value.length > 0)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function remoteFederationOrigins(app) {
  return new Set(
    (app.moduleFederation?.remotes ?? [])
      .flatMap(remote => [remote.manifestUrl, remote.entry])
      .filter(value => typeof value === 'string')
      .map(value => {
        try {
          return new URL(value).origin;
        } catch {
          return undefined;
        }
      })
      .filter(Boolean),
  );
}

export function federationAssetKind(url, app, observedRemoteOrigins = []) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (/\bmf-manifest\.json$/u.test(parsed.pathname)) {
    return 'manifest';
  }
  if (/remoteEntry[^/]*\.(?:c|m)?js$/iu.test(parsed.pathname)) {
    return 'remote-entry';
  }
  const remoteOrigins = remoteFederationOrigins(app);
  for (const origin of observedRemoteOrigins) {
    remoteOrigins.add(origin);
  }
  if (
    /\.(?:c|m)?js$/iu.test(parsed.pathname) &&
    (remoteOrigins.has(parsed.origin) || /exposed[-_.]/iu.test(parsed.pathname))
  ) {
    return 'exposed-chunk';
  }

  return undefined;
}

async function installHydrationIdentityProbe(page, runtime) {
  return page.evaluate(selector => {
    const records = [...document.querySelectorAll(selector)].map(boundary => {
      const nodes = [boundary];
      const walker = document.createTreeWalker(boundary, NodeFilter.SHOW_ALL);
      let node = walker.nextNode();
      while (node) {
        nodes.push(node);
        node = walker.nextNode();
      }
      const removals = [];
      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const removedNode of mutation.removedNodes) {
            removals.push(removedNode);
          }
        }
      });
      observer.observe(boundary, { childList: true, subtree: true });
      return {
        boundary,
        initialOuterHtml: boundary.outerHTML,
        nodes,
        observer,
        removals,
      };
    });
    window.__modernHydrationIdentityProbe = { records };

    return {
      boundaryCount: records.length,
      nodeCount: records.reduce(
        (total, record) => total + record.nodes.length,
        0,
      ),
    };
  }, distributedSsrServerBoundarySelector(runtime));
}

export function isHydrationIdentityPreserved(evidence, runtime) {
  return (
    evidence.boundaryCount > 0 &&
    evidence.connectedNodeCount === evidence.nodeCount &&
    evidence.removedNodeCount === 0 &&
    (runtime !== 'workerd' ||
      (evidence.readyBoundaryCount === evidence.boundaryCount &&
        evidence.provenanceBoundaryCount === evidence.boundaryCount))
  );
}

async function readHydrationIdentityProbe(page, runtime) {
  const evidence = await page.evaluate(() => {
    const records = window.__modernHydrationIdentityProbe?.records ?? [];
    let connectedNodeCount = 0;
    let nodeCount = 0;
    let provenanceBoundaryCount = 0;
    let removedNodeCount = 0;
    let readyBoundaryCount = 0;
    const boundaries = [];
    const mutations = [];

    for (const record of records) {
      record.observer.disconnect();
      nodeCount += record.nodes.length;
      removedNodeCount += record.removals.length;
      connectedNodeCount += record.nodes.filter(node => {
        return (
          node.isConnected &&
          (node === record.boundary || record.boundary.contains(node))
        );
      }).length;
      const ready =
        record.boundary.isConnected &&
        record.boundary.getAttribute('data-modern-distributed-ssr-status') ===
          'ready';
      if (ready) {
        readyBoundaryCount += 1;
      }
      const buildMarker = record.boundary.getAttribute(
        'data-modern-distributed-ssr-build',
      );
      const digest = record.boundary.getAttribute(
        'data-modern-distributed-ssr-digest',
      );
      if (buildMarker && /^[a-f\d]{64}$/u.test(digest ?? '')) {
        provenanceBoundaryCount += 1;
      }
      boundaries.push({
        boundary: record.boundary.getAttribute(
          'data-modern-distributed-ssr-boundary',
        ),
        buildMarker,
        digest,
        ready,
      });
      if (record.removals.length > 0 || connectedNodeCount < nodeCount) {
        mutations.push({
          boundary: record.boundary.getAttribute(
            'data-modern-distributed-ssr-boundary',
          ),
          currentOuterHtml: record.boundary.outerHTML.slice(0, 8_000),
          initialOuterHtml: record.initialOuterHtml.slice(0, 8_000),
          removedNodes: record.removals.slice(0, 20).map(node => ({
            html:
              node instanceof Element
                ? node.outerHTML.slice(0, 2_000)
                : node.textContent?.slice(0, 2_000),
            name: node.nodeName,
          })),
        });
      }
    }

    return {
      boundaries,
      boundaryCount: records.length,
      connectedNodeCount,
      mutations,
      nodeCount,
      provenanceBoundaryCount,
      readyBoundaryCount,
      removedNodeCount,
    };
  });

  return {
    ...evidence,
    preserved: isHydrationIdentityPreserved(evidence, runtime),
  };
}

async function collectShellRemoteBoundaries(
  page,
  app,
  { runtime = 'node', withinDistributedSsr = false } = {},
) {
  const remotes =
    app.moduleFederation.remotes?.length > 0
      ? app.moduleFederation.remotes
      : app.moduleFederation.verticalRefs.map(id => ({ id }));
  const matchedRemoteBoundaries = [];
  const triedRemoteBoundaries = [];

  for (const remote of remotes) {
    const boundaryCandidates = remoteBoundaryCandidates(remote);
    const boundaryCounts = await Promise.all(
      boundaryCandidates.map(async boundaryId => [
        boundaryId,
        await page
          .locator(
            `${
              withinDistributedSsr
                ? `[data-modern-distributed-ssr-boundary^="${remote.id}::"]${
                    runtime === 'workerd'
                      ? '[data-modern-distributed-ssr-status="ready"]'
                      : ''
                  } `
                : ''
            }[data-modern-boundary-id="${boundaryId}"]`,
          )
          .count(),
      ]),
    );
    const matchedBoundary = boundaryCounts.find(([, count]) => count > 0);
    triedRemoteBoundaries.push({
      matchedBoundaryId: matchedBoundary?.[0],
      remoteId: remote.id,
      triedBoundaryIds: boundaryCandidates,
    });
    if (matchedBoundary) {
      matchedRemoteBoundaries.push({
        boundaryId: matchedBoundary[0],
        remoteId: remote.id,
      });
    }
  }

  return { matchedRemoteBoundaries, remotes, triedRemoteBoundaries };
}

async function waitForEveryShellRemoteBoundary(page, app, runtime) {
  const remotes =
    app.moduleFederation.remotes?.length > 0
      ? app.moduleFederation.remotes
      : app.moduleFederation.verticalRefs.map(id => ({ id }));
  const expectations = remotes.map(remote => ({
    boundaryIds: remoteBoundaryCandidates(remote),
    remoteId: remote.id,
    requiresReady: runtime === 'workerd',
  }));

  let waitFailure;
  try {
    await page.waitForFunction(
      expectedBoundaryIds => {
        const wrappers = [
          ...document.querySelectorAll(
            '[data-modern-distributed-ssr-boundary]',
          ),
        ];
        return expectedBoundaryIds.every(expectation =>
          wrappers.some(wrapper => {
            const key = wrapper.getAttribute(
              'data-modern-distributed-ssr-boundary',
            );
            if (!key?.startsWith(`${expectation.remoteId}::`)) {
              return false;
            }
            if (
              expectation.requiresReady &&
              wrapper.getAttribute('data-modern-distributed-ssr-status') !==
                'ready'
            ) {
              return false;
            }
            const renderedBoundaryIds = new Set(
              [...wrapper.querySelectorAll('[data-modern-boundary-id]')]
                .map(boundary =>
                  boundary.getAttribute('data-modern-boundary-id'),
                )
                .filter(Boolean),
            );
            return expectation.boundaryIds.some(candidate =>
              renderedBoundaryIds.has(candidate),
            );
          }),
        );
      },
      expectations,
      { timeout: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') {
      throw error;
    }
    waitFailure = error.message;
  }

  return {
    ...(await collectShellRemoteBoundaries(page, app, {
      runtime,
      withinDistributedSsr: true,
    })),
    ...(waitFailure ? { waitFailure } : {}),
  };
}

export async function waitForHydrationStyles(page) {
  if (typeof page.waitForLoadState === 'function') {
    await page
      .waitForLoadState('networkidle', { timeout: 15_000 })
      .catch(() => {
        // Network idle is a best-effort hydration settle point; streaming,
        // beacons, or long-polling should not hide the stylesheet assertion.
      });
  }

  if (typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(250);
  }
}

async function triggerRemoteBoundaryHydration(page, runtime) {
  const target = await page.evaluate(selector => {
    const boundary = document.querySelector(selector);
    const interactiveElement = boundary?.querySelector(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]',
    );
    if (!(interactiveElement instanceof Element)) {
      return undefined;
    }

    interactiveElement.setAttribute(
      'data-modern-selective-hydration-target',
      '',
    );
    window.__modernPreventSelectiveHydrationNavigation = event =>
      event.preventDefault();
    document.addEventListener(
      'click',
      window.__modernPreventSelectiveHydrationNavigation,
      { capture: true, once: true },
    );

    return {
      boundary: boundary.getAttribute('data-modern-distributed-ssr-boundary'),
      target: interactiveElement.tagName.toLowerCase(),
    };
  }, distributedSsrServerBoundarySelector(runtime));
  if (target === undefined) {
    return undefined;
  }

  try {
    await page
      .locator('[data-modern-selective-hydration-target]')
      .click({ noWaitAfter: true });
  } finally {
    await page.evaluate(() => {
      document
        .querySelector('[data-modern-selective-hydration-target]')
        ?.removeAttribute('data-modern-selective-hydration-target');
      if (window.__modernPreventSelectiveHydrationNavigation) {
        document.removeEventListener(
          'click',
          window.__modernPreventSelectiveHydrationNavigation,
          { capture: true },
        );
        delete window.__modernPreventSelectiveHydrationNavigation;
      }
    });
  }

  return target;
}

export async function collectStylesheetLinks(page) {
  return page.$$eval('link[rel~="stylesheet"]', links =>
    links.map(link => {
      const parentElement = link.parentElement;
      const normalizedHref = link.href;
      return {
        dataChunk: link.getAttribute('data-chunk') ?? undefined,
        dataPrecedence: link.getAttribute('data-precedence') ?? undefined,
        href: normalizedHref,
        normalizedHref,
        outerHTML: link.outerHTML,
        parent: parentElement
          ? {
              id: parentElement.id,
              tagName: parentElement.tagName.toLowerCase(),
            }
          : undefined,
        rawHref: link.getAttribute('href') ?? undefined,
        rel: link.getAttribute('rel') ?? link.rel ?? '',
      };
    }),
  );
}

export async function maybeScreenshot(page, filePath) {
  await page.screenshot({ fullPage: true, path: filePath });
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  assertPass(
    stat?.isFile() && !stat.isSymbolicLink() && stat.size > 0,
    `Required browser screenshot is missing or empty: ${filePath}`,
  );
  return { bytes: stat.size, path: filePath };
}

export async function validateNoJavaScriptSsrTarget(
  target,
  browser,
  { appArtifactDir, runtime = 'node' },
) {
  const app = target.app;
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: {
      height: 900,
      width: 1440,
    },
  });
  const page = await context.newPage();
  const failedResponses = [];
  let stylesheetLinks = [];

  page.on('response', response => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && isSameOriginAsset(target, url)) {
      failedResponses.push({ status, url });
    }
  });

  const assertions = [];
  try {
    const distributedSsrRoute =
      target.routes.distributedSsr ?? target.routes.ssr;
    const usesDedicatedDistributedSsrRoute =
      distributedSsrRoute !== target.routes.ssr;
    await page.goto(joinUrl(target.baseUrl, distributedSsrRoute), {
      waitUntil: 'domcontentloaded',
    });
    if (usesDedicatedDistributedSsrRoute) {
      await page.waitForSelector(
        distributedSsrServerBoundarySelector(runtime),
        { state: 'attached', timeout: 15_000 },
      );
      assertions.push(
        assertion('no-js-distributed-ssr-route', 'pass', {
          route: distributedSsrRoute,
        }),
      );
    } else {
      await page.waitForSelector('[data-testid="ultramodern-ui-marker"]', {
        timeout: 15_000,
      });
      const marker = await page
        .locator('[data-testid="ultramodern-ui-marker"]')
        .getAttribute('data-build-marker');
      assertions.push(
        assertion(
          'no-js-ssr-ui-marker',
          marker === app.marker?.build ? 'pass' : 'fail',
          {
            actual: marker,
            expected: app.marker?.build,
          },
        ),
      );
      assertPass(
        marker === app.marker?.build,
        `${app.id} no-JS SSR UI marker mismatch`,
      );
    }

    const rootSelector = app.styling?.federation?.rootSelector;
    if (rootSelector) {
      const rootCount = await page.locator(rootSelector).count();
      assertions.push(
        assertion(
          'no-js-ssr-css-root-marker',
          rootCount > 0 ? 'pass' : 'fail',
          {
            expected: rootSelector,
          },
        ),
      );
      assertPass(
        rootCount > 0,
        `${app.id} no-JS SSR CSS root marker is missing`,
      );
    }

    if (
      app.kind === 'shell' &&
      app.moduleFederation?.verticalRefs?.length > 0
    ) {
      const { matchedRemoteBoundaries, remotes, triedRemoteBoundaries } =
        await collectShellRemoteBoundaries(page, app, {
          runtime,
          withinDistributedSsr: true,
        });
      assertions.push(
        assertion(
          'no-js-shell-composition-boundary',
          matchedRemoteBoundaries.length === remotes.length ? 'pass' : 'fail',
          {
            declaredRemoteIds: remotes.map(remote => remote.id),
            matchedRemoteBoundaries,
            triedRemoteBoundaries,
          },
        ),
      );
      assertPass(
        matchedRemoteBoundaries.length === remotes.length,
        `${app.id} no-JS SSR did not render every declared remote boundary`,
        { triedRemoteBoundaries },
      );
    }

    stylesheetLinks = await collectStylesheetLinks(page);
    const duplicateStylesheetHrefs = findDuplicateStylesheetHrefs(
      stylesheetLinks.map(link => link.normalizedHref),
    );
    assertions.push(
      assertion(
        'no-js-stylesheet-href-dedupe',
        duplicateStylesheetHrefs.length === 0 ? 'pass' : 'fail',
        {
          duplicateStylesheetHrefs,
          stylesheetCount: stylesheetLinks.length,
        },
      ),
    );
    assertPass(
      duplicateStylesheetHrefs.length === 0,
      `${app.id} rendered duplicate stylesheet links without JavaScript`,
      { duplicateStylesheetHrefs, stylesheetLinks },
    );

    assertions.push(
      assertion(
        'no-js-ssr-failed-responses',
        failedResponses.length === 0 ? 'pass' : 'fail',
        {
          failedResponseCount: failedResponses.length,
        },
      ),
    );
    assertPass(
      failedResponses.length === 0,
      `${app.id} loaded failed no-JS SSR responses`,
      { failedResponses },
    );

    const screenshot = await maybeScreenshot(
      page,
      path.join(appArtifactDir, 'no-js-ssr.png'),
    );
    assertions.push(assertion('no-js-screenshot', 'pass', screenshot));
    return assertions;
  } finally {
    writeJsonFile(
      path.join(appArtifactDir, 'no-js-failed-responses.json'),
      failedResponses,
      { atomic: false },
    );
    writeJsonFile(
      path.join(appArtifactDir, 'no-js-stylesheets.json'),
      stylesheetLinks,
      { atomic: false },
    );
    await context.close();
  }
}

export async function validateBrowserTarget(
  target,
  browser,
  { artifactDir, runtime = 'node' },
) {
  const app = target.app;
  const appArtifactDir = path.join(artifactDir, app.id);
  fs.mkdirSync(appArtifactDir, { recursive: true });

  const context = await browser.newContext({
    viewport: {
      height: 900,
      width: 1440,
    },
  });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  const failedResponses = [];
  const federationResponses = [];
  const observedRemoteOrigins = new Set();
  let preFederationHydrationStylesheetLinks = [];
  let stylesheetLinks = [];
  let hydrationIdentity;
  let federationRouteHandler;
  let federationRouteMatcher;
  let releaseFederationAssets;
  const interceptedFederationRequests = [];
  let backendDrivenUiResponse;
  let activePhase = 'initial-navigation';

  page.on('console', message => {
    const serialized = serializeConsoleMessage(message);
    consoleMessages.push(serialized);
  });
  page.on('pageerror', error => {
    pageErrors.push({
      phase: activePhase,
      url: page.url(),
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  });
  page.on('response', response => {
    const status = response.status();
    const url = response.url();
    const assetKind = federationAssetKind(url, app, observedRemoteOrigins);
    if (assetKind) {
      federationResponses.push({ kind: assetKind, status, url });
      if (assetKind === 'manifest' || assetKind === 'remote-entry') {
        observedRemoteOrigins.add(new URL(url).origin);
      }
    }
    if (status >= 400 && isSameOriginAsset(target, url)) {
      failedResponses.push({ status, url });
    }
  });

  const assertions = [];
  try {
    const shellWithRemotes =
      app.kind === 'shell' &&
      (app.moduleFederation?.verticalRefs?.length ?? 0) > 0;
    const backendDrivenUiResponsePromise =
      app.kind === 'vertical' &&
      typeof app.api?.prefix === 'string' &&
      typeof page.waitForResponse === 'function'
        ? page.waitForResponse(
            response => {
              try {
                const pathname = new URL(response.url()).pathname;
                return (
                  (pathname === app.api.prefix ||
                    pathname.startsWith(`${app.api.prefix}/`)) &&
                  response.status() >= 200 &&
                  response.status() < 400
                );
              } catch {
                return false;
              }
            },
            { timeout: 15_000 },
          )
        : undefined;
    if (shellWithRemotes) {
      let release;
      const federationGate = new Promise(resolve => {
        release = resolve;
      });
      releaseFederationAssets = release;
      federationRouteMatcher = url =>
        Boolean(federationAssetKind(url, app, observedRemoteOrigins));
      federationRouteHandler = async route => {
        const url = route.request().url();
        interceptedFederationRequests.push({
          kind: federationAssetKind(url, app, observedRemoteOrigins),
          url,
        });
        await federationGate;
        try {
          await route.continue();
        } catch (error) {
          if (!String(error).includes('Route is already handled')) {
            throw error;
          }
        }
      };
      await page.route(federationRouteMatcher, federationRouteHandler);
      await page.goto(joinUrl(target.baseUrl, target.routes.ssr), {
        waitUntil: 'commit',
      });
    } else {
      await page.goto(joinUrl(target.baseUrl, target.routes.ssr), {
        waitUntil: 'domcontentloaded',
      });
    }
    activePhase = 'hydration';
    await page.waitForSelector('[data-testid="ultramodern-ui-marker"]', {
      state: shellWithRemotes ? 'attached' : 'visible',
      timeout: 15_000,
    });
    if (shellWithRemotes) {
      await page.waitForSelector(
        distributedSsrServerBoundarySelector(runtime),
        { state: 'attached', timeout: 15_000 },
      );
      const {
        matchedRemoteBoundaries,
        remotes,
        triedRemoteBoundaries,
        waitFailure,
      } = await waitForEveryShellRemoteBoundary(page, app, runtime);
      const serverRenderedEveryRemote =
        matchedRemoteBoundaries.length === remotes.length;
      assertions.push(
        assertion(
          'shell-server-rendered-composition',
          serverRenderedEveryRemote ? 'pass' : 'fail',
          {
            declaredRemoteIds: remotes.map(remote => remote.id),
            matchedRemoteBoundaries,
            runtime,
            triedRemoteBoundaries,
            waitFailure,
          },
        ),
      );
      assertPass(
        serverRenderedEveryRemote,
        `${app.id} did not server-render every declared remote boundary`,
        {
          matchedRemoteBoundaries,
          runtime,
          triedRemoteBoundaries,
          waitFailure,
        },
      );
      preFederationHydrationStylesheetLinks =
        await collectStylesheetLinks(page);
      const duplicatePreFederationHydrationStylesheetHrefs =
        findDuplicateStylesheetHrefs(
          preFederationHydrationStylesheetLinks.map(
            link => link.normalizedHref,
          ),
        );
      assertions.push(
        assertion(
          'pre-federation-hydration-stylesheet-href-dedupe',
          duplicatePreFederationHydrationStylesheetHrefs.length === 0
            ? 'pass'
            : 'fail',
          {
            duplicateStylesheetHrefs:
              duplicatePreFederationHydrationStylesheetHrefs,
            stylesheetCount: preFederationHydrationStylesheetLinks.length,
          },
        ),
      );
      assertPass(
        duplicatePreFederationHydrationStylesheetHrefs.length === 0,
        `${app.id} rendered duplicate stylesheet links before federated-boundary hydration`,
        {
          duplicateStylesheetHrefs:
            duplicatePreFederationHydrationStylesheetHrefs,
          stylesheetLinks: preFederationHydrationStylesheetLinks,
        },
      );
      const initialIdentity = await installHydrationIdentityProbe(
        page,
        runtime,
      );
      assertPass(
        initialIdentity.boundaryCount >= remotes.length &&
          initialIdentity.nodeCount > initialIdentity.boundaryCount,
        `${app.id} did not expose server-rendered remote DOM for identity tracking`,
        { initialIdentity, remoteCount: remotes.length, runtime },
      );
      releaseFederationAssets();
      releaseFederationAssets = undefined;
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
    }
    const marker = await page
      .locator('[data-testid="ultramodern-ui-marker"]')
      .getAttribute('data-build-marker');
    assertions.push(
      assertion(
        'browser-ui-marker',
        marker === app.marker?.build ? 'pass' : 'fail',
        {
          actual: marker,
          expected: app.marker?.build,
        },
      ),
    );
    assertPass(
      marker === app.marker?.build,
      `${app.id} browser UI marker mismatch`,
    );

    if (backendDrivenUiResponsePromise) {
      const response = await backendDrivenUiResponsePromise;
      const responseJson = await response.json();
      const expectedValue = extractBackendDrivenTitle(responseJson);
      backendDrivenUiResponse = {
        body: responseJson,
        expectedValue,
        status: response.status(),
        url: response.url(),
      };
      assertPass(
        expectedValue,
        `${app.id} API response did not contain exactly one list item title`,
        { apiResponse: backendDrivenUiResponse },
      );
      const apiStatus = page.locator('[data-testid="api-status"]');
      await apiStatus.waitFor({
        state: 'visible',
        timeout: 15_000,
      });
      await page.waitForFunction(
        () => {
          const text = document
            .querySelector('[data-testid="api-status"]')
            ?.textContent?.trim();
          return Boolean(
            text &&
              !['pending', 'unavailable', 'empty'].includes(text.toLowerCase()),
          );
        },
        undefined,
        { timeout: 15_000 },
      );
      const renderedValue = (await apiStatus.textContent())?.trim();
      assertions.push(
        assertion(
          'backend-driven-ui',
          renderedValue === expectedValue ? 'pass' : 'fail',
          {
            apiResponse: backendDrivenUiResponse,
            expectedValue,
            renderedValue,
          },
        ),
      );
      assertPass(
        renderedValue === expectedValue,
        `${app.id} did not render the exact backend-provided item title`,
        {
          apiResponse: backendDrivenUiResponse,
          expectedValue,
          renderedValue,
        },
      );
    }

    const rootSelector = app.styling?.federation?.rootSelector;
    if (rootSelector) {
      const rootCount = await page.locator(rootSelector).count();
      assertions.push(
        assertion('browser-css-root-marker', rootCount > 0 ? 'pass' : 'fail', {
          expected: rootSelector,
        }),
      );
      assertPass(rootCount > 0, `${app.id} browser CSS root marker is missing`);
    }

    await waitForHydrationStyles(page);

    if (shellWithRemotes) {
      let selectiveHydrationTrigger;
      const hasExposedChunkResponse = () =>
        federationResponses.some(
          response =>
            response.kind === 'exposed-chunk' &&
            response.status >= 200 &&
            response.status < 400,
        );
      if (!hasExposedChunkResponse()) {
        const exposedChunkResponse = page.waitForResponse(
          response =>
            federationAssetKind(response.url(), app, observedRemoteOrigins) ===
              'exposed-chunk' &&
            response.status() >= 200 &&
            response.status() < 400,
          { timeout: 15_000 },
        );
        selectiveHydrationTrigger = await triggerRemoteBoundaryHydration(
          page,
          runtime,
        );
        assertPass(
          selectiveHydrationTrigger !== undefined,
          `${app.id} exposed no interactive remote element for selective hydration`,
        );
        await exposedChunkResponse;
        await waitForHydrationStyles(page);
      }
      hydrationIdentity = await readHydrationIdentityProbe(page, runtime);
      assertions.push(
        assertion(
          'shell-hydration-dom-identity',
          hydrationIdentity.preserved ? 'pass' : 'fail',
          hydrationIdentity,
        ),
      );
      assertPass(
        hydrationIdentity.preserved,
        `${app.id} hydration replaced server-rendered remote DOM nodes`,
        { hydrationIdentity },
      );

      const successfulKinds = new Set(
        federationResponses
          .filter(response => response.status >= 200 && response.status < 400)
          .map(response => response.kind),
      );
      const requiredKinds = ['manifest', 'remote-entry', 'exposed-chunk'];
      const remoteNetworkEvidence = (app.moduleFederation?.remotes ?? [])
        .filter(
          remote =>
            typeof remote.manifestUrl === 'string' &&
            remote.manifestUrl.length > 0,
        )
        .map(remote => {
          let manifestUrl;
          try {
            manifestUrl = new URL(remote.manifestUrl);
          } catch {
            return {
              manifestUrl: remote.manifestUrl,
              remoteId: remote.id,
              status: 'fail',
            };
          }
          const responses = federationResponses.filter(response => {
            try {
              return new URL(response.url).origin === manifestUrl.origin;
            } catch {
              return false;
            }
          });
          const observedKinds = [
            ...new Set(
              responses
                .filter(
                  response => response.status >= 200 && response.status < 400,
                )
                .map(response => response.kind),
            ),
          ];
          return {
            manifestUrl: manifestUrl.href,
            observedKinds,
            remoteId: remote.id,
            responses,
            status: requiredKinds.every(kind => observedKinds.includes(kind))
              ? 'pass'
              : 'fail',
          };
        });
      const hasConfiguredRemoteUrls = remoteNetworkEvidence.length > 0;
      const networkEvidence = {
        interceptedRequests: interceptedFederationRequests,
        missingKinds: requiredKinds.filter(kind => !successfulKinds.has(kind)),
        remotes: remoteNetworkEvidence,
        responses: federationResponses,
        selectiveHydrationTrigger,
      };
      assertions.push(
        assertion(
          'shell-mf-network-evidence',
          interceptedFederationRequests.length > 0 &&
            networkEvidence.missingKinds.length === 0 &&
            (!hasConfiguredRemoteUrls ||
              remoteNetworkEvidence.every(remote => remote.status === 'pass'))
            ? 'pass'
            : 'fail',
          networkEvidence,
        ),
      );
      assertPass(
        interceptedFederationRequests.length > 0 &&
          networkEvidence.missingKinds.length === 0 &&
          (!hasConfiguredRemoteUrls ||
            remoteNetworkEvidence.every(remote => remote.status === 'pass')),
        `${app.id} did not consume every remote MF manifest, remote entry, and exposed chunk during hydration`,
        networkEvidence,
      );
    }

    if (
      app.kind === 'shell' &&
      app.moduleFederation?.verticalRefs?.length > 0
    ) {
      const { matchedRemoteBoundaries, remotes, triedRemoteBoundaries } =
        await collectShellRemoteBoundaries(page, app, {
          runtime,
          withinDistributedSsr: true,
        });
      assertions.push(
        assertion(
          'shell-composition-boundary',
          matchedRemoteBoundaries.length > 0 ? 'pass' : 'fail',
          {
            declaredRemoteIds: remotes.map(remote => remote.id),
            matchedRemoteBoundaries,
            triedRemoteBoundaries,
          },
        ),
      );
      assertPass(
        matchedRemoteBoundaries.length > 0,
        `${app.id} shell route did not render a declared remote boundary`,
        { triedRemoteBoundaries },
      );
    }

    stylesheetLinks = await collectStylesheetLinks(page);
    const duplicateStylesheetHrefs = findDuplicateStylesheetHrefs(
      stylesheetLinks.map(link => link.normalizedHref),
    );
    assertions.push(
      assertion(
        'stylesheet-evidence',
        stylesheetLinks.length > 0 ? 'pass' : 'fail',
        { stylesheetCount: stylesheetLinks.length },
      ),
    );
    assertPass(
      stylesheetLinks.length > 0,
      `${app.id} rendered no stylesheet evidence after hydration`,
    );
    assertions.push(
      assertion(
        'stylesheet-href-dedupe',
        duplicateStylesheetHrefs.length === 0 ? 'pass' : 'fail',
        {
          duplicateStylesheetHrefs,
          stylesheetCount: stylesheetLinks.length,
        },
      ),
    );
    assertPass(
      duplicateStylesheetHrefs.length === 0,
      `${app.id} rendered duplicate stylesheet links after hydration`,
      { duplicateStylesheetHrefs, stylesheetLinks },
    );

    const localizedLinkSelector = 'a[href="/cs"], a[href$="/cs"]';
    const csLinks = page.locator(localizedLinkSelector);
    if (app.kind !== 'shell') {
      const localizedLinkCount = await csLinks.count();
      assertPass(
        localizedLinkCount === 1,
        `${app.id} must render exactly one Czech locale navigation link`,
        { localizedLinkCount, localizedLinkSelector },
      );
      const csLink = csLinks.first();
      const localizedNavigation = page
        .locator(`nav:has(${localizedLinkSelector})`)
        .first();
      const source = {
        htmlLang: await page.locator('html').getAttribute('lang'),
        navigationLabel: await localizedNavigation.getAttribute('aria-label'),
        pathname: new URL(page.url()).pathname,
        text: (await csLink.textContent())?.trim(),
      };
      assertPass(
        source.pathname === '/en' &&
          source.htmlLang === 'en' &&
          typeof source.navigationLabel === 'string' &&
          source.navigationLabel.length > 0 &&
          typeof source.text === 'string' &&
          source.text.length > 0,
        `${app.id} localized navigation did not start from rendered English DOM`,
        { source },
      );

      await page.evaluate(operation => {
        if (operation === 'install-localized-navigation-continuity') {
          Object.defineProperty(
            window,
            '__ultramodernLocalizedNavigationDocument',
            {
              configurable: true,
              value: document,
            },
          );
        }
      }, 'install-localized-navigation-continuity');
      activePhase = 'localized-router-navigation';
      const localePageErrorOffset = pageErrors.length;
      try {
        await csLink.click();
        await page.waitForURL(url => url.pathname === '/cs', {
          timeout: 15_000,
        });
        await page.locator('html[lang="cs"]').waitFor({
          state: 'attached',
          timeout: 15_000,
        });
      } catch (error) {
        assertPass(false, `${app.id} localized router navigation failed`, {
          cause: error instanceof Error ? error.message : String(error),
          pageErrors: pageErrors.slice(localePageErrorOffset),
          phase: activePhase,
        });
      }

      const documentContinuityPreserved = await page.evaluate(
        operation =>
          operation === 'read-localized-navigation-continuity' &&
          window.__ultramodernLocalizedNavigationDocument === document,
        'read-localized-navigation-continuity',
      );
      const target = {
        htmlLang: await page.locator('html').getAttribute('lang'),
        navigationLabel: await localizedNavigation.getAttribute('aria-label'),
        pathname: new URL(page.url()).pathname,
        text: (await csLink.textContent())?.trim(),
      };
      const localizedNavigationPassed =
        documentContinuityPreserved === true &&
        target.pathname === '/cs' &&
        target.htmlLang === 'cs' &&
        typeof target.navigationLabel === 'string' &&
        target.navigationLabel.length > 0 &&
        target.navigationLabel !== source.navigationLabel &&
        typeof target.text === 'string' &&
        target.text.length > 0 &&
        target.text !== source.text;
      assertions.push(
        assertion(
          'localized-router-navigation',
          localizedNavigationPassed ? 'pass' : 'fail',
          { documentContinuityPreserved, source, target },
        ),
      );
      assertPass(
        documentContinuityPreserved === true,
        `${app.id} localized navigation replaced the browser document`,
        { documentContinuityPreserved, source, target },
      );
      assertPass(
        target.pathname === '/cs',
        `${app.id} localized navigation did not reach /cs`,
        { source, target },
      );
      assertPass(
        target.htmlLang === 'cs',
        `${app.id} localized navigation did not update html lang`,
        { source, target },
      );
      assertPass(
        typeof target.text === 'string' &&
          target.text.length > 0 &&
          target.text !== source.text,
        `${app.id} localized navigation did not update translated DOM`,
        { source, target },
      );
      assertPass(
        typeof target.navigationLabel === 'string' &&
          target.navigationLabel.length > 0 &&
          target.navigationLabel !== source.navigationLabel,
        `${app.id} localized navigation did not update the translated navigation label`,
        { source, target },
      );
      const localizedPageErrors = pageErrors.slice(localePageErrorOffset);
      assertPass(
        localizedPageErrors.length === 0,
        `${app.id} emitted page errors during localized router navigation`,
        {
          pageErrors: localizedPageErrors,
          phase: activePhase,
        },
      );
      activePhase = 'final-diagnostics';
    }

    const fatalConsoleMessages = consoleMessages.filter(isFatalConsoleMessage);
    assertions.push(
      assertion(
        'browser-diagnostics',
        fatalConsoleMessages.length === 0 &&
          pageErrors.length === 0 &&
          failedResponses.length === 0
          ? 'pass'
          : 'fail',
        {
          consoleErrorCount: fatalConsoleMessages.length,
          failedResponseCount: failedResponses.length,
          pageErrorCount: pageErrors.length,
        },
      ),
    );
    assertPass(
      fatalConsoleMessages.length === 0,
      `${app.id} emitted browser console errors`,
      { consoleMessages: fatalConsoleMessages },
    );
    assertPass(pageErrors.length === 0, `${app.id} emitted page errors`, {
      pageErrors,
    });
    assertPass(
      failedResponses.length === 0,
      `${app.id} loaded failed browser responses`,
      { failedResponses },
    );

    const screenshot = await maybeScreenshot(
      page,
      path.join(appArtifactDir, 'screenshot.png'),
    );
    assertions.push(assertion('browser-screenshot', 'pass', screenshot));
    assertions.push(
      ...(await validateNoJavaScriptSsrTarget(target, browser, {
        appArtifactDir,
        runtime,
      })),
    );
    return assertions;
  } finally {
    releaseFederationAssets?.();
    if (federationRouteMatcher && federationRouteHandler) {
      await page
        .unroute(federationRouteMatcher, federationRouteHandler)
        .catch(() => {});
    }
    writeJsonFile(path.join(appArtifactDir, 'console.json'), consoleMessages, {
      atomic: false,
    });
    writeJsonFile(path.join(appArtifactDir, 'page-errors.json'), pageErrors, {
      atomic: false,
    });
    writeJsonFile(
      path.join(appArtifactDir, 'failed-responses.json'),
      failedResponses,
      { atomic: false },
    );
    writeJsonFile(
      path.join(appArtifactDir, 'stylesheets.json'),
      stylesheetLinks,
      { atomic: false },
    );
    writeJsonFile(
      path.join(appArtifactDir, 'pre-federation-hydration-stylesheets.json'),
      preFederationHydrationStylesheetLinks,
      { atomic: false },
    );
    if (
      app.kind === 'shell' &&
      app.moduleFederation?.verticalRefs?.length > 0
    ) {
      writeJsonFile(
        path.join(appArtifactDir, 'hydration-identity.json'),
        hydrationIdentity ?? { status: 'not-completed' },
        { atomic: false },
      );
      writeJsonFile(
        path.join(appArtifactDir, 'federation-network.json'),
        {
          interceptedRequests: interceptedFederationRequests,
          responses: federationResponses,
        },
        { atomic: false },
      );
    }
    if (backendDrivenUiResponse) {
      writeJsonFile(
        path.join(appArtifactDir, 'backend-driven-ui.json'),
        backendDrivenUiResponse,
        { atomic: false },
      );
    }
    await context.close();
  }
}
