import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AppNormalizedConfig,
  AppTools,
  AppUserConfig,
} from '@modern-js/app-tools';
import { type CLIPluginAPI, createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import { build } from 'esbuild';
import { generateCode } from '../../src/cli/code';
import {
  ENTRY_POINT_FILE_NAME,
  ENTRY_POINT_RUNTIME_GLOBAL_CONTEXT_FILE_NAME,
  SERVER_ENTRY_POINT_FILE_NAME,
} from '../../src/cli/constants';
import * as serverTemplate from '../../src/cli/template.server';

test('an early SSR import failure stays observable without terminating Node before a request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'modern-ssr-bootstrap-'));
  const serverIndex = rs
    .spyOn(serverTemplate, 'serverIndex')
    .mockReturnValue(
      `throw new Error('remote manifest unavailable'); export const requestHandler = undefined;`,
    );
  try {
    await generateCode(
      [
        {
          entryName: 'main',
          entry: join(directory, 'App.tsx'),
          isAutoMount: true,
        },
      ] as any,
      {
        appDirectory: directory,
        internalDirectory: directory,
        srcDirectory: directory,
        internalSrcAlias: '@_modern_js_src',
        metaName: 'modern-js',
        serverRoutes: [],
      } as any,
      {
        html: { mountId: 'root' },
        source: { enableAsyncEntry: true },
        server: { ssr: true },
      } as any,
      {
        _internalRuntimePlugins: { call: async () => ({ plugins: [] }) },
      } as any,
    );
    const outfile = join(directory, 'bootstrap.cjs');
    await build({
      entryPoints: [join(directory, 'main/bootstrap.server.jsx')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
    });
    const result = spawnSync(
      process.execPath,
      [
        '--unhandled-rejections=strict',
        '-e',
        `
      const assert = require('node:assert/strict');
      const { requestHandler } = require(process.argv[1]);
      setTimeout(async () => {
        await assert.rejects(requestHandler, /remote manifest unavailable/);
        process.stdout.write('request received original failure');
      }, 50);
    `,
        outfile,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('request received original failure');
  } finally {
    serverIndex.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});

describe('native RSC entry generation', () => {
  const mappedRsc = Object.freeze({
    environments: Object.freeze({ server: 'workerSSR', client: 'client' }),
  });

  test.each([
    { name: 'disabled SSR', rsc: false, ssr: true, enabled: false },
    { name: 'boolean SSR', rsc: true, ssr: true, enabled: true },
    { name: 'mapped SSR', rsc: mappedRsc, ssr: true, enabled: true },
    { name: 'boolean CSR', rsc: true, ssr: false, enabled: true },
    { name: 'mapped CSR', rsc: mappedRsc, ssr: false, enabled: true },
  ])('emits native client and server entries for $name', async input => {
    const directory = await mkdtemp(join(tmpdir(), 'modern-rsc-code-'));
    try {
      const raw: AppUserConfig = {
        server: { rsc: input.rsc, ssr: input.ssr },
        html: { mountId: 'root' },
      };
      const config: AppNormalizedConfig = {
        resolve: {},
        server: {},
        source: {},
        output: {},
        experiments: {},
        bff: {},
        dev: {},
        deploy: {},
        html: {},
        tools: {},
        security: {},
        testing: {},
        builderPlugins: [],
        performance: {},
        environments: {},
        splitChunks: {},
        plugins: [],
        ...raw,
        _raw: raw,
      };
      const manager = createPluginManager<CLIPluginAPI<AppTools>>();
      const context = await createContext<AppTools>({
        appContext: initAppContext<AppTools>({
          appDirectory: directory,
          packageName: 'native-rsc-entry-test',
          configFile: false,
          command: 'build',
          metaName: 'modern-js',
          plugins: manager.getPlugins(),
        }),
        config: raw,
        normalizedConfig: config,
      });
      const api = initPluginAPI({ context, pluginManager: manager });
      context.pluginAPI = api;
      api.updateAppContext({
        internalDirectory: directory,
        internalSrcAlias: '@_modern_js_src',
        runtimeConfigFile: join(directory, 'modern.runtime.ts'),
        serverRoutes: [],
      });
      await generateCode(
        [
          {
            entryName: 'main',
            isMainEntry: true,
            entry: join(directory, 'src/App.tsx'),
            isAutoMount: true,
          },
        ],
        api.getAppContext(),
        api.getNormalizedConfig(),
        api.getHooks(),
      );
      const client = await readFile(
        join(directory, 'main', ENTRY_POINT_FILE_NAME),
        'utf8',
      );
      const server = await readFile(
        join(directory, 'main', SERVER_ENTRY_POINT_FILE_NAME),
        'utf8',
      );
      expect(client.includes('setServerCallback(callServer)')).toBe(
        input.enabled,
      );
      expect(client.includes('createFromReadableStream(rscStream')).toBe(
        input.enabled,
      );
      expect(server.includes('rscPayloadHandler')).toBe(input.enabled);
      expect(server.includes("from '@modern-js/runtime/rsc/server'")).toBe(
        input.enabled,
      );
      if (input.enabled) {
        expect(server).toContain('enableRsc: true');
        await expect(
          access(join(directory, 'main/AppProxy.jsx')),
        ).resolves.toBeUndefined();
        const serverContext = await readFile(
          join(
            directory,
            'main',
            `${ENTRY_POINT_RUNTIME_GLOBAL_CONTEXT_FILE_NAME}.server.js`,
          ),
          'utf8',
        );
        expect(serverContext).toContain('RSCRoot: AppProxy');
      } else {
        await expect(
          access(join(directory, 'main/AppProxy.jsx')),
        ).rejects.toMatchObject({ code: 'ENOENT' });
      }
      expect(config.server.rsc).toBe(input.rsc);
      expect(mappedRsc.environments).toEqual({
        server: 'workerSSR',
        client: 'client',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
