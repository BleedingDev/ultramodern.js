import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { parseSync } from '@swc/core';
import { createNativeEntryGenerator } from '../../src/native-composition/native-entry';
import type { NativeEntryGeneration } from '../../src/native-composition/native-infrastructure';
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

  it.each([
    'solid',
    'octane',
  ] as const)('emits syntactically valid %s native entry modules without rewriting the authored view', async renderer => {
    const generation = await context(renderer);
    const before = await fs.readFile(generation.entrypoint.entry, 'utf8');
    const generator = createNativeEntryGenerator(renderer);
    const client = await generator.client(generation);
    const server = await generator.server(generation);
    expect(() =>
      parseSync(client, { syntax: 'typescript', target: 'es2022' }),
    ).not.toThrow();
    expect(() =>
      parseSync(server, { syntax: 'typescript', target: 'es2022' }),
    ).not.toThrow();
    const generated = path.join(generation.internalDirectory, renderer, 'main');
    for (const file of ['application.client.tsx', 'application.server.tsx']) {
      const source = await fs.readFile(path.join(generated, file), 'utf8');
      expect(() =>
        parseSync(source, {
          syntax: 'typescript',
          tsx: true,
          target: 'es2022',
        }),
      ).not.toThrow();
      expect(source).toContain(JSON.stringify(generation.entrypoint.entry));
    }
    expect(await fs.readFile(generation.entrypoint.entry, 'utf8')).toBe(before);
    expect(server).toContain('nativeRequestHandler');
    expect(server).toContain('nativeCSRRequestHandler');
    expect(server).toContain(JSON.stringify(generation.rendererIdentity));
    expect(client).not.toMatch(/react-router|react-dom|@tanstack\/react/u);
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
    expect(() =>
      parseSync(client, { syntax: 'typescript', target: 'es2022' }),
    ).not.toThrow();
    expect(() =>
      parseSync(server, { syntax: 'typescript', target: 'es2022' }),
    ).not.toThrow();
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
      expect(() =>
        parseSync(source, { syntax: 'typescript', target: 'es2022' }),
      ).not.toThrow();
    }
    expect(server).toContain('selectApplicationDataRoute');
    expect(server).toContain('nativeMatchRouteIds');
  });
});
