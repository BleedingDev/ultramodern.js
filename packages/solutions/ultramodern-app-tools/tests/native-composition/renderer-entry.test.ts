import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { rspack } from '@rsbuild/core';
import {
  createNativeEntryGenerator,
  createNativeEntryStubGenerator,
  emitNativeEntryApplication,
} from '../../src/native-composition/native-entry';
import type { NativeEntryGeneration } from '../../src/native-composition/native-infrastructure';
import { NATIVE_FEDERATION_HYDRATION_MODULE } from '../../src/native-composition/native-module-federation';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';

describe('native owning entry generation', () => {
  const fixtures: string[] = [];
  afterEach(async () => {
    await Promise.all(
      fixtures
        .splice(0)
        .map(directory => fs.rm(directory, { recursive: true, force: true })),
    );
  });

  async function expectValidNativeSource(source: string, tsx = false) {
    await expect(
      rspack.experiments.swc.transform(source, {
        jsc: { parser: { syntax: 'typescript', tsx }, target: 'es2022' },
        configFile: false,
        swcrc: false,
      }),
    ).resolves.toMatchObject({ code: expect.any(String) });
  }

  async function context(renderer: 'solid' | 'octane', routed = false) {
    const appDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ultramodern-native-entry-'),
    );
    fixtures.push(appDirectory);
    const directory = path.join(appDirectory, 'src');
    await fs.mkdir(directory);
    const entry = routed
      ? path.join(directory, 'routes')
      : path.join(directory, 'App.tsx');
    if (routed) {
      await fs.mkdir(entry);
      await fs.writeFile(
        path.join(entry, 'layout.tsx'),
        'export default function Layout() { return <main/> }',
      );
      await fs.writeFile(
        path.join(entry, 'page.tsx'),
        'export default function Page() { return <p/> }',
      );
    } else {
      await fs.writeFile(
        entry,
        'export default function NativeApp() { return <button>Native view</button> }',
      );
    }
    const rendererIdentity: RendererIdentity = {
      renderer,
      appId: 'native-entry-fixture',
      entryName: 'main',
      protocolVersion: 1,
      buildId: 'input-profile-content-digest',
    };
    const generation: NativeEntryGeneration & {
      rendererIdentity: RendererIdentity;
    } = {
      renderer,
      rendererIdentity,
      profile: resolveRendererProfile(renderer),
      documentSSR: true,
      basePath: '/',
      appDirectory,
      internalDirectory: path.join(appDirectory, '.modern-js'),
      entrypoint: {
        entry,
        entryName: 'main',
        isMainEntry: true,
        isAutoMount: true,
      },
      modifyRoutes: async routes => routes,
    };
    return generation;
  }

  it('rejects missing or conflicting identities before writing any generated source', async () => {
    const generation = await context('solid');
    const generator = createNativeEntryGenerator('solid');
    const missing = { ...generation, rendererIdentity: undefined };
    await expect(generator.client(missing)).rejects.toThrow(
      'resolved immutable build identity',
    );
    await expect(fs.stat(generation.internalDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      generator.server({
        ...generation,
        rendererIdentity: {
          ...generation.rendererIdentity,
          entryName: 'another',
        },
      }),
    ).rejects.toThrow('resolved immutable build identity');
    await expect(fs.stat(generation.internalDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects an unregistered renderer instead of emitting another renderer bootstrap', () => {
    expect(() =>
      Reflect.apply(createNativeEntryGenerator, undefined, ['unregistered']),
    ).toThrow('Unsupported UltraModern renderer');
  });

  it('rejects a context owned by another renderer before writing source', async () => {
    const generation = await context('octane');
    await expect(
      createNativeEntryStubGenerator('solid').client(generation),
    ).rejects.toThrow('Native generator renderer conflict');
    await expect(fs.stat(generation.internalDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('passes the hook-modified graph and analyzed base path to the generated application module', async () => {
    const generation = await context('solid', true);
    generation.basePath = '/catalog';
    let projections = 0;
    generation.modifyRoutes = async routes => {
      projections += 1;
      return [
        {
          ...routes[0],
          id: 'selected-layout',
          children: [
            {
              id: 'hook-product',
              path: ':product',
              file: '/selected/product.tsx',
              modules: { data: '/selected/product.data.ts' },
              children: [],
            },
          ],
        },
      ];
    };
    const sources: Record<string, string> = {};
    for (const mode of ['client', 'server'] as const) {
      const { directory, routed } = await emitNativeEntryApplication(
        generation,
        mode,
      );
      expect(routed).toBe(true);
      sources[mode] = await fs.readFile(
        path.join(directory, `app.${mode}.ts`),
        'utf8',
      );
      await expectValidNativeSource(sources[mode]);
      expect(sources[mode]).toContain('export const basePath = "/catalog";');
      expect(sources[mode]).toContain('"hook-product"');
      expect(sources[mode]).toContain(
        `import * as routeModule1 from ${JSON.stringify('/selected/product.tsx')};`,
      );
    }
    expect(projections).toBe(1);
    // Server data stays out of the client graph.
    expect(sources.server).toContain(
      JSON.stringify('/selected/product.data.ts'),
    );
    expect(sources.client).not.toContain('/selected/product.data.ts');
    expect(sources.client).toContain('server-data:hook-product');
    expect(sources.client).toContain(
      'export const serverDataRoutes = ["hook-product"];',
    );
  });

  it.each(['solid', 'octane'] as const)(
    'emits %s entry stubs that pass only data to the renderer runtime',
    async renderer => {
      const generation = await context(renderer);
      const before = await fs.readFile(generation.entrypoint.entry, 'utf8');
      const generator = createNativeEntryGenerator(renderer);
      const client = await generator.client(generation);
      const server = await generator.server(generation);
      await expectValidNativeSource(client);
      await expectValidNativeSource(server);
      const generated = path.join(
        generation.internalDirectory,
        renderer,
        'main',
      );
      for (const file of ['app.client.ts', 'app.server.ts']) {
        const source = await fs.readFile(path.join(generated, file), 'utf8');
        await expectValidNativeSource(source);
        expect(source).toBe(
          `export { default } from ${JSON.stringify(generation.entrypoint.entry)};\n`,
        );
      }
      expect(await fs.readFile(generation.entrypoint.entry, 'utf8')).toBe(
        before,
      );
      const identity = JSON.stringify(generation.rendererIdentity);
      expect(client).toContain(
        `import { startNativeClient } from "@modern-js/renderer-${renderer}/entry-client";`,
      );
      expect(client).toContain(`identity: ${identity},`);
      expect(client).toContain('load: () => import("./app.client"),');
      expect(client).toContain('hot: import.meta.webpackHot,');
      expect(server).toContain(
        `import { createNativeServerEntry } from "@modern-js/renderer-${renderer}/entry-server";`,
      );
      expect(server).toContain(
        'export const { rendererIdentity, nativeRequestHandler, nativeCSRRequestHandler, nativeMatchRouteIds } = createNativeServerEntry({',
      );
      expect(server).toContain(`identity: ${identity},`);
      expect(server).toContain('app: () => import("./app.server"),');
      for (const source of [client, server]) {
        expect(source).not.toMatch(/react-router|react-dom|@tanstack\/react/u);
        expect(source).not.toContain('i18n');
        // Lifecycle and request handling live in typed runtime modules.
        expect(source).not.toMatch(/assertRendererIdentity|function |=>\s*\{/u);
      }
      if (renderer === 'octane') {
        // Octane hydration bytes belong to this exact native client compilation.
        expect(client).toContain('declare const __webpack_hash__: string;');
        expect(client).toContain('nativeHydrationBuildId: __webpack_hash__,');
      } else {
        expect(client).not.toContain('__webpack_hash__');
      }
    },
  );

  it.each(['solid', 'octane'] as const)(
    'projects the %s route hook once for a single client/server emission transaction',
    async renderer => {
      const generation = await context(renderer, true);
      let projections = 0;
      generation.modifyRoutes = async routes => {
        projections += 1;
        return [
          {
            ...routes[0],
            children: routes[0].children.map(route => ({
              ...route,
              id: `hook-${route.id}`,
            })),
          },
        ];
      };
      const generator = createNativeEntryGenerator(renderer);
      const client = await generator.client(generation);
      const server = await generator.server(generation);
      expect(projections).toBe(1);
      await expectValidNativeSource(client);
      await expectValidNativeSource(server);
      for (const mode of ['client', 'server']) {
        const source = await fs.readFile(
          path.join(
            generation.internalDirectory,
            renderer,
            'main',
            `app.${mode}.ts`,
          ),
          'utf8',
        );
        expect(source).toContain('hook-page');
        expect(source).toContain('export const routeModules = {');
        await expectValidNativeSource(source);
      }
    },
  );

  it.each(['solid', 'octane'] as const)(
    'passes the generated %s i18n module to both entries',
    async renderer => {
      const generation = await context(renderer, true);
      await fs.mkdir(path.join(generation.appDirectory, 'locales/en'), {
        recursive: true,
      });
      const translation = path.join(
        generation.appDirectory,
        'locales/en/translation.json',
      );
      await fs.writeFile(translation, '{"title":"Hello"}');
      generation.i18n = {
        languages: ['en', 'cs'],
        fallbackLanguage: 'en',
        detect: true,
        detection: {},
        ignoreRedirectRoutes: [],
        backend: { enabled: true },
        initOptions: {},
        basePath: '/',
        resources: { en: { translation } },
      };
      const generator = createNativeEntryGenerator(renderer);
      for (const source of [
        await generator.client(generation),
        await generator.server(generation),
      ]) {
        await expectValidNativeSource(source);
        expect(source).toContain('import { i18n } from "./i18n";');
        expect(source).toMatch(/^ {2}i18n,$/mu);
      }
      const i18n = await fs.readFile(
        path.join(generation.internalDirectory, renderer, 'main', 'i18n.ts'),
        'utf8',
      );
      await expectValidNativeSource(i18n);
      expect(i18n).toContain(
        'import { createNativeI18n } from "@modern-js/i18n-runtime-extensions/native";',
      );
      expect(i18n).toContain(
        `"translation": () => import(${JSON.stringify(translation)}),`,
      );
    },
  );

  it('starts a federated Solid server entry through an import() boundary', async () => {
    const generation = await context('solid', true);
    await fs.writeFile(
      path.join(generation.appDirectory, 'module-federation.config.ts'),
      "export default { name: 'host' };",
    );
    const server = await createNativeEntryGenerator('solid').server(generation);
    await expectValidNativeSource(server);
    // The facade imports no shared runtime before the share scope starts.
    expect(server).not.toMatch(/^import (?!type )/mu);
    expect(server).toContain("import('./handlers.server')");
    expect(server).toContain(
      `export const rendererIdentity = Object.freeze(${JSON.stringify(generation.rendererIdentity)});`,
    );
    for (const handler of [
      'nativeCSRRequestHandler',
      'nativeRequestHandler',
      'nativeMatchRouteIds',
    ])
      expect(server).toContain(`export async function ${handler}(`);
    const handlers = await fs.readFile(
      path.join(
        generation.internalDirectory,
        'solid',
        'main',
        'handlers.server.ts',
      ),
      'utf8',
    );
    expect(handlers).toContain('createNativeServerEntry({');
    // The server names its own client module that hydrates its remotes.
    expect(handlers).toContain(
      `federation: { instance: () => __webpack_require__.federation.instance, hydrationModule: ${JSON.stringify(NATIVE_FEDERATION_HYDRATION_MODULE)} },`,
    );
  });
});
