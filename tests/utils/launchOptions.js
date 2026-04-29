const fs = require('fs');
const os = require('os');
const path = require('path');

const resolveHeadlessShellExecutable = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const rootDir = path.join(
    os.homedir(),
    '.cache/puppeteer/chrome-headless-shell',
  );
  if (!fs.existsSync(rootDir)) {
    return undefined;
  }

  const revisions = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => right.localeCompare(left));

  const candidates = [
    ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'],
    ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
    ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
    ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
  ];

  for (const revision of revisions) {
    for (const [folder, executable] of candidates) {
      const resolvedPath = path.join(rootDir, revision, folder, executable);
      if (fs.existsSync(resolvedPath)) {
        return resolvedPath;
      }
    }
  }

  return undefined;
};

const launchOptions = {
  headless: 'new',
  dumpio: true,
  args: [
    '--no-sandbox',
    // Suppress D-Bus connection warnings
    '--log-level=3',
    '--v=0',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection',
    // Suppress OOM score adjustment warnings
    '--no-zygote',
    '--disable-setuid-sandbox',
    // Additional flags to reduce noise
    '--disable-logging',
    '--disable-extensions',
    '--disable-plugins',
    '--disable-sync',
    '--disable-translate',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--disable-background-networking',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--disable-hang-monitor',
    '--disable-prompt-on-repost',
    '--disable-web-security',
    '--metrics-recording-only',
    '--no-default-browser-check',
    '--safebrowsing-disable-auto-update',
    '--enable-automation',
    '--password-store=basic',
    '--use-mock-keychain',
  ],
  env: {
    ...process.env,
    // Prevent Chromium from attempting to use D-Bus
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/dev/null',
    DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/dev/null',
  },
  // Fix protocol timed out
  // see: https://github.com/puppeteer/puppeteer/issues/9927
  protocolTimeout: 0,
};

const headlessShellExecutable = resolveHeadlessShellExecutable();
if (headlessShellExecutable) {
  launchOptions.executablePath = headlessShellExecutable;
}

module.exports = {
  launchOptions,
};
