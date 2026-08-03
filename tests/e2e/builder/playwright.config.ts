import { defineConfig } from '@playwright/test';

const getWorkers = () => {
  const configuredWorkers = process.env.PLAYWRIGHT_WORKERS;

  if (!configuredWorkers) {
    return '50%';
  }

  const numericWorkers = Number.parseInt(configuredWorkers, 10);

  if (Number.isFinite(numericWorkers) && numericWorkers > 0) {
    return numericWorkers;
  }

  return configuredWorkers;
};

const isCI = Boolean(process.env.CI);

export default defineConfig({
  workers: getWorkers(),
  use: {
    // Use the built-in Chrome browser to speed up CI tests
    channel: isCI ? 'chrome' : undefined,
  },
});
