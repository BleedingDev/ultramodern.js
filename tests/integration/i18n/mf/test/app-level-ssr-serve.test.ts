import { readFile } from 'node:fs/promises';
import path from 'path';
import {
  killApp,
  modernBuild,
  modernServe,
} from '../../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../../utils/setSuiteTimeout';
import { acquireTestLock, conditionalTest } from '../../test-utils';

setSuiteTimeout(1000 * 60 * 8);

async function waitForAppReady(
  port: number,
  maxRetries = 30,
  pathname = '/mf-manifest.json',
) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}${pathname}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok || response.status < 500) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return;
      }
    } catch (error) {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Application on port ${port} did not become ready for ${pathname}`,
  );
}

const componentProviderDir = path.resolve(
  __dirname,
  '../mf-component-provider',
);
const appProviderDir = path.resolve(__dirname, '../mf-app-provider');
const consumerDir = path.resolve(__dirname, '../mf-consumer');

const COMPONENT_PROVIDER_PORT = 3006;
const APP_PROVIDER_PORT = 3005;
const CONSUMER_PORT = 3007;
const APP_MF_SSR_ENV = {
  MODERN_MF_APP_SSR: 'true',
  MODERN_FAST_TEST: 'true',
};

async function readMfStats(appDir: string, target: 'client' | 'server') {
  const relativePath =
    target === 'server' ? 'dist/bundles/mf-stats.json' : 'dist/mf-stats.json';
  return JSON.parse(await readFile(path.join(appDir, relativePath), 'utf8'));
}

async function fetchHtml(port: number, pathname: string) {
  const response = await fetch(`http://localhost:${port}${pathname}`, {
    headers: {
      'accept-language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  });

  return {
    status: response.status,
    html: await response.text(),
  };
}

describe('mf-i18n app-level SSR serve mode', () => {
  let releaseLock: (() => Promise<void>) | undefined;
  let componentProviderApp: unknown;
  let appProviderApp: unknown;
  let consumerApp: unknown;

  beforeAll(async () => {
    releaseLock = await acquireTestLock('i18n-mf');

    await modernBuild(componentProviderDir, [], {
      env: APP_MF_SSR_ENV,
    });
    await modernBuild(appProviderDir, [], {
      env: APP_MF_SSR_ENV,
    });
    await modernBuild(consumerDir, [], {
      env: APP_MF_SSR_ENV,
    });

    componentProviderApp = await modernServe(
      componentProviderDir,
      COMPONENT_PROVIDER_PORT,
    );
    await waitForAppReady(COMPONENT_PROVIDER_PORT);
    appProviderApp = await modernServe(appProviderDir, APP_PROVIDER_PORT, {
      env: APP_MF_SSR_ENV,
    });
    await waitForAppReady(APP_PROVIDER_PORT);
    consumerApp = await modernServe(consumerDir, CONSUMER_PORT, {
      env: APP_MF_SSR_ENV,
    });
    await waitForAppReady(CONSUMER_PORT);
  });

  afterAll(async () => {
    if (consumerApp) {
      await killApp(consumerApp);
    }
    if (appProviderApp) {
      await killApp(appProviderApp);
    }
    if (componentProviderApp) {
      await killApp(componentProviderApp);
    }
    if (releaseLock) {
      await releaseLock();
    }
  });

  conditionalTest(
    'shares one React renderer per browser and server federation graph',
    async () => {
      for (const appDir of [
        componentProviderDir,
        appProviderDir,
        consumerDir,
      ]) {
        const clientStats = await readMfStats(appDir, 'client');
        expect(clientStats.shared).toEqual(
          expect.arrayContaining([
            ...['react', 'react-dom', 'react-dom/client'].map(name =>
              expect.objectContaining({
                name,
                singleton: true,
                treeShaking: false,
              }),
            ),
          ]),
        );

        const serverStats = await readMfStats(appDir, 'server');
        expect(serverStats.shared).toEqual(
          expect.arrayContaining([
            ...['react', 'react-dom', 'react-dom/server'].map(name =>
              expect.objectContaining({
                name,
                singleton: true,
                treeShaking: false,
              }),
            ),
          ]),
        );
      }
    },
  );

  conditionalTest(
    'should server render app-level remote route in serve mode',
    async () => {
      const { status, html } = await fetchHtml(CONSUMER_PORT, '/en/remote-2');
      expect(status).toBe(200);
      expect(html).toContain('data-mf-app-loading="app-remote-custom"');
      expect(html).toContain('"lng":"en"');
      expect(html).not.toContain('__modern_ssr_fallback_reason__');
    },
  );

  conditionalTest(
    'should fallback gracefully when remote app is unavailable in serve mode',
    async () => {
      const { status, html } = await fetchHtml(
        CONSUMER_PORT,
        '/en/remote-unavailable',
      );
      expect(status).toBe(200);
      expect(html).toContain('data-mf-app-loading="app-remote-unavailable"');
      expect(html).toContain('<template');
      expect(html).toContain('"renderLevel":0');
    },
  );
});
