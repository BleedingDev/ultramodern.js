import { createServerBase } from '@modern-js/server-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyPlugins } from '../src/apply';
import type { ProdServerOptions } from '../src/types';

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-prod-apply-plugins-'));

describe('applyPlugins fork plugin assembly', () => {
  test('registers the telemetry plugin from @modern-js/server-runtime-extensions', async () => {
    const tempDir = makeTempDir();
    const snapshotPath = path.join(tempDir, '.modern/contract-gates.json');

    try {
      const options = {
        pwd: tempDir,
        serverConfigPath: path.join(tempDir, 'modern.server.js'),
        appContext: {
          apiDirectory: '',
          lambdaDirectory: '',
          appDirectory: tempDir,
        },
        config: {
          html: {},
          output: {},
          source: {},
          tools: {},
          server: {
            logger: false,
            telemetry: {
              enabled: true,
              canary: {
                enabled: true,
                rollbackConsecutiveFailures: 1,
                autopilot: {
                  enabled: true,
                  gateSnapshotPath: snapshotPath,
                  pollIntervalMs: 60_000,
                  runtimeFallbackSignal: {
                    enabled: true,
                  },
                },
              },
            },
          },
          bff: {},
          dev: {},
          security: {},
        },
      } as unknown as ProdServerOptions;

      const server = createServerBase(options);
      await applyPlugins(server, options);
      await server.init();

      const statusResponse = await server.request(
        '/_modern/runtime/status',
        {},
        {},
      );
      expect(statusResponse.status).toBe(200);
      const status = (await statusResponse.json()) as Record<string, any>;
      expect(status.ok).toBe(true);
      expect(status.canary.enabled).toBe(true);

      const signalResponse = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({
            reason: 'remote_load_failed',
            phase: 'load',
            appName: 'dashboard',
            entry: 'https://remote.example.com/remoteEntry.js',
          }),
        },
        {},
      );
      expect(signalResponse.status).toBe(202);
      expect(fs.existsSync(snapshotPath)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('registers injectModuleFederationCssPlugin after injectResourcePlugin in the real assembly', async () => {
    const tempDir = makeTempDir();

    try {
      // Host MF manifest fixture: makes injectModuleFederationCssPlugin
      // active for this dist directory (no remotes -> no network access).
      fs.writeFileSync(
        path.join(tempDir, 'mf-manifest.json'),
        JSON.stringify({ remotes: [] }),
      );

      let observedManifest: Record<string, unknown> | undefined;

      const options = {
        pwd: tempDir,
        serverConfigPath: path.join(tempDir, 'modern.server.js'),
        appContext: {
          apiDirectory: '',
          lambdaDirectory: '',
          appDirectory: tempDir,
        },
        config: {
          html: {},
          output: {},
          source: {},
          tools: {},
          server: {
            logger: false,
          },
          bff: {},
          dev: {},
          security: {},
        },
        serverConfig: {
          middlewares: [
            {
              name: 'capture-server-manifest',
              // run after every default middleware (including
              // inject-server-manifest and inject-module-federation-css)
              order: 'post' as const,
              handler: async (c: any) => {
                observedManifest = c.get('serverManifest') as Record<
                  string,
                  unknown
                >;
                return c.json({ ok: true });
              },
            },
          ],
        },
      } as unknown as ProdServerOptions;

      const server = createServerBase(options);
      await applyPlugins(server, options);
      await server.init();

      const response = await server.request('/', {}, {});
      expect(response.status).toBe(200);

      // The real injectResourcePlugin middleware ran first and set the
      // request-scoped manifest...
      expect(observedManifest).toBeTruthy();
      expect(observedManifest!.loaderBundles).toEqual({});
      // ...and injectModuleFederationCssPlugin, registered after it in
      // applyPlugins, enriched that manifest. If the registration order
      // regressed, the manifest would not exist yet at enrichment time and
      // this property would be undefined.
      expect(observedManifest!.moduleFederationCssAssets).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('does not expose telemetry endpoints when telemetry is not configured', async () => {
    const tempDir = makeTempDir();

    try {
      const options = {
        pwd: tempDir,
        serverConfigPath: path.join(tempDir, 'modern.server.js'),
        appContext: {
          apiDirectory: '',
          lambdaDirectory: '',
          appDirectory: tempDir,
        },
        config: {
          html: {},
          output: {},
          source: {},
          tools: {},
          server: {
            logger: false,
          },
          bff: {},
          dev: {},
          security: {},
        },
      } as unknown as ProdServerOptions;

      const server = createServerBase(options);
      await applyPlugins(server, options);
      await server.init();

      const statusResponse = await server.request(
        '/_modern/runtime/status',
        {},
        {},
      );
      expect(statusResponse.status).toBe(404);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
