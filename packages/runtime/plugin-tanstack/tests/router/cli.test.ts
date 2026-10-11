import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { compile } from '@modern-js/server-utils';
import type { Entrypoint } from '@modern-js/types';
import { fs } from '@modern-js/utils';
import { tanstackRouterPlugin, writeTanstackRegisterFile } from '../../src/cli';

const execFileAsync = promisify(execFile);
const strictestTsconfigPath = path.resolve(
  __dirname,
  '../../node_modules/@tsconfig/strictest/tsconfig.json',
);

function createAppContextApi<T extends object>(initial: T) {
  let context: T & { serverCompileExcludedFiles?: string[] } = { ...initial };
  return {
    getAppContext: () => context,
    updateAppContext: (update: Partial<typeof context>) => {
      context = { ...context, ...update };
    },
  };
}

/**
 * Compiles the generated registration output with TypeScript 7 under
 * @tsconfig/strictest — the way a consumer's own type check would see it.
 */
async function typecheckGeneratedRegistration(options: {
  entries: string[];
  generatedDirName: string;
  srcDirectory: string;
  i18nRuntimeModule?: string;
  canonicalTypeChecks?: string[];
}) {
  const {
    entries,
    generatedDirName,
    srcDirectory,
    i18nRuntimeModule,
    canonicalTypeChecks = [],
  } = options;
  const runtimeModule = '@modern-js/plugin-tanstack/runtime';
  const projectDirectory = path.dirname(srcDirectory);

  for (const entry of entries) {
    const routerPath = path.join(
      srcDirectory,
      generatedDirName,
      entry,
      'router.gen.ts',
    );
    if (!(await fs.pathExists(routerPath))) {
      await fs.outputFile(routerPath, 'export const router = { context: {} };');
    }
  }

  const runtimeDeclaration = [
    `declare module '${runtimeModule}' {`,
    '  export interface Register {}',
    '  export type ModernRouterContext = { request?: Request; requestContext?: unknown };',
    '  type RouteOptions = { getParentRoute?: (...args: never[]) => unknown; id?: string; loader?: (...args: never[]) => unknown; path?: string; staticData?: unknown };',
    '  type Route<TOptions extends RouteOptions = RouteOptions> = { options: TOptions; addChildren<const TChildren extends readonly unknown[]>(children: TChildren): Route<TOptions> & { children: TChildren } };',
    '  export function createMemoryHistory<TOptions>(options: TOptions): TOptions;',
    '  export function createRootRouteWithContext<TContext extends ModernRouterContext>(): <const TOptions extends RouteOptions>(options: TOptions) => Route<TOptions>;',
    '  export function createRoute<const TOptions extends RouteOptions>(options: TOptions): Route<TOptions>;',
    '  export function createRouter<const TOptions extends { context: ModernRouterContext; routeTree: unknown }>(options: TOptions): TOptions;',
    '  export function createRouteStaticData<const TData extends Record<string, unknown>>(data: TData): TData;',
    '  export function modernLoaderToTanstack<TLoader extends (...args: never[]) => unknown>(options: { hasSplat: boolean }, loader: TLoader): (context: unknown) => Promise<Awaited<ReturnType<TLoader>>>;',
    '  export const modernTanstackRouterFastDefaults: Record<string, unknown>;',
    '}',
    ...(i18nRuntimeModule
      ? [
          `declare module '${i18nRuntimeModule}' { export interface UltramodernCanonicalRoutes {} }`,
        ]
      : []),
  ];
  await fs.outputFile(
    path.join(srcDirectory, 'generated-runtime-shim.d.ts'),
    runtimeDeclaration.join('\n'),
  );

  await fs.outputFile(
    path.join(srcDirectory, 'registration-contract.ts'),
    [
      `import type { Register } from '${runtimeModule}';`,
      ...entries.flatMap((entry, index) => [
        `import { router as router${index} } from './${generatedDirName}/${entry}/router.gen';`,
        `const registeredRouter${index}: Register['router'] = router${index};`,
        `void registeredRouter${index};`,
      ]),
      ...canonicalTypeChecks,
    ].join('\n'),
  );
  await fs.outputJSON(path.join(projectDirectory, 'tsconfig.json'), {
    extends: strictestTsconfigPath,
    compilerOptions: {
      lib: ['ESNext', 'DOM'],
      module: 'Preserve',
      moduleResolution: 'Bundler',
      noEmit: true,
      target: 'ESNext',
      types: [],
    },
    include: ['src/**/*.ts', 'src/**/*.d.ts'],
  });

  const compilerPackagePath = createRequire(import.meta.url).resolve(
    'typescript/package.json',
  );
  const compilerPackage = await fs.readJson(compilerPackagePath);
  const compilerPath = path.resolve(
    path.dirname(compilerPackagePath),
    compilerPackage.bin.tsc,
  );

  try {
    await execFileAsync(
      process.execPath,
      [compilerPath, '-p', 'tsconfig.json'],
      { cwd: projectDirectory },
    );
  } catch (error: any) {
    const output = error?.stderr || error?.stdout;
    throw typeof output === 'string'
      ? new Error(output, { cause: error })
      : error;
  }
}

const runtimeCliMocks = {
  handleGeneratorEntryCode: rstest.fn(),
};

rstest.mock('@modern-js/runtime/cli', () => {
  const routesDirMetaKey = '__modernRoutesDir';
  // The codegen helpers are pure — forward to the real implementations.
  const actualCli = rstest.requireActual('@modern-js/runtime/cli') as {
    getPathWithoutExt: (filename: string) => string;
    makeLegalIdentifier: (value: string) => string;
  };

  return {
    __esModule: true,
    getPathWithoutExt: actualCli.getPathWithoutExt,
    makeLegalIdentifier: actualCli.makeLegalIdentifier,
    getEntrypointRoutesDir: (entrypoint: any) =>
      entrypoint[routesDirMetaKey] ||
      (entrypoint.nestedRoutesEntry
        ? path.basename(entrypoint.nestedRoutesEntry)
        : null),
    getEntrypointRoutesOwner: (entrypoint: any) =>
      entrypoint.__modernRoutesOwner || null,
    // Forward through an arrow: the mock factory is hoisted above the
    // `runtimeCliMocks` initializer, so it must not dereference it eagerly.
    handleGeneratorEntryCode: (...args: unknown[]) =>
      runtimeCliMocks.handleGeneratorEntryCode(...args),
    handleFileChange: async () => {},
    handleModifyEntrypoints: async (entrypoints: Entrypoint[]) => entrypoints,
    isRouteEntry: () => false,
    updateNestedRoutesSpec: async () => {},
  };
});

describe('tanstack router cli plugin', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    runtimeCliMocks.handleGeneratorEntryCode.mockReset();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  test('excludes its generated declaration from server roots only when installed', async () => {
    tempDir = await fs.realpath(
      await mkdtemp(path.join(tmpdir(), 'tanstack-server-roots-')),
    );
    const srcDirectory = path.join(tempDir, 'src');
    const declaration = path.join(
      srcDirectory,
      'modern-tanstack',
      'register.gen.d.ts',
    );
    const apiDirectory = path.join(tempDir, 'api');
    const compileOptions = {
      sourceDirs: [apiDirectory],
      distDir: path.join(tempDir, 'dist'),
      tsconfigPath: path.join(tempDir, 'tsconfig.json'),
      throwErrorInsteadOfExit: true,
    };
    await fs.outputJSON(compileOptions.tsconfigPath, {
      compilerOptions: {
        module: 'commonjs',
        target: 'ES2022',
        types: [],
        noEmitOnError: true,
        skipLibCheck: false,
      },
      include: ['api', 'src'],
    });
    await fs.outputFile(
      path.join(apiDirectory, 'index.ts'),
      'export const server = true;\n',
    );
    await fs.outputFile(
      path.join(srcDirectory, 'routes/page.tsx'),
      "import type { Missing } from 'missing-browser-only-types';\nexport const page: Missing = undefined;\n",
    );
    await fs.outputFile(
      path.join(srcDirectory, 'modern-tanstack', 'main/router.gen.ts'),
      "import { page } from '../../routes/page';\nexport const router = { page };\n",
    );
    await writeTanstackRegisterFile({ entries: ['main'], srcDirectory });

    await expect(compile(tempDir, {}, compileOptions)).rejects.toThrow(
      /missing-browser-only-types/,
    );

    const previousExclusions = [path.join(tempDir, 'other-client.d.ts')];
    const api = {
      ...createAppContextApi({
        srcDirectory,
        serverCompileExcludedFiles: previousExclusions,
      }),
      _internalRuntimePlugins: () => {},
      checkEntryPoint: () => {},
      config: () => {},
      modifyEntrypoints: () => {},
      generateEntryCode: () => {},
      onFileChanged: () => {},
      modifyFileSystemRoutes: () => {},
      onBeforeGenerateRoutes: () => {},
    };
    tanstackRouterPlugin().setup!(api as never);
    const excludeFiles = api.getAppContext().serverCompileExcludedFiles;
    expect(excludeFiles).toEqual([...previousExclusions, declaration]);
    await compile(tempDir, {}, { ...compileOptions, excludeFiles });
    expect(
      await fs.pathExists(path.join(compileOptions.distDir, 'api/index.js')),
    ).toBe(true);
    expect(await fs.pathExists(path.join(compileOptions.distDir, 'src'))).toBe(
      false,
    );
  });

  test('installs the TanStack router only for entrypoints it owns', () => {
    const taps: Record<string, any> = {};
    const api = {
      ...createAppContextApi({
        srcDirectory: '/tmp/app/src',
        metaName: 'modern-js',
        serverRoutes: [
          { entryName: 'custom', urlPath: '/' },
          { entryName: 'home', urlPath: '/' },
        ],
      }),
      _internalRuntimePlugins: (tap: any) => {
        taps.internalRuntimePlugins = tap;
      },
      checkEntryPoint: () => {},
      config: () => {},
      modifyEntrypoints: () => {},
      generateEntryCode: () => {},
      onFileChanged: () => {},
      modifyFileSystemRoutes: () => {},
      onBeforeGenerateRoutes: () => {},
    };

    tanstackRouterPlugin({ routesDir: 'ts-routes' }).setup!(api as any);

    // Custom entry without a routes dir (e.g. `createRoutes` in
    // modern.runtime.ts): installing the plugin is the explicit opt-in, so
    // the wrapper plus the provider registration is injected through the
    // package's own runtime/router module.
    const customEntrypoint = {
      entryName: 'custom',
      isAutoMount: true,
    } as Entrypoint;
    const tanstackRouterEntry = {
      name: 'router',
      path: '@modern-js/plugin-tanstack/runtime/router',
      config: { serverBase: ['/'] },
    };
    expect(
      taps.internalRuntimePlugins({ entrypoint: customEntrypoint, plugins: [] })
        .plugins,
    ).toEqual([tanstackRouterEntry]);

    // If the built-in router CLI already installed the internal router for
    // this custom entry (explicit `runtime.router` config), only the module
    // path is redirected — pushing a second entry installs two routers.
    const builtInPlugin = {
      name: 'router',
      path: '@modern-js/runtime/router/internal',
      config: { serverBase: ['/'] },
    };
    expect(
      taps.internalRuntimePlugins({
        entrypoint: customEntrypoint,
        plugins: [builtInPlugin],
      }).plugins,
    ).toEqual([tanstackRouterEntry]);

    // A classic react-router file-route entry (src/<entry>/routes) living
    // next to the TanStack entries: its internal router plugin must be left
    // untouched — redirecting it would pull @tanstack/react-router into a
    // pure react-router bundle.
    expect(
      taps.internalRuntimePlugins({
        entrypoint: {
          entryName: 'home',
          isAutoMount: true,
          nestedRoutesEntry: '/tmp/app/src/home/routes',
          __modernRoutesDir: 'routes',
        } as Entrypoint,
        plugins: [builtInPlugin],
      }).plugins,
    ).toEqual([builtInPlugin]);

    // An entry tagged by another routes-owner plugin: nothing is pushed.
    expect(
      taps.internalRuntimePlugins({
        entrypoint: {
          entryName: 'home',
          isAutoMount: true,
          nestedRoutesEntry: '/tmp/app/src/home/acme-routes',
          __modernRoutesDir: 'acme-routes',
          __modernRoutesOwner: '@acme/plugin-file-router',
        } as Entrypoint,
        plugins: [],
      }).plugins,
    ).toEqual([]);
  });

  test('emits the plugin-i18n augmentation only when plugin-i18n is registered', async () => {
    const langRoutes = [
      {
        type: 'nested',
        id: 'layout',
        isRoot: true,
        children: [
          {
            type: 'nested',
            id: '(lang)/layout',
            path: ':lang',
            children: [
              {
                type: 'nested',
                id: '(lang)/about/page',
                path: 'about',
              },
            ],
          },
        ],
      },
    ];

    const runGenerate = async (registeredPlugins: Array<{ name: string }>) => {
      const dir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-cli-'));
      const srcDirectory = path.join(dir, 'src');
      const entrypoint = {
        entryName: 'main',
        isAutoMount: true,
        isMainEntry: true,
        nestedRoutesEntry: path.join(srcDirectory, 'routes'),
        __modernRoutesDir: 'routes',
      } as Entrypoint;
      runtimeCliMocks.handleGeneratorEntryCode.mockResolvedValueOnce({
        main: langRoutes,
      });

      const taps: Record<string, any> = {};
      const api = {
        ...createAppContextApi({
          srcDirectory,
          internalSrcAlias: '@/_',
          entrypoints: [entrypoint],
          plugins: registeredPlugins,
        }),
        _internalRuntimePlugins: () => {},
        checkEntryPoint: () => {},
        config: () => {},
        modifyEntrypoints: () => {},
        generateEntryCode: (tap: any) => {
          taps.generateEntryCode = tap;
        },
        onFileChanged: () => {},
        modifyFileSystemRoutes: () => {},
        onBeforeGenerateRoutes: () => {},
      };

      tanstackRouterPlugin().setup!(api as any);
      await taps.generateEntryCode({ entrypoints: [entrypoint] });

      const hasI18n = registeredPlugins.some(
        plugin => plugin.name === '@modern-js/plugin-i18n',
      );
      await typecheckGeneratedRegistration({
        entries: ['main'],
        generatedDirName: 'modern-tanstack',
        srcDirectory,
        ...(hasI18n && {
          i18nRuntimeModule: '@modern-js/plugin-i18n/runtime',
        }),
        canonicalTypeChecks: hasI18n
          ? [
              "import type { UltramodernCanonicalRoutes } from '@modern-js/plugin-i18n/runtime';",
              "const aboutParams: UltramodernCanonicalRoutes['/about'] = {};",
              'void aboutParams;',
            ]
          : [],
      });
      await rm(dir, { recursive: true, force: true });
    };

    // A hand-rolled `/:lang/` app WITHOUT plugin-i18n must not get the
    // augmentation — it would reference an unresolvable module (TS2664).
    await runGenerate([{ name: '@modern-js/app-tools' }]);

    // With plugin-i18n registered the canonical route map is emitted.
    await runGenerate([
      { name: '@modern-js/app-tools' },
      { name: '@modern-js/plugin-i18n' },
    ]);
  });
});
