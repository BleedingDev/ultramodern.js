import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import processKit from '../../lib/process-kit.js';
import { BrowserSmokeError } from './contract.mjs';
import { createCombinedLogTailCollector } from './log-tail.mjs';

const { createProcessEnv, killChild, sleep } = processKit;

function isProcessGroupAlive(pid) {
  if (process.platform === 'win32' || !pid) {
    return false;
  }
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopServerProcess(child, exited) {
  if (!child.pid) {
    return;
  }

  killChild(child, 'SIGTERM');
  if (process.platform === 'win32') {
    await Promise.race([exited, sleep(5_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      killChild(child, 'SIGKILL');
    }
    return;
  }

  const deadline = Date.now() + 5_000;
  while (isProcessGroupAlive(child.pid) && Date.now() < deadline) {
    await sleep(50);
  }
  if (isProcessGroupAlive(child.pid)) {
    killChild(child, 'SIGKILL');
  }
  await Promise.race([exited, sleep(1_000)]);
}

export async function assertLocalPortsAvailable(targets) {
  const seenPorts = new Set();
  for (const target of targets) {
    const port = target.port || Number(new URL(target.baseUrl).port);
    if (!Number.isInteger(port) || port <= 0 || seenPorts.has(port)) {
      throw new BrowserSmokeError(
        `${target.app.id} has an invalid or duplicate local smoke port`,
        { baseUrl: target.baseUrl, port },
      );
    }
    seenPorts.add(port);

    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', error => {
        reject(
          new BrowserSmokeError(
            `${target.app.id} local smoke port ${port} is already in use`,
            {
              baseUrl: target.baseUrl,
              cause: error instanceof Error ? error.message : String(error),
              port,
            },
          ),
        );
      });
      server.listen({ host: '127.0.0.1', port }, () => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    });
  }
}

export function startServer(target, { artifactDir, projectDir }) {
  const logPath = path.join(artifactDir, `${target.app.id}-serve.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  const env = createProcessEnv({
    PORT: String(target.port),
    ...(target.portEnv ? { [target.portEnv]: String(target.port) } : {}),
    ...(target.publicUrlEnv ? { [target.publicUrlEnv]: target.baseUrl } : {}),
  });
  const nodeDeployDirectory = path.join(projectDir, target.app.path, '.output');
  const nodeDeployEntry = path.join(nodeDeployDirectory, 'index.js');
  if (!fs.existsSync(nodeDeployEntry)) {
    throw new BrowserSmokeError(
      `${target.app.id} final Node deploy entry is missing`,
      { nodeDeployEntry },
    );
  }
  const child = spawn(process.execPath, ['index.js'], {
    cwd: nodeDeployDirectory,
    detached: process.platform !== 'win32',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const combinedLogTail = createCombinedLogTailCollector();
  child.stdout.on('data', chunk => combinedLogTail.append(chunk));
  child.stderr.on('data', chunk => combinedLogTail.append(chunk));
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  const exited = new Promise(resolve => {
    let spawnError;
    child.once('error', error => {
      spawnError = error instanceof Error ? error.message : String(error);
    });
    child.once('close', (exitCode, signal) => {
      resolve({
        ...(spawnError ? { error: spawnError } : {}),
        exitCode,
        signal,
        logTail: combinedLogTail.read(),
      });
    });
  });
  return {
    child,
    exited,
    logPath,
    stop: () => stopServerProcess(child, exited).finally(() => logStream.end()),
  };
}

export async function startWorkerdProof({
  artifactDir,
  projectDir,
  timeoutMs = 60_000,
}) {
  const logPath = path.join(artifactDir, 'shell-workerd-proof.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  const child = spawn('pnpm', ['run', 'cloudflare:ssr-proof'], {
    cwd: projectDir,
    detached: process.platform !== 'win32',
    env: createProcessEnv({ ULTRAMODERN_KEEP_WORKERD: '1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  const exited = new Promise(resolve => {
    child.once('error', error => {
      resolve({
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  let stdout = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new BrowserSmokeError(
          `workerd SSR proof did not publish a browser URL within ${timeoutMs}ms`,
          { logPath },
        ),
      );
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
      const match = /(?:^|\n)WORKERD_URL=(https?:\/\/[^\s]+)/u.exec(stdout);
      const targetsMatch = /(?:^|\n)WORKERD_TARGET_URLS=(\{[^\n]+\})/u.exec(
        stdout,
      );
      if (targetsMatch) {
        clearTimeout(timer);
        try {
          resolve({
            baseUrl: match?.[1]?.replace(/\/$/u),
            targetUrls: JSON.parse(targetsMatch[1]),
          });
        } catch (error) {
          reject(
            new BrowserSmokeError(
              'workerd SSR proof published invalid target URL JSON',
              {
                cause: error instanceof Error ? error.message : String(error),
                logPath,
              },
            ),
          );
        }
      } else if (match) {
        // Legacy generated workspaces only publish the shell URL. This remains
        // usable outside strict acceptance, but strict all-workerd callers
        // require targetUrls for every app.
        clearTimeout(timer);
        resolve({ baseUrl: match[1].replace(/\/$/u), targetUrls: undefined });
      }
    });
    exited.then(result => {
      clearTimeout(timer);
      reject(
        new BrowserSmokeError(
          'workerd SSR proof exited before publishing a browser URL',
          { ...result, logPath },
        ),
      );
    });
  });

  try {
    const { baseUrl, targetUrls } = await ready;
    return {
      baseUrl,
      targetUrls,
      child,
      exited,
      logPath,
      stop: () =>
        stopServerProcess(child, exited).finally(() => logStream.end()),
    };
  } catch (error) {
    await stopServerProcess(child, exited);
    logStream.end();
    throw error;
  }
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
