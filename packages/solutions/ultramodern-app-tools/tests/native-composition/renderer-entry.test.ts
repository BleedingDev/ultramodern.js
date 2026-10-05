import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { rspack } from '@rsbuild/core';
import {
  createNativeEntryGenerator,
  emitNativeEntryApplication,
  type NativeApplicationEmission,
} from '../../src/native-composition/native-entry';
import type { NativeEntryGeneration } from '../../src/native-composition/native-infrastructure';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';
import { createSolidNativeEntryGenerator } from '../../src/renderers/solid/entry';

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
    ).toThrow('Unsupported UltraModern native renderer');
  });

  it('rejects a context owned by another renderer before writing source', async () => {
    const generation = await context('octane');
    await expect(
      createSolidNativeEntryGenerator().client(generation),
    ).rejects.toThrow('Native generator renderer conflict');
    await expect(fs.stat(generation.internalDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('passes the hook-modified graph and analyzed base path to the selected source emitter', async () => {
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
    const applications: Parameters<
      NativeApplicationEmission['applicationSource']
    >[0][] = [];
    const routeEmissions: Parameters<
      NativeApplicationEmission['routeSource']
    >[0][] = [];
    const emission: NativeApplicationEmission = {
      applicationSource(options) {
        applications.push(options);
        return `selected application ${options.mode}`;
      },
      routeSource(options) {
        routeEmissions.push(options);
        return `selected routes ${options.mode}`;
      },
    };
    for (const mode of ['client', 'server'] as const) {
      const { directory } = await emitNativeEntryApplication(
        generation,
        mode,
        emission,
      );
      expect(
        await fs.readFile(path.join(directory, `routes.${mode}.ts`), 'utf8'),
      ).toBe(`selected routes ${mode}`);
      expect(
        await fs.readFile(
          path.join(directory, `application.${mode}.tsx`),
          'utf8',
        ),
      ).toBe(`selected application ${mode}`);
    }
    expect(projections).toBe(1);
    expect(applications).toEqual(
      ['client', 'server'].map(mode => ({
        source: generation.entrypoint.entry,
        routed: true,
        mode,
      })),
    );
    expect(
      routeEmissions.map(({ mode, basePath }) => ({ mode, basePath })),
    ).toEqual([
      { mode: 'client', basePath: '/catalog' },
      { mode: 'server', basePath: '/catalog' },
    ]);
    expect(routeEmissions[0].routes).toBe(routeEmissions[1].routes);
    expect(routeEmissions[0].routes).toMatchObject([
      {
        id: 'selected-layout',
        children: [
          {
            id: 'hook-product',
            path: ':product',
            file: '/selected/product.tsx',
            modules: { data: '/selected/product.data.ts' },
          },
        ],
      },
    ]);
  });

  it.each([
    'solid',
    'octane',
  ] as const)('emits syntactically valid %s native entry modules without rewriting the authored view', async renderer => {
    const generation = await context(renderer);
    const before = await fs.readFile(generation.entrypoint.entry, 'utf8');
    const generator = createNativeEntryGenerator(renderer);
    const client = await generator.client(generation);
    const server = await generator.server(generation);
    await expectValidNativeSource(client);
    await expectValidNativeSource(server);
    const generated = path.join(generation.internalDirectory, renderer, 'main');
    for (const file of ['application.client.tsx', 'application.server.tsx']) {
      const source = await fs.readFile(path.join(generated, file), 'utf8');
      await expectValidNativeSource(source, true);
      expect(source).toContain(JSON.stringify(generation.entrypoint.entry));
    }
    expect(await fs.readFile(generation.entrypoint.entry, 'utf8')).toBe(before);
    expect(server).toContain('nativeRequestHandler');
    expect(server).toContain('nativeCSRRequestHandler');
    expect(server).toContain(JSON.stringify(generation.rendererIdentity));
    expect(client).not.toMatch(/react-router|react-dom|@tanstack\/react/u);
    if (renderer === 'octane') {
      // The compiler manifest is validated once per manifest object, not per request.
      expect(server).toContain('const validatedManifests = new WeakMap');
      expect(server).toContain('nativeManifest(context.nativeManifest)');
      expect(server.match(/validateOctaneModuleManifest\(/gu)).toHaveLength(1);
    }
  });

  it.each([
    'solid',
    'octane',
  ] as const)('projects the %s route hook once for a single client/server emission transaction', async renderer => {
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
          `routes.${mode}.ts`,
        ),
        'utf8',
      );
      expect(source).toContain('hook-page');
      await expectValidNativeSource(source);
    }
    expect(server).toContain('selectApplicationDataRoute');
    expect(server).toContain('nativeMatchRouteIds');
    if (renderer === 'octane') {
      // Route ids must be matched through the router's basepath rewrite.
      expect(server).toContain('matchApplicationRoutes(router, new URL(');
      expect(server).not.toContain('router.matchRoutes(');
      // The request CSP nonce reaches the router that emits $_TSR scripts.
      expect(server).toContain('}, context.nonce);');
    }
  });

  it('matches Solid SSR route ids from the basepath-rewritten native location', async () => {
    const generation = await context('solid', true);
    generation.basePath = '/admin';
    const server = await createSolidNativeEntryGenerator().server(generation);
    await expectValidNativeSource(server);
    // A raw request pathname keeps the basepath the native router rewrites away.
    expect(server).toContain('router.matchRoutes(router.latestLocation)');
    expect(server).not.toContain('new URL(request.url).pathname');
    // The document nonce reaches the per-request router's emitted scripts.
    expect(server).toContain('context.session, context.nonce)');
  });
});
