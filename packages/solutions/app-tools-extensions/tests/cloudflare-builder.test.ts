import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type EnvironmentConfig } from '@rsbuild/core';
import { getCloudflareBuilderEnvironments } from '../src/cloudflare-builder';

const createWorkerEnvironments = (
  entry = './src/bootstrap.jsx',
): Record<string, EnvironmentConfig> => ({
  client: { output: { target: 'web' } },
  workerSSR: {
    output: { target: 'web-worker' },
    source: { entry: { main: [entry] } },
  },
});

describe('Cloudflare builder environments', () => {
  it.each([
    {
      deployTarget: 'cloudflare',
      environmentTarget: 'node',
      detectedProvider: 'netlify',
      enabled: true,
    },
    {
      deployTarget: 'node',
      environmentTarget: 'cloudflare',
      detectedProvider: 'cloudflare',
      enabled: false,
    },
    {
      deployTarget: undefined,
      environmentTarget: undefined,
      detectedProvider: 'cloudflare',
      enabled: true,
    },
  ])('selects Cloudflare worker output from explicit target or provider', ({
    deployTarget,
    environmentTarget,
    detectedProvider,
    enabled,
  }) => {
    const previousDeployTarget = process.env.MODERNJS_DEPLOY;
    if (environmentTarget === undefined) {
      delete process.env.MODERNJS_DEPLOY;
    } else {
      process.env.MODERNJS_DEPLOY = environmentTarget;
    }
    const environments = createWorkerEnvironments('./src/bootstrap.server.jsx');

    try {
      const normalizedConfig = deployTarget
        ? { deploy: { target: deployTarget } }
        : {};
      const result = getCloudflareBuilderEnvironments({
        appContext: { apiDirectory: '/app/api', appDirectory: '/app' },
        environments,
        normalizedConfig,
        resolveDeployProvider: () => detectedProvider,
      });

      if (!enabled) {
        expect(result).toBe(environments);
        return;
      }

      expect(result).not.toBe(environments);
      expect(result.workerSSR?.output).toMatchObject({
        module: true,
        target: 'web',
      });
      expect(result.workerSSR?.source?.entry).toEqual({
        main: ['./src/index.server.jsx'],
      });
    } finally {
      if (previousDeployTarget === undefined) {
        delete process.env.MODERNJS_DEPLOY;
      } else {
        process.env.MODERNJS_DEPLOY = previousDeployTarget;
      }
    }
  });

  it('rewrites worker entries and adds an Effect BFF entry before user handlers', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-cloudflare-builder-'),
    );
    const apiDirectory = path.join(appDirectory, 'api');

    try {
      fs.mkdirSync(apiDirectory, { recursive: true });
      fs.writeFileSync(path.join(apiDirectory, 'index.ts'), '');
      const result = getCloudflareBuilderEnvironments({
        appContext: { apiDirectory, appDirectory },
        environments: createWorkerEnvironments(),
        normalizedConfig: {
          bff: { runtimeFramework: 'effect' },
          deploy: { target: 'cloudflare' },
        },
      });

      expect(result.workerSSR?.source?.entry).toEqual({
        main: ['./src/index.server.jsx'],
        __modern_bff_effect: [
          `${path.join(apiDirectory, 'index.ts')}?modern-bff-runtime`,
        ],
      });
      expect(result.workerSSR?.tools?.htmlPlugin).toBe(false);
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
    }
  });

  it('creates only a genuine Effect worker environment for a headless Cloudflare API', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-cloudflare-headless-builder-'),
    );
    const apiDirectory = path.join(appDirectory, 'api');

    try {
      fs.mkdirSync(apiDirectory, { recursive: true });
      fs.writeFileSync(path.join(apiDirectory, 'index.ts'), '');
      const result = getCloudflareBuilderEnvironments({
        appContext: { apiOnly: true, apiDirectory, appDirectory },
        environments: {
          client: { output: { target: 'web' }, source: { entry: {} } },
          server: { output: { target: 'node' }, source: { entry: {} } },
        },
        normalizedConfig: {
          bff: { runtimeFramework: 'effect' },
          deploy: { target: 'cloudflare' },
        },
      });

      expect(Object.keys(result)).toEqual(['workerSSR']);
      expect(result.workerSSR?.output).toMatchObject({
        module: true,
        target: 'web',
      });
      expect(result.workerSSR?.source?.entry).toEqual({
        __modern_bff_effect: [
          `${path.join(apiDirectory, 'index.ts')}?modern-bff-runtime`,
        ],
      });
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
    }
  });
});
