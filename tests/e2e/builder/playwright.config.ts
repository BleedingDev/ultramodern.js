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

export default defineConfig({
  workers: getWorkers(),
});
