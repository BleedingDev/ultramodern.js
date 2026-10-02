import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppTools } from '@modern-js/app-tools';
import { createUltramodernReleaseBuildMarker } from '@modern-js/app-tools-extensions/release-identity';
import { createConfigOptions } from '@modern-js/plugin/cli';
import {
  createPresetUltramodernWorkspaceConfig,
  presetUltramodernWorkspace,
  ultramodernAppTools,
} from '@modern-js/ultramodern-app-tools';

const fixture = () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-workspace-policy-')),
  );
  const makeApp = (id: string, kind = 'vertical') => ({
    id,
    kind,
    path: `${kind === 'shell' ? 'apps' : 'verticals'}/${id}`,
    package: `@acme/${id}`,
    portEnv: `${id.toUpperCase()}_PORT`,
    ...(kind === 'shell' ? { verticalRefs: ['catalog'] } : {}),
    moduleFederation: {
      name: kind === 'shell' ? 'shellSuperApp' : 'verticalCatalog',
      exposes: kind === 'shell' ? [] : ['./Route', './ProductCard'],
    },
    ...(kind === 'shell'
      ? {}
      : { api: { bff: { prefix: '/catalog-api' }, protocol: 'rest' } }),
    deliveryUnit: {
      unitId: `acme/${id}`,
      buildMarker: '0123456789abcdef',
      packageName: `@acme/${id}`,
      version: '0.1.0',
    },
    cloudflare: {
      workerName: `acme-${id}`,
      publicUrlEnv: `ULTRAMODERN_PUBLIC_URL_${id.toUpperCase()}`,
      compatibilityDate: '2026-06-02',
      security: {
        enabled: true,
        contentSecurityPolicy: { mode: 'report-only' },
      },
    },
  });
  const topology = {
    schemaVersion: 1,
    shell: makeApp('shell', 'shell'),
    shells: [makeApp('admin', 'shell')],
    verticals: [makeApp('catalog')],
  };
  const overlay = {
    schemaVersion: 1,
    ports: { shell: 3020, admin: 3021, catalog: 3030 },
  };
  const writeJson = (filename: string, value: unknown) => {
    const target = path.join(root, filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value));
  };
  const save = () => {
    writeJson('topology/reference-topology.json', topology);
    writeJson('topology/local-overlays/development.json', overlay);
  };
  for (const app of [
    topology.shell,
    ...topology.shells,
    ...topology.verticals,
  ]) {
    writeJson(`${app.path}/package.json`, {
      name: app.package,
      version: '0.1.0',
    });
  }
  save();
  return {
    root,
    topology,
    overlay,
    save,
    writeJson,
    options: (id = 'shell') => ({
      appId: id,
      from: pathToFileURL(
        path.join(
          root,
          id === 'catalog'
            ? 'verticals/catalog/modern.config.ts'
            : `apps/${id}/modern.config.ts`,
        ),
      ),
      environment: {},
      deployTarget: 'node' as const,
    }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

describe('native workspace build policy', () => {
  it('keeps shell assets relative and remote assets absolute, independently of site origin', () => {
    const workspace = fixture();
    try {
      const shell = createPresetUltramodernWorkspaceConfig(workspace.options());
      const remote = createPresetUltramodernWorkspaceConfig({
        ...workspace.options('catalog'),
        environment: {
          MODERN_PUBLIC_SITE_URL: 'https://site.example',
          CATALOG_PORT: '4030',
        },
      });
      expect(shell.output?.assetPrefix).toBe('/');
      expect(shell.dev?.assetPrefix).toBe('/');
      expect(remote.output?.assetPrefix).toBe('http://localhost:4030/');
      expect(remote.dev?.assetPrefix).toBe('http://localhost:4030/');
      expect(remote.source?.globalVars?.ULTRAMODERN_SITE_URL).toBe(
        'https://site.example',
      );
      expect(remote.server?.port).toBe(4030);
      expect(remote.dev?.server?.cors).toEqual({
        origin: [
          'http://localhost:3020',
          'http://localhost:3021',
          'http://localhost:4030',
        ],
      });
    } finally {
      workspace.cleanup();
    }
  });

  it('isolates Cloudflare artifacts and uses native automatic remote public paths without a public URL', () => {
    const workspace = fixture();
    try {
      const node = createPresetUltramodernWorkspaceConfig(
        workspace.options('catalog'),
      );
      const cloudflare = createPresetUltramodernWorkspaceConfig({
        ...workspace.options('catalog'),
        deployTarget: 'cloudflare',
      });
      expect(node.output?.distPath?.root).toBe('dist');
      expect(cloudflare.output?.assetPrefix).toBe('auto');
      expect(cloudflare.output?.distPath?.root).toBe('dist-cloudflare');
      expect(cloudflare.output?.tempDir).toBe(
        'node_modules/.modern-js-catalog-cloudflare',
      );
      expect(cloudflare.performance?.buildCache).toEqual({
        cacheDigest: ['catalog', 'cloudflare'],
        cacheDirectory: 'node_modules/.cache/rspack-catalog-cloudflare',
      });
      expect(cloudflare.deploy?.worker).toMatchObject({
        name: 'acme-catalog',
        compatibilityDate: '2026-06-02',
        ssr: true,
      });
    } finally {
      workspace.cleanup();
    }
  });

  it('resolves deployment URLs and asset overrides using the same precedence as generated apps', () => {
    const workspace = fixture();
    try {
      const inferred = createPresetUltramodernWorkspaceConfig({
        ...workspace.options('catalog'),
        deployTarget: 'cloudflare',
        environment: { ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN: 'acme' },
      });
      expect(inferred.output?.assetPrefix).toBe(
        'https://acme-catalog.acme.workers.dev/',
      );
      expect(inferred.source?.globalVars?.ULTRAMODERN_SITE_URL).toBe(
        'https://acme-catalog.acme.workers.dev',
      );
      const configured = createPresetUltramodernWorkspaceConfig({
        ...workspace.options('catalog'),
        deployTarget: 'cloudflare',
        environment: {
          ULTRAMODERN_PUBLIC_URL_CATALOG: 'https://catalog.example',
          MODERN_PUBLIC_SITE_URL: 'https://shell.example',
          ULTRAMODERN_ASSET_PREFIX: 'https://fallback.example/',
          MODERN_ASSET_PREFIX: 'https://assets.example/',
        },
      });
      expect(configured.output?.assetPrefix).toBe('https://assets.example/');
      expect(configured.source?.globalVars?.ULTRAMODERN_SITE_URL).toBe(
        'https://shell.example',
      );
    } finally {
      workspace.cleanup();
    }
  });

  it('reads topology updates for each app without rewriting its config or broadening shell references', () => {
    const workspace = fixture();
    try {
      workspace.topology.shells[0].verticalRefs = [];
      workspace.save();
      const options = {
        ...workspace.options(),
        deployTarget: 'cloudflare' as const,
        environment: {
          VERTICAL_CATALOG_WORKER_BINDING: 'CATALOG',
          VERTICAL_CATALOG_WORKER_NAME: 'catalog-preview',
        },
      };
      const services =
        createPresetUltramodernWorkspaceConfig(options).deploy?.worker
          ?.services;
      expect(services).toEqual([
        {
          binding: 'CATALOG',
          service: 'catalog-preview',
          prefix: '/catalog-api',
          fragments: [
            {
              boundaryId: 'verticalCatalog',
              expose: './ProductCard',
              path: '/{locale}/_mf/fragment/product-card',
              remote: 'catalog',
            },
          ],
        },
      ]);
      expect(
        createPresetUltramodernWorkspaceConfig({
          ...workspace.options('admin'),
          deployTarget: 'cloudflare',
        }).deploy?.worker?.services,
      ).toBeUndefined();
      workspace.topology.verticals[0].moduleFederation.exposes.push(
        './CartSummary',
      );
      workspace.save();
      expect(
        createPresetUltramodernWorkspaceConfig(
          options,
        ).deploy?.worker?.services?.[0].fragments?.map(
          fragment => fragment.expose,
        ),
      ).toEqual(['./CartSummary', './ProductCard']);
    } finally {
      workspace.cleanup();
    }
  });

  it('uses canonical derived port variables and reads authored federation exposes with the shared parser', () => {
    const workspace = fixture();
    try {
      delete (workspace.topology.verticals[0] as { portEnv?: string }).portEnv;
      workspace.save();
      fs.writeFileSync(
        path.join(
          workspace.root,
          'verticals/catalog/module-federation.config.ts',
        ),
        `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
export default createModuleFederationConfig({ exposes: { './AuthoredWidget': './src/authored-widget.tsx' } });`,
      );
      const config = createPresetUltramodernWorkspaceConfig({
        ...workspace.options(),
        deployTarget: 'cloudflare',
        environment: { VERTICAL_CATALOG_PORT: '4033' },
      });
      expect(config.dev?.server?.cors).toMatchObject({
        origin: [
          'http://localhost:3020',
          'http://localhost:3021',
          'http://localhost:4033',
        ],
      });
      expect(config.deploy?.worker?.services?.[0].fragments).toEqual([
        {
          boundaryId: 'verticalCatalog',
          expose: './AuthoredWidget',
          path: '/{locale}/_mf/fragment/authored-widget',
          remote: 'catalog',
        },
      ]);
    } finally {
      workspace.cleanup();
    }
  });

  it.each([
    `['./Route', './AuthoredWidget']`,
    `{ './Route': routeSource, './AuthoredWidget': widgetSource }`,
  ])(
    'keeps authored expose names independently of source-path inspection: %s',
    exposes => {
      const workspace = fixture();
      try {
        fs.writeFileSync(
          path.join(
            workspace.root,
            'verticals/catalog/module-federation.config.ts',
          ),
          `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
const routeSource = './src/route.tsx';
const widgetSource = './src/authored-widget.tsx';
export default createModuleFederationConfig({ exposes: ${exposes} });`,
        );
        const config = createPresetUltramodernWorkspaceConfig({
          ...workspace.options(),
          deployTarget: 'cloudflare',
        });
        expect(
          config.deploy?.worker?.services?.[0].fragments?.map(
            fragment => fragment.expose,
          ),
        ).toEqual(['./AuthoredWidget']);
      } finally {
        workspace.cleanup();
      }
    },
  );

  it('uses an authored deploy.target before environment target and composes consumer hooks after native policy', () => {
    const workspace = fixture();
    try {
      const consumerPlugin = { name: 'consumer-plugin', setup() {} };
      const options = workspace.options('catalog');
      const { deployTarget: _target, ...nativeOptions } = options;
      const calls: string[] = [];
      const authored = {
        deploy: { target: 'node' as const },
        html: { title: 'Consumer title' },
        server: { port: 5099 },
        output: { assetPrefix: '/authored/', precompress: false },
        source: { globalVars: { CONSUMER_SETTING: true } },
        plugins: [consumerPlugin],
        tools: {
          bundlerChain: () => {
            calls.push('consumer');
          },
        },
      };
      const composed = presetUltramodernWorkspace(authored, {
        ...nativeOptions,
        environment: { MODERNJS_DEPLOY: 'cloudflare' },
      });
      expect(composed.output).toMatchObject({
        assetPrefix: '/authored/',
        precompress: false,
        distPath: { root: 'dist' },
      });
      expect(composed.server?.port).toBe(5099);
      expect(composed.html?.title).toBe('Consumer title');
      expect(composed.source?.globalVars).toMatchObject({
        CONSUMER_SETTING: true,
        ULTRAMODERN_SITE_URL: 'http://localhost:3030',
      });
      expect(composed.plugins?.at(-1)).toBe(consumerPlugin);
      expect(authored.output).toEqual({
        assetPrefix: '/authored/',
        precompress: false,
      });
      const output = {
        uniqueName(value: string) {
          calls.push(value);
          return output;
        },
        chunkLoadingGlobal(value: string) {
          calls.push(value);
          return output;
        },
      };
      const chain = {
        get: () => path.join(workspace.root, 'verticals/catalog'),
        plugins: new Set(),
        resolve: { alias: new Map() },
        output,
      };
      const hooks = composed.tools!.bundlerChain;
      for (const hook of Array.isArray(hooks) ? hooks : [hooks]) {
        (hook as Function)(chain, {
          isProd: true,
          CHAIN_ID: { PLUGIN: { TS_CHECKER: 'checker' } },
        });
      }
      expect(calls).toEqual([
        'verticalCatalog',
        '__ULTRAMODERN_VERTICAL_CATALOG_LOADED_CHUNKS__',
        'consumer',
      ]);
    } finally {
      workspace.cleanup();
    }
  });

  it('keeps an explicit empty build environment independent of process deployment variables', () => {
    const workspace = fixture();
    const previous = process.env.MODERNJS_DEPLOY;
    try {
      process.env.MODERNJS_DEPLOY = 'cloudflare';
      const { deployTarget: _target, ...options } = workspace.options();
      const config = createPresetUltramodernWorkspaceConfig(options);
      expect(config.output?.distPath?.root).toBe('dist');
      expect(config.deploy?.worker).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.MODERNJS_DEPLOY;
      else process.env.MODERNJS_DEPLOY = previous;
      workspace.cleanup();
    }
  });

  it('loads async native federation config with env and command while preserving authored worker settings', async () => {
    const workspace = fixture();
    const previousEnvironment = process.env.NODE_ENV;
    const previousArguments = process.env.MODERN_ARGV;
    try {
      process.env.NODE_ENV = 'production';
      process.env.MODERN_ARGV = 'node modern build';
      fs.writeFileSync(
        path.join(workspace.root, 'verticals/catalog/mf-base.ts'),
        `export default { name: 'verticalCatalog' };`,
      );
      fs.writeFileSync(
        path.join(
          workspace.root,
          'verticals/catalog/module-federation.config.ts',
        ),
        `import base from './mf-base';
export default async ({ env, command }) => {
  await Promise.resolve();
  const exposes = {
    './Route': './src/route.tsx',
    [\`./\${env}-\${command}-Card\`]: './src/new-card.tsx',
  };
  return { ...base, exposes };
};`,
      );
      const authoredService = { binding: 'CUSTOM', service: 'authored-worker' };
      const composed = presetUltramodernWorkspace(
        {
          plugins: [
            ultramodernAppTools({
              rendererExtensions: false,
              serverExtensions: false,
            }),
          ],
          deploy: {
            worker: {
              name: 'authored-shell',
              services: [authoredService],
              wrangler: { vars: { KEEP: 'authored-value' } },
            },
          },
        },
        {
          ...workspace.options(),
          deployTarget: 'cloudflare',
        },
      );
      // Dynamic metadata is resolved by the native CLI lifecycle, with no
      // provisional binding built from obsolete generator-time expose names.
      expect(composed.deploy?.worker?.services).toEqual([authoredService]);
      const resolved = await createConfigOptions<AppTools>({
        command: 'build',
        configFile: false,
        cwd: path.join(workspace.root, 'apps/shell'),
        config: composed,
      });
      expect(resolved.config.deploy.worker).toMatchObject({
        name: 'authored-shell',
        wrangler: { vars: { KEEP: 'authored-value' } },
        services: [
          {
            binding: 'VERTICAL_CATALOG_WORKER',
            service: 'acme-catalog',
            prefix: '/catalog-api',
            fragments: [
              {
                boundaryId: 'verticalCatalog',
                expose: './production-build-Card',
                path: '/{locale}/_mf/fragment/production-build-card',
                remote: 'catalog',
              },
            ],
          },
          authoredService,
        ],
      });
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      if (previousArguments === undefined) delete process.env.MODERN_ARGV;
      else process.env.MODERN_ARGV = previousArguments;
      workspace.cleanup();
    }
  });

  it('derives release identity from the selected workspace and retains typed feature opt outs', () => {
    const workspace = fixture();
    try {
      const revision = 'a'.repeat(40);
      const config = createPresetUltramodernWorkspaceConfig({
        ...workspace.options('catalog'),
        environment: { ULTRAMODERN_SOURCE_REVISION: revision },
        enableTelemetry: false,
        enableModuleFederationSSR: false,
        enableBffRequestId: false,
      });
      expect(config.source?.globalVars).toMatchObject({
        ULTRAMODERN_SOURCE_REVISION: revision,
        ULTRAMODERN_BUILD_MARKER: createUltramodernReleaseBuildMarker({
          generationBuildMarker: '0123456789abcdef',
          sourceRevision: revision,
          unitId: 'acme/catalog',
        }),
        ULTRAMODERN_RELEASE_VERSION: '0.1.0',
      });
      expect(config.server?.telemetry).toBeUndefined();
      expect(config.server?.ssr).toBeUndefined();
      expect(config.bff).toBeUndefined();
    } finally {
      workspace.cleanup();
    }
  });

  it('keeps Zephyr optional, requires fail-build deploy policy, and resolves only the app uploader', async () => {
    const workspace = fixture();
    try {
      const registrations: unknown[] = [];
      const setup = async (environment: Record<string, string>) => {
        const config = createPresetUltramodernWorkspaceConfig({
          ...workspace.options('catalog'),
          environment,
        });
        const plugin = config.plugins!.find(
          plugin => plugin.name === 'ultramodern-zephyr-rspack-plugin',
        )!;
        await plugin.setup!({
          modifyRspackConfig: (handler: unknown) => registrations.push(handler),
        } as any);
      };
      await setup({});
      expect(registrations).toEqual([]);
      await expect(setup({ ZE_CI_TOKEN: 'fixture-token' })).rejects.toThrow(
        'ZE_FAIL_BUILD',
      );
      workspace.writeJson(
        'verticals/catalog/node_modules/zephyr-rspack-plugin/package.json',
        { name: 'zephyr-rspack-plugin', main: 'index.cjs' },
      );
      fs.writeFileSync(
        path.join(
          workspace.root,
          'verticals/catalog/node_modules/zephyr-rspack-plugin/index.cjs',
        ),
        'exports.withZephyr = () => config => ({ ...config, uploaded: true });',
      );
      const previousFailBuild = process.env.ZE_FAIL_BUILD;
      await setup({ ZE_CI_TOKEN: 'fixture-token', ZE_FAIL_BUILD: 'true' });
      expect(registrations).toHaveLength(1);
      expect((registrations[0] as Function)({ original: true })).toEqual({
        original: true,
        uploaded: true,
      });
      expect(process.env.ZE_FAIL_BUILD).toBe(previousFailBuild);
    } finally {
      workspace.cleanup();
    }
  });

  it('never registers browser Zephyr for headless units and rejects inconsistent app identity and ports', () => {
    const workspace = fixture();
    try {
      Object.assign(workspace.topology.verticals[0], {
        surfaceProfile: 'api-only',
      });
      workspace.save();
      expect(
        createPresetUltramodernWorkspaceConfig(
          workspace.options('catalog'),
        ).plugins?.some(
          plugin => plugin.name === 'ultramodern-zephyr-rspack-plugin',
        ),
      ).toBe(false);
      expect(() =>
        createPresetUltramodernWorkspaceConfig({
          ...workspace.options(),
          appId: 'unknown',
        }),
      ).toThrow('Unknown app');
      expect(() =>
        createPresetUltramodernWorkspaceConfig({
          ...workspace.options('catalog'),
          environment: { CATALOG_PORT: 'not-a-port' },
        }),
      ).toThrow('Invalid development port');
      workspace.writeJson('verticals/catalog/package.json', {
        name: '@acme/other',
        version: '0.1.0',
      });
      expect(() =>
        createPresetUltramodernWorkspaceConfig(workspace.options('catalog')),
      ).toThrow('Package identity');
    } finally {
      workspace.cleanup();
    }
  });
});
