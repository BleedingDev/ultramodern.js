import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import processKit from '../../lib/process-kit.js';
import { BrowserSmokeError } from './contract.mjs';

const { createProcessEnv } = processKit;

export function startServer(target, { artifactDir, projectDir }) {
  const logPath = path.join(artifactDir, `${target.app.id}-serve.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const env = createProcessEnv({
    ...(target.portEnv ? { [target.portEnv]: String(target.port) } : {}),
    ...(target.publicUrlEnv ? { [target.publicUrlEnv]: target.baseUrl } : {}),
  });
  const child = spawn(
    'pnpm',
    ['--filter', target.app.package, 'run', 'serve'],
    {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  return {
    child,
    logPath,
    stop: () =>
      new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        }, 5_000).unref();
      }).finally(() => logStream.end()),
  };
}

export async function importPlaywright() {
  const configuredRoot = process.env.ULTRAMODERN_BROWSER_SMOKE_PLAYWRIGHT_ROOT;
  if (configuredRoot) {
    const requireFromPlaywrightRoot = createRequire(
      path.join(configuredRoot, 'package.json'),
    );
    return requireFromPlaywrightRoot('playwright');
  }

  try {
    return await import('playwright');
  } catch (error) {
    throw new BrowserSmokeError(
      'Playwright is required for UltraModern browser smoke. Install playwright or run through the published-create proof runtime.',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

export function findBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate));
}

export async function launchBrowser(browserProvider) {
  const playwright = browserProvider ?? (await importPlaywright());
  const executablePath = findBrowserExecutable();
  return playwright.chromium.launch({
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    ...(executablePath ? { executablePath } : {}),
    headless: true,
  });
}
