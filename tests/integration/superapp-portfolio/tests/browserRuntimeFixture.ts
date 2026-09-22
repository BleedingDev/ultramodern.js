import { existsSync } from 'node:fs';
import { type Browser, chromium } from 'playwright';
import { captureBrowserRuntimeDiagnostics } from './browserRuntimeArtifacts';

export function launchRuntimeBrowser() {
  if (!existsSync(chromium.executablePath())) {
    throw new Error(
      'Playwright Chromium is missing. Run pnpm --dir tests exec playwright install chromium.',
    );
  }
  return chromium.launch();
}

export async function createBrowserRuntimePage(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  try {
    const page = await context.newPage();
    const diagnostics = captureBrowserRuntimeDiagnostics(page);
    return { context, diagnostics, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}
