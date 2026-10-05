import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  discoverNativeFileSystemRoutes,
  emitNativeRouteModule,
} from '../../src/native-composition/native-routes';

describe('native filesystem route source emission', () => {
  const fixtures: string[] = [];
  afterEach(async () => {
    await Promise.all(
      fixtures
        .splice(0)
        .map(directory => fs.rm(directory, { recursive: true, force: true })),
    );
  });

  async function fixture(files: readonly string[]) {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ultramodern-native-routes-'),
    );
    fixtures.push(directory);
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(directory, file)), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(directory, file),
        'export default function NativeView() {}',
      );
    }
    return directory;
  }

  it('preserves layout hierarchy, pathless, dotted, optional, splat and native extension references', async () => {
    const routesDirectory = await fixture([
      'layout.tsrx',
      'layout.data.ts',
      'layout.head.ts',
      'page.tsrx',
      'page.search.ts',
      'page.head.ts',
      '__auth/layout.tsrx',
      '__auth/[id]$/page.tsrx',
      '__auth/[id$]/page.tsrx',
      'user.profile/page.tsrx',
      'user.profile/loading.tsrx',
      'user.profile/error.tsrx',
      'user.profile/not-found.tsrx',
      '$.tsrx',
      'assets/mark.svg',
      'components/Helper.tsx',
    ]);
    const [root] = await discoverNativeFileSystemRoutes({
      routesDirectory,
      entryName: 'admin',
      extensions: ['.tsrx', '.tsx', '.ts'],
    });
    expect(root).toMatchObject({ id: 'admin_layout', path: '/', isRoot: true });
    expect(root.file).toBe(path.join(routesDirectory, 'layout.tsrx'));
    expect(root.modules?.data).toBe(
      path.join(routesDirectory, 'layout.data.ts'),
    );
    expect(root.modules?.head).toBe(
      path.join(routesDirectory, 'layout.head.ts'),
    );
    expect(root.children.find(route => route.index)?.modules?.search).toBe(
      path.join(routesDirectory, 'page.search.ts'),
    );
    expect(root.children.find(route => route.index)?.modules?.head).toBe(
      path.join(routesDirectory, 'page.head.ts'),
    );
    const pathless = root.children.find(
      route => route.id === 'admin___auth/layout',
    )!;
    expect(pathless.path).toBeUndefined();
    expect(
      pathless.children.find(route => route.id === 'admin___auth/(id)$/layout'),
    ).toMatchObject({
      id: 'admin___auth/(id)$/layout',
      path: ':id?',
    });
    expect(
      pathless.children.find(route => route.id === 'admin___auth/(id$)/layout'),
    ).toMatchObject({
      id: 'admin___auth/(id$)/layout',
      path: ':id?',
    });
    const dotted = root.children.find(route => route.path === 'user/profile')!;
    expect(dotted.modules).toMatchObject({
      loading: path.join(routesDirectory, 'user.profile/loading.tsrx'),
      error: path.join(routesDirectory, 'user.profile/error.tsrx'),
      notFound: path.join(routesDirectory, 'user.profile/not-found.tsrx'),
    });
    expect(root.children.find(route => route.path === '*')).toMatchObject({
      id: 'admin_$',
    });
    expect(root.children).toHaveLength(4);
  });

  it('rejects ambiguous source modules instead of silently choosing one compiler input', async () => {
    const routesDirectory = await fixture([
      'layout.tsx',
      'page.tsx',
      'page.tsrx',
    ]);
    await expect(
      discoverNativeFileSystemRoutes({
        routesDirectory,
        entryName: 'main',
        extensions: ['.tsx', '.tsrx'],
      }),
    ).rejects.toThrow('Ambiguous native route module');
  });

  it('rejects unsupported static optional notation before emitting a literal question-mark route', async () => {
    const routesDirectory = await fixture(['layout.tsx', 'product$/page.tsx']);
    await expect(
      discoverNativeFileSystemRoutes({
        routesDirectory,
        entryName: 'main',
        extensions: ['.tsx', '.ts'],
      }),
    ).rejects.toThrow('require a bracketed parameter: product$');
  });

  it('rejects an unknown renderer before emitting another native runtime', () => {
    const options = {
      renderer: 'unknown-renderer',
      routes: [],
      mode: 'server',
      basePath: '/',
    } as const;
    expect(() => {
      // Runtime inputs must fail closed even when they bypass the renderer type.
      // @ts-expect-error Exercise an unsupported runtime renderer.
      emitNativeRouteModule(options);
    }).toThrow(/renderer.*unknown-renderer/iu);
  });

  it.each([
    'solid',
    'octane',
  ] as const)('separates %s server data source from client graph and preserves native data authorization metadata', async renderer => {
    const routesDirectory = await fixture([
      'layout.tsx',
      'page.tsx',
      'page.data.ts',
      'page.head.ts',
      'not-found.tsx',
      '[product]/page.tsx',
      '[product]/page.data.ts',
      '[product]/page.data.client.ts',
    ]);
    const routes = await discoverNativeFileSystemRoutes({
      routesDirectory,
      entryName: 'main',
      extensions: ['.tsx', '.ts'],
    });
    const client = emitNativeRouteModule({
      renderer,
      routes,
      mode: 'client',
      basePath: '/admin',
    });
    const server = emitNativeRouteModule({
      renderer,
      routes,
      mode: 'server',
      basePath: '/admin',
    });
    expect(client).not.toContain(
      JSON.stringify(path.join(routesDirectory, 'page.data.ts')),
    );
    expect(client).not.toContain(
      JSON.stringify(path.join(routesDirectory, '[product]/page.data.ts')),
    );
    expect(client).toContain(
      JSON.stringify(
        path.join(routesDirectory, '[product]/page.data.client.ts'),
      ),
    );
    expect(client).toContain('server-data:page');
    expect(client).toContain('createDataClient(route.id, identity).loader');
    expect(server).toContain(
      JSON.stringify(path.join(routesDirectory, 'page.data.ts')),
    );
    expect(server).not.toContain(
      `from ${JSON.stringify(path.join(routesDirectory, '[product]/page.data.client.ts'))}`,
    );
    expect(server).toContain('invokeRouteData(module.loader, input)');
    for (const source of [client, server]) {
      expect(source).toContain('basepath: "/admin"');
      if (renderer === 'octane') {
        // TanStack only stamps $_TSR scripts with router.options.ssr.nonce.
        expect(source).toContain('nonce?: string): AnyRouter');
        expect(source).toContain('{ ssr: { nonce } }');
      }
      expect(source).toContain('notFoundComponent:');
      expect(source).toContain('head:');
      expect(source).toContain(`@modern-js/renderer-${renderer}/router`);
      expect(source).not.toMatch(
        /react-router|@tanstack\/react|react\/|react-dom/u,
      );
    }
  });
});
