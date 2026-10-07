import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type {
  AppNormalizedConfig,
  AppTools,
  AppUserConfig,
} from '@modern-js/app-tools/cli-config';
import { SERVICE_WORKER_ENVIRONMENT_NAME } from '@modern-js/builder';
import { type CLIPluginAPI, createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import {
  createRsbuild,
  type RsbuildPlugin,
  type Rspack,
  rspack,
} from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import { getRscPlugins } from '../../../../cli/builder/src/plugins/rscConfig';
import { AppProxyForRSC } from '../../../../runtime/plugin-runtime/src/cli/template';
import { getCloudflareBuilderEnvironments } from '../../../app-tools-extensions/src/cloudflare-builder';
import {
  createReactRscWorkerBuilderPlugin,
  createReactRscWorkerIntegrationPlugin,
  resolveReactWorkerRscOptions,
} from '../../src/renderers/react/rsc-worker-integration';

function normalizedConfig(config: AppUserConfig): AppNormalizedConfig {
  return {
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
    ...config,
    _raw: config,
  };
}

async function resolveCliConfig(config: AppNormalizedConfig) {
  const manager = createPluginManager<CLIPluginAPI<AppTools>>();
  manager.addPlugins([createReactRscWorkerIntegrationPlugin()]);
  const plugins = manager.getPlugins();
  const context = await createContext<AppTools>({
    appContext: initAppContext<AppTools>({
      packageName: 'react-worker-config-proof',
      configFile: false,
      command: 'build',
      appDirectory: __dirname,
      metaName: 'modern-js',
      plugins,
    }),
    config: config._raw,
    normalizedConfig: config,
  });
  const api = initPluginAPI({ context, pluginManager: manager });
  context.pluginAPI = api;
  for (const plugin of plugins) await plugin.setup?.(api);
  return api.getHooks().modifyResolvedConfig.call(config);
}

describe('React worker integration in actual CLI hooks', () => {
  it('normalizes public server.rsc true and preserves server settings and existing plugins', async () => {
    const existing: RsbuildPlugin = { name: 'existing-plugin', setup() {} };
    const config = normalizedConfig({
      server: { rsc: true, ssr: true, port: 3010 },
      deploy: { target: 'cloudflare' },
      builderPlugins: [existing],
    });
    const resolved = await resolveCliConfig(config);
    expect(resolved.server).toEqual({
      rsc: {
        environments: {
          server: SERVICE_WORKER_ENVIRONMENT_NAME,
          client: 'client',
        },
      },
      ssr: true,
      port: 3010,
    });
    expect(resolved.builderPlugins).toHaveLength(2);
    expect(resolved.builderPlugins[0]).toBe(existing);
    expect(resolved.builderPlugins[1]).toMatchObject({
      name: 'ultramodern:react:rsc-worker',
    });
    expect(config.server.rsc).toBe(true);
    expect(config.builderPlugins).toEqual([existing]);
  });

  it.each([
    { server: { rsc: false }, deploy: { target: 'cloudflare' as const } },
    { server: {}, deploy: { target: 'cloudflare' as const } },
    { server: { rsc: true }, deploy: { target: 'node' as const } },
  ])('leaves disabled RSC and other deployment targets untouched', async config => {
    const normalized = normalizedConfig(config);
    expect(await resolveCliConfig(normalized)).toBe(normalized);
  });

  it('accepts a public native environment mapping and rejects conflicts before builder creation', async () => {
    const mapped: AppUserConfig = {
      server: {
        rsc: { environments: { server: SERVICE_WORKER_ENVIRONMENT_NAME } },
      },
      deploy: { target: 'cloudflare' },
    };
    expect(
      (await resolveCliConfig(normalizedConfig(mapped))).server.rsc,
    ).toEqual({
      environments: {
        server: SERVICE_WORKER_ENVIRONMENT_NAME,
        client: 'client',
      },
    });
    const conflicting: AppUserConfig = {
      server: { rsc: { environments: { server: 'server' } } },
      deploy: { target: 'cloudflare' },
    };
    await expect(
      resolveCliConfig(normalizedConfig(conflicting)),
    ).rejects.toThrow(
      `environments.server to be ${SERVICE_WORKER_ENVIRONMENT_NAME}`,
    );
  });
});

describe('Cloudflare React RSC options', () => {
  it('derives the existing native worker and client environments from true', () => {
    expect(resolveReactWorkerRscOptions(true)).toEqual({
      environments: {
        server: SERVICE_WORKER_ENVIRONMENT_NAME,
        client: 'client',
      },
    });
    expect(resolveReactWorkerRscOptions(false)).toBeUndefined();
    expect(resolveReactWorkerRscOptions(undefined)).toBeUndefined();
  });

  it('preserves supplied options and completes a valid partial mapping without mutation', () => {
    const options = Object.freeze({
      environments: Object.freeze({ server: SERVICE_WORKER_ENVIRONMENT_NAME }),
    });
    expect(resolveReactWorkerRscOptions(options)).toEqual({
      environments: {
        server: SERVICE_WORKER_ENVIRONMENT_NAME,
        client: 'client',
      },
    });
    expect(options.environments).toEqual({
      server: SERVICE_WORKER_ENVIRONMENT_NAME,
    });
  });

  it.each([
    { environments: { server: 'server' } },
    { environments: { server: '' } },
    { environments: { client: 'browser' } },
    { environments: { client: 1 } },
    { environments: { worker: 'workerSSR' } },
    { environments: null },
    { environments: [] },
    null,
    'true',
  ])('rejects conflicting or invalid native options %j', options => {
    expect(() => resolveReactWorkerRscOptions(options)).toThrow(TypeError);
  });

  it('rejects conflicting inherited native mappings as the native plugin reads them', () => {
    const environments = Object.create({ server: 'server' });
    expect(() => resolveReactWorkerRscOptions({ environments })).toThrow(
      `environments.server to be ${SERVICE_WORKER_ENVIRONMENT_NAME}`,
    );
  });
});

function rules(config: Rspack.Configuration) {
  return (config.module?.rules ?? []).filter(
    (rule): rule is Rspack.RuleSetRule =>
      typeof rule === 'object' && rule !== null,
  );
}

async function inspectNativeRsc(workerIntegration: boolean) {
  const options = resolveReactWorkerRscOptions(true);
  if (!options) throw new Error('Enabled RSC did not resolve its environments');
  const nativePlugins = await getRscPlugins(
    true,
    path.join(__dirname, 'internal'),
    options.environments,
  );
  const entry = path.join(__dirname, 'react-rsc-worker-integration.test.ts');
  const rsbuild = await createRsbuild({
    cwd: __dirname,
    rsbuildConfig: {
      mode: 'production',
      output: { cleanDistPath: false },
      tools: { htmlPlugin: false },
      environments: {
        client: {
          source: { entry: { main: entry } },
          output: { target: 'web' },
        },
        [SERVICE_WORKER_ENVIRONMENT_NAME]: {
          source: { entry: { main: entry } },
          output: { target: 'web', module: true },
        },
      },
      plugins: [
        ...nativePlugins,
        ...(workerIntegration ? [createReactRscWorkerBuilderPlugin()] : []),
      ],
    },
  });
  const configs = await rsbuild.initConfigs();
  return { configs, normalized: rsbuild.getNormalizedConfig() };
}

describe('actual native RSC configuration without compilation', () => {
  it('demonstrates the native RSC global default changes the worker target to node', async () => {
    const { normalized } = await inspectNativeRsc(false);
    expect(
      normalized.environments[SERVICE_WORKER_ENVIRONMENT_NAME]?.output.target,
    ).toBe('node');
  });

  it('restores only the worker target and ESM output while keeping native RSC plugins and layers', async () => {
    const { configs, normalized } = await inspectNativeRsc(true);
    expect(Object.keys(normalized.environments).sort()).toEqual(
      ['client', SERVICE_WORKER_ENVIRONMENT_NAME].sort(),
    );
    expect(
      normalized.environments[SERVICE_WORKER_ENVIRONMENT_NAME]?.output,
    ).toMatchObject({ target: 'web', module: true });
    expect(normalized.environments.client?.output).toMatchObject({
      target: 'web',
      module: false,
    });
    const worker = configs.find(
      config => config.name === SERVICE_WORKER_ENVIRONMENT_NAME,
    );
    const client = configs.find(config => config.name === 'client');
    if (!worker || !client)
      throw new Error('Native RSC environments are missing');
    expect(worker.target).not.toContain('node');
    expect(worker.output).toMatchObject({ module: true });
    expect(worker.entry).toMatchObject({
      main: { layer: rspack.experiments.rsc.Layers.ssr },
    });
    expect(
      worker.plugins?.some(
        plugin => plugin?.constructor.name === 'ServerPlugin',
      ),
    ).toBe(true);
    expect(
      client.plugins?.some(
        plugin => plugin?.constructor.name === 'ClientPlugin',
      ),
    ).toBe(true);
    expect(rules(worker)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ layer: rspack.experiments.rsc.Layers.rsc }),
        expect.objectContaining({ layer: 'rsc-common' }),
      ]),
    );
    expect(worker.resolve?.alias).toMatchObject({
      '@modern-js/render/rsc$': '@modern-js/render/rsc-worker',
    });
    expect(
      rules(worker).some(rule =>
        Array.isArray(rule.use)
          ? rule.use.some(
              use =>
                typeof use === 'object' &&
                use !== null &&
                'loader' in use &&
                String(use.loader).includes('rsc-server-entry-loader'),
            )
          : false,
      ),
    ).toBe(true);
    expect(JSON.stringify(worker.entry)).not.toContain(
      '__MODERN_JS_ENTRY_NAME',
    );
    expect(JSON.stringify(client.entry)).toContain('__MODERN_JS_ENTRY_NAME');
  });
});

it('compiles and runs Flight and HTML SSR with their own React exports in one worker', async () => {
  const appDirectory = fs.realpathSync(
    fs.mkdtempSync(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'worker-rsc-react-'),
    ),
  );
  let closeBuild: (() => Promise<void>) | undefined;
  let compiler: Rspack.Compiler | Rspack.MultiCompiler | undefined;
  try {
    const renderOwner = fs.realpathSync(
      path.resolve(__dirname, '../../../../runtime/render'),
    );
    const renderRequire = createRequire(path.join(renderOwner, 'package.json'));
    const owners: Record<string, string> = { '@modern-js/render': renderOwner };
    const dependencies: Record<string, string> = {};
    for (const name of [
      'react',
      'react-dom',
      'react-server-dom-rspack',
      '@modern-js/render',
    ]) {
      const owner =
        name === '@modern-js/render'
          ? renderOwner
          : path.dirname(renderRequire.resolve(`${name}/package.json`));
      const manifest = JSON.parse(
        fs.readFileSync(path.join(owner, 'package.json'), 'utf8'),
      );
      expect(manifest.name).toBe(name);
      owners[name] = owner;
      dependencies[name] = manifest.version;
      const dependency = path.join(appDirectory, 'node_modules', name);
      fs.mkdirSync(path.dirname(dependency), { recursive: true });
      fs.symlinkSync(owner, dependency, 'dir');
    }
    fs.writeFileSync(
      path.join(appDirectory, 'package.json'),
      JSON.stringify({
        name: 'worker-rsc-react-proof',
        private: true,
        type: 'module',
        dependencies,
      }),
    );
    const sourceDirectory = path.join(appDirectory, 'src');
    fs.mkdirSync(sourceDirectory);
    const clientEntry = path.join(sourceDirectory, 'client.js');
    const workerEntry = path.join(sourceDirectory, 'index.server.js');
    const clientComponent = path.join(sourceDirectory, 'ClientMarker.js');
    const loaderClientEntry = path.join(sourceDirectory, 'loaders.client.js');
    const loaderWorkerEntry = path.join(
      sourceDirectory,
      'server-loader-combined.js',
    );
    fs.writeFileSync(
      clientComponent,
      `
      'use client';
      import { jsx } from 'react/jsx-runtime';
      export function ClientMarker() { return jsx('span', { children: 'client marker' }); }
    `,
    );
    fs.writeFileSync(loaderClientEntry, 'export const loaderOnly = true;\n');
    fs.writeFileSync(
      loaderWorkerEntry,
      'export function manifest() { return __rspack_rsc_manifest__; }\n',
    );
    fs.writeFileSync(
      clientEntry,
      `
      import { useState } from 'react';
      import { jsx } from 'react/jsx-runtime';
      export function Client() { const [value] = useState('client'); return jsx('p', { children: value }); }
    `,
    );
    const appComponent = path.join(sourceDirectory, 'App.js');
    fs.writeFileSync(
      appComponent,
      `
      import { jsx } from 'react/jsx-runtime';
      import { ClientMarker } from './ClientMarker.js';
      export default function App() { return jsx('p', { children: ['Flight server React', jsx(ClientMarker, {})] }); }
    `,
    );
    // Use the owning native proxy producer and its proxy → component boundary.
    fs.writeFileSync(
      path.join(sourceDirectory, 'AppProxy.js'),
      AppProxyForRSC({
        srcDirectory: sourceDirectory,
        internalSrcAlias: '.',
        entry: appComponent,
      }),
    );
    fs.writeFileSync(
      workerEntry,
      `
      import { createElement, Fragment, useState } from 'react';
      import { renderToReadableStream } from 'react-dom/server.edge';
      import { RSCServerSlot } from '@modern-js/render/client';
      import { renderRsc } from '@modern-js/render/rsc-worker';
      import { renderSSRStream } from '@modern-js/render/ssr';
      import Root from './AppProxy.js';
      function HtmlRoot({ children }) { const [value] = useState('HTML SSR default React'); return createElement(Fragment, null, createElement('p', null, value), children); }
      export async function html() { return new Response(await renderToReadableStream(createElement(HtmlRoot))); }
      export function flight() { return new Response(renderRsc({ element: createElement(Root) })); }
      export function manifest() { return __rspack_rsc_manifest__; }
      export default {
        async fetch(request) {
          const stream = await renderSSRStream(createElement(HtmlRoot, null, createElement(RSCServerSlot)), {
            request,
            rscRoot: createElement(Root),
            rscManifest: __rspack_rsc_manifest__,
          });
          const allReady = stream.allReady;
          const allReadyIsPromise = allReady instanceof Promise;
          await allReady;
          const transport = new TransformStream();
          const [bytes] = await Promise.all([
            new Response(transport.readable).arrayBuffer(),
            stream.pipeTo(transport.writable),
          ]);
          return new Response(bytes, { headers: {
            'content-type': 'text/html; charset=utf-8',
            'x-test-all-ready-promise': String(allReadyIsPromise),
            'x-test-all-ready-identity': String(stream.allReady === allReady),
          } });
        },
      };
    `,
    );
    const options = resolveReactWorkerRscOptions(true);
    if (!options) throw new Error('Enabled RSC has no environments');
    // A real compiler must load the owning builder's emitted Node loaders.
    // Source configuration tests above do not activate those loader files.
    const builderRequire = createRequire(
      path.resolve(__dirname, '../../../../cli/builder/package.json'),
    );
    const {
      getRscPlugins: emittedGetRscPlugins,
    }: typeof import('../../../../cli/builder/src/plugins/rscConfig') =
      builderRequire('./dist/cjs/plugins/rscConfig.js');
    const nativePlugins = await emittedGetRscPlugins(
      true,
      path.join(appDirectory, '.modern-js'),
      options.environments,
    );
    const workerOutput = path.join(appDirectory, 'dist/worker');
    const rsbuild = await createRsbuild({
      cwd: appDirectory,
      rsbuildConfig: {
        mode: 'production',
        output: {
          minify: false,
          filename: { js: '[name].mjs' },
          distPath: { js: '' },
        },
        tools: { htmlPlugin: false },
        environments: getCloudflareBuilderEnvironments({
          appContext: {
            appDirectory,
            apiDirectory: path.join(appDirectory, 'api'),
          },
          normalizedConfig: {
            deploy: { target: 'cloudflare' },
            server: { rsc: options },
          },
          environments: {
            client: {
              source: {
                entry: {
                  main: clientEntry,
                  'index-server-loaders': loaderClientEntry,
                },
              },
              output: {
                target: 'web',
                filename: { js: '[name].js' },
                distPath: { root: path.join(appDirectory, 'dist/client') },
              },
            },
            [SERVICE_WORKER_ENVIRONMENT_NAME]: {
              source: {
                entry: {
                  main: workerEntry,
                  'index-server-loaders': loaderWorkerEntry,
                },
              },
              output: {
                target: 'web',
                module: true,
                distPath: { root: workerOutput },
              },
            },
          },
        }),
        plugins: [...nativePlugins, createReactRscWorkerBuilderPlugin()],
      },
    });
    rsbuild.onAfterCreateCompiler(({ compiler: created }) => {
      compiler = created;
    });
    const result = await rsbuild.build();
    closeBuild = result.close;
    if (!result.stats)
      throw new Error('Native RSC build produced no compilation stats');
    const stats = 'stats' in result.stats ? result.stats.stats : [result.stats];
    const worker = stats.find(
      stat => stat.compilation.name === SERVICE_WORKER_ENVIRONMENT_NAME,
    );
    const client = stats.find(stat => stat.compilation.name === 'client');
    if (!worker || !client)
      throw new Error('Native RSC compiled environments are missing');
    // Use the generator's declared simulator, as the packed worker proof does.
    const generatorRequire = createRequire(
      path.resolve(
        __dirname,
        '../../../../toolkit/ultramodern-create/package.json',
      ),
    );
    const miniflareEntry = generatorRequire.resolve('miniflare');
    // Execute emitted ESM with ordinary Node before inspecting optimized graphs.
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
      import { pathToFileURL } from 'node:url';
      import fs from 'node:fs';
      import path from 'node:path';
      const worker = await import(pathToFileURL(process.argv[1]).href);
      const loaders = await import(pathToFileURL(process.argv[2]).href);
      const html = await worker.html();
      const flight = await worker.flight();
      const responses = { htmlStatus: html.status, html: await html.text(), flightStatus: flight.status, flight: await flight.text(), mainManifest: worker.manifest(), loaderManifest: loaders.manifest() };
      const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(pathToFileURL(process.argv[3]).href);
      const modulesRoot = path.dirname(process.argv[1]);
      const modulePaths = [process.argv[1], ...fs.readdirSync(modulesRoot, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile() && /\\.(?:c|m)?js$/u.test(entry.name))
        .map(entry => path.join(entry.parentPath, entry.name))
        .filter(file => file !== process.argv[1])
        .sort()];
      const miniflare = new Miniflare(convertV4MiniflareOptions({
        rootPath: process.cwd(),
        log: new Log(LogLevel.ERROR),
        workers: [{
          name: 'native-rsc-ssr-proof',
          modules: modulePaths.map(file => ({ type: file.endsWith('.cjs') ? 'CommonJS' : 'ESModule', path: file })),
          modulesRoot,
          compatibilityDate: '2025-01-01',
          compatibilityFlags: ['nodejs_compat'],
        }],
      }));
      try {
        await miniflare.ready;
        const response = await miniflare.dispatchFetch('https://rsc-ssr-proof.invalid/');
        responses.workerdHTMLStatus = response.status;
        responses.workerdHTML = await response.text();
        responses.workerdReadyPromise = response.headers.get('x-test-all-ready-promise');
        responses.workerdReadyIdentity = response.headers.get('x-test-all-ready-identity');
      } finally {
        await miniflare.dispose();
      }
      console.log(JSON.stringify(responses));
    `,
        path.join(workerOutput, 'main.mjs'),
        path.join(workerOutput, 'index-server-loaders.mjs'),
        miniflareEntry,
      ],
      {
        encoding: 'utf8',
        timeout: 20_000,
        cwd: appDirectory,
        env: { ...process.env, TMPDIR: appDirectory },
      },
    );
    const responses = JSON.parse(output.trim());
    expect(responses.htmlStatus).toBe(200);
    expect(responses.html).toContain('<p>HTML SSR default React</p>');
    expect(responses.flightStatus).toBe(200);
    expect(responses.flight).toContain('Flight server React');
    expect(responses.flight).not.toMatch(/\d+:E\{/u);
    expect(responses.flight).toMatch(/\d+:I\[/u);
    expect(responses.flight).toContain('ClientMarker');
    // Native workerd receivers reject prototype facades that Node accepts.
    expect({
      status: responses.workerdHTMLStatus,
      html: responses.workerdHTML,
    }).toEqual({
      status: 200,
      html: expect.stringContaining('<span>client marker</span>'),
    });
    expect(responses.workerdHTML).toContain('<p>HTML SSR default React</p>');
    expect(responses.workerdHTML).toContain('Flight server React');
    expect(responses.workerdHTML).toContain('self.__FLIGHT_DATA');
    expect(responses.workerdHTML).toContain('ClientMarker');
    expect(responses.workerdReadyPromise).toBe('true');
    expect(responses.workerdReadyIdentity).toBe('true');
    // The native serializer accepts either an export ID or its module ID.
    expect(
      responses.mainManifest.clientManifest[
        `${clientComponent}#ClientMarker`
      ] ?? responses.mainManifest.clientManifest[clientComponent],
    ).toMatchObject({ id: expect.any(String), chunks: expect.any(Array) });
    expect(responses.mainManifest.serverConsumerModuleMap).not.toEqual({});
    expect(responses.loaderManifest.clientManifest).toEqual({});
    expect(responses.loaderManifest.serverConsumerModuleMap).toEqual({});
    expect(responses.mainManifest.entryJsFiles).not.toEqual(
      responses.loaderManifest.entryJsFiles,
    );
    const modules = (stat: Rspack.Stats) => {
      const visited = new Set<Rspack.Module>();
      const pending = [...stat.compilation.modules];
      while (pending.length) {
        const module = pending.pop()!;
        if (visited.has(module)) continue;
        visited.add(module);
        if (module instanceof rspack.ConcatenatedModule) {
          pending.push(...module.modules);
        }
      }
      return [...visited];
    };
    const includes = (stat: Rspack.Stats, resource: string, layer?: string) =>
      modules(stat).some(
        module =>
          module instanceof rspack.NormalModule &&
          module.resource === resource &&
          (layer === undefined || module.layer === layer),
      );
    expect(
      includes(worker, appComponent, rspack.experiments.rsc.Layers.rsc),
    ).toBe(true);
    for (const [packageName, file, layer] of [
      ['react', 'react.react-server.js', rspack.experiments.rsc.Layers.rsc],
      [
        'react',
        'jsx-runtime.react-server.js',
        rspack.experiments.rsc.Layers.rsc,
      ],
      [
        'react-dom',
        'react-dom.react-server.js',
        rspack.experiments.rsc.Layers.rsc,
      ],
      ['react', 'index.js', rspack.experiments.rsc.Layers.ssr],
      ['react-dom', 'server.edge.js', rspack.experiments.rsc.Layers.ssr],
    ]) {
      const resource = path.join(owners[packageName], file);
      if (!includes(worker, resource, layer)) {
        const actual = modules(worker)
          .filter(module =>
            /react|AppProxy|rscWorker/u.test(module.nameForCondition() ?? ''),
          )
          .map(module => ({
            resource:
              module instanceof rspack.NormalModule
                ? module.resource
                : module.nameForCondition(),
            layer: module.layer,
            type: module.constructor.name,
            issuer: worker.compilation.moduleGraph
              .getIssuer(module)
              ?.nameForCondition(),
          }));
        throw new Error(
          `Missing compiled ${packageName}/${file} in layer ${layer}: ${resource}\nActual React module graph: ${JSON.stringify(actual, null, 2)}\nEmitted responses: ${JSON.stringify(responses)}`,
        );
      }
    }
    expect(includes(client, path.join(owners.react, 'index.js'))).toBe(true);
    expect(includes(client, path.join(owners.react, 'jsx-runtime.js'))).toBe(
      true,
    );
    expect(
      includes(client, path.join(owners.react, 'react.react-server.js')),
    ).toBe(false);
  } finally {
    try {
      if (closeBuild) await closeBuild();
      else if (compiler) {
        await new Promise<void>((resolve, reject) => {
          compiler!.close(error => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
    }
  }
}, 30_000);
