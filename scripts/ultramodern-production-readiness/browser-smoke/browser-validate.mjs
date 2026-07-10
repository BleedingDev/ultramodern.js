import fs from 'node:fs';
import path from 'node:path';
import fsKit from '../../lib/fs-kit.js';
import { assertion, assertPass, joinUrl } from './http-validate.mjs';

const { writeJsonFile } = fsKit;
const fatalConsoleTypes = new Set(['error']);

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

export async function collectStylesheetLinks(page) {
  return page.$$eval('link[rel~="stylesheet"]', links =>
    links.map(link => ({
      dataChunk: link.getAttribute('data-chunk') ?? undefined,
      href: link.href,
      rel: link.getAttribute('rel') ?? link.rel ?? '',
    })),
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
  { appArtifactDir },
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

  page.on('response', response => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && isSameOriginAsset(target, url)) {
      failedResponses.push({ status, url });
    }
  });

  const assertions = [];
  try {
    await page.goto(joinUrl(target.baseUrl, target.routes.ssr), {
      waitUntil: 'domcontentloaded',
    });
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
    await context.close();
  }
}

export async function validateBrowserTarget(target, browser, { artifactDir }) {
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
  let stylesheetLinks = [];

  page.on('console', message => {
    const serialized = serializeConsoleMessage(message);
    consoleMessages.push(serialized);
  });
  page.on('pageerror', error => {
    pageErrors.push({
      message: error.message,
      stack: error.stack,
    });
  });
  page.on('response', response => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && isSameOriginAsset(target, url)) {
      failedResponses.push({ status, url });
    }
  });

  const assertions = [];
  try {
    await page.goto(joinUrl(target.baseUrl, target.routes.ssr), {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('[data-testid="ultramodern-ui-marker"]', {
      timeout: 15_000,
    });
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

    if (
      app.kind === 'shell' &&
      app.moduleFederation?.verticalRefs?.length > 0
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
              .locator(`[data-modern-boundary-id="${boundaryId}"]`)
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
      assertions.push(
        assertion(
          'shell-composition-boundary',
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
        `${app.id} shell route did not render every declared remote boundary`,
        { triedRemoteBoundaries },
      );
    }

    await waitForHydrationStyles(page);
    stylesheetLinks = await collectStylesheetLinks(page);
    const duplicateStylesheetHrefs = findDuplicateStylesheetHrefs(
      stylesheetLinks.map(link => link.href),
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

    const csLink = page.locator('a[href="/cs"], a[href$="/cs"]').first();
    if (app.kind !== 'shell' && (await csLink.count()) > 0) {
      await csLink.click();
      await page.waitForSelector('[data-testid="ultramodern-ui-marker"]', {
        timeout: 15_000,
      });
      assertions.push(
        assertion('localized-router-navigation', 'pass', {
          targetLanguage: 'cs',
        }),
      );
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
      })),
    );
    return assertions;
  } finally {
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
    await context.close();
  }
}
