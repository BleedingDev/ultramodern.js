import {
  createDefaultPlugins,
  createServerBase,
  type ServerPlugin,
} from '@modern-js/server-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { injectModuleFederationCssPlugin } from '../src/moduleFederationCss';
import { getDefaultAppContext, getDefaultConfig } from './helpers';

describe('plugin registration', () => {
  test('bare server-core default chain does not contain fork plugins', () => {
    const names = createDefaultPlugins().map(plugin => plugin.name);

    expect(names).not.toContain('@modern-js/inject-telemetry');
    expect(names).not.toContain('@modern-js/inject-module-federation-css');
  });

  test('bare server-core ignores telemetry config without explicit registration', async () => {
    const config = getDefaultConfig();
    config.server = {
      telemetry: {
        enabled: true,
        canary: {
          enabled: true,
        },
      },
    } as any;

    const server = createServerBase({
      config,
      pwd: process.cwd(),
      appContext: getDefaultAppContext(),
    });
    server.addPlugins([...createDefaultPlugins({ logger: false })]);
    await server.init();

    const response = await server.request('/_modern/runtime/status', {}, {});
    expect(response.status).toBe(404);
  });

  test('injectModuleFederationCssPlugin enriches the request server manifest', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-mf-css-reg-'),
    );

    try {
      fs.writeFileSync(
        path.join(tempDir, 'mf-manifest.json'),
        JSON.stringify({ remotes: [] }),
      );

      let observedManifest: Record<string, unknown> | undefined;

      const stubResourcePlugin: ServerPlugin = {
        name: 'stub-inject-resource',
        setup(api) {
          api.onPrepare(() => {
            const { middlewares } = api.getServerContext();
            middlewares.push({
              name: 'stub-inject-server-manifest',
              handler: async (c: any, next: any) => {
                c.set('serverManifest', { loaderBundles: {} } as any);
                await next();
              },
            });
          });
        },
      };

      const capturePlugin: ServerPlugin = {
        name: 'capture-server-manifest',
        setup(api) {
          api.onPrepare(() => {
            const { middlewares } = api.getServerContext();
            middlewares.push({
              name: 'capture-server-manifest',
              handler: async (c: any) => {
                observedManifest = c.get('serverManifest') as unknown as Record<
                  string,
                  unknown
                >;
                return c.json({ ok: true });
              },
            });
          });
        },
      };

      const server = createServerBase({
        config: getDefaultConfig(),
        pwd: tempDir,
        appContext: getDefaultAppContext(),
      });
      server.addPlugins([
        ...createDefaultPlugins({ logger: false }),
        stubResourcePlugin,
        injectModuleFederationCssPlugin(),
        capturePlugin,
      ]);
      await server.init();

      const response = await server.request('/', {}, {});
      expect(response.status).toBe(200);
      expect(observedManifest).toBeTruthy();
      expect(observedManifest!.moduleFederationCssAssets).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
