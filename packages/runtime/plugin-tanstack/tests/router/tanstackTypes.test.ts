import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { applyLocalisedUrlsToRoutes } from '@modern-js/i18n-runtime-extensions';
import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { writeTanstackRegisterFile } from '../../src/cli/artifacts';
import {
  collectCanonicalRoutesForEntry,
  generateTanstackRouterTypesSourceForEntry,
} from '../../src/cli/tanstackTypes';
import { createModernBasepathRewrite } from '../../src/runtime/basepathRewrite';
import { createRouteTreeFromRouteObjects } from '../../src/runtime/routeTree';
import { createTanstackRouteObjectsFromConfig } from '../../src/runtime/utils';
import { navigateOnClient } from './clientNavigation';

const execFileAsync = promisify(execFile);
const strictestTsconfigPath = path.resolve(
  __dirname,
  '../../node_modules/@tsconfig/strictest/tsconfig.json',
);
const installedReactRouterPath = path.resolve(
  __dirname,
  '../../node_modules/@tanstack/react-router',
);

async function writeTsconfig(
  projectDirectory: string,
  compilerOptions: Record<string, unknown>,
) {
  await writeFile(
    path.join(projectDirectory, 'tsconfig.json'),
    JSON.stringify(
      {
        extends: strictestTsconfigPath,
        compilerOptions: {
          jsx: 'react-jsx',
          lib: ['ESNext', 'DOM'],
          noEmit: true,
          target: 'ESNext',
          types: [],
          ...compilerOptions,
        },
        include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.d.ts'],
      },
      null,
      2,
    ),
  );
}

/** Runs the same compiler a consumer build runs; surfaces its diagnostics. */
async function runTsgo(projectDirectory: string) {
  try {
    await execFileAsync(
      process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo',
      ['-p', 'tsconfig.json'],
      { cwd: projectDirectory, shell: process.platform === 'win32' },
    );
  } catch (error) {
    const { stdout, stderr } = (error ?? {}) as {
      stdout?: string;
      stderr?: string;
    };
    if (stdout || stderr) {
      throw new Error([stdout, stderr].filter(Boolean).join('\n'), {
        cause: error,
      });
    }
    throw error;
  }
}

async function compileGeneratedRouterAgainstInstalledDeclarations(options: {
  projectDirectory: string;
  routerGenTs: string;
}) {
  const { projectDirectory, routerGenTs } = options;
  const generatedDirectory = path.join(
    projectDirectory,
    'src',
    'modern-tanstack',
    'golden',
  );
  await mkdir(generatedDirectory, { recursive: true });
  await writeFile(path.join(generatedDirectory, 'router.gen.ts'), routerGenTs);

  // The runtime package re-exports the *installed* @tanstack/react-router
  // declarations, so the generated file is checked against the real router
  // types a consumer resolves — not a stand-in.
  const runtimePackageDirectory = path.join(
    projectDirectory,
    'node_modules',
    '@modern-js',
    'plugin-tanstack',
  );
  await mkdir(runtimePackageDirectory, { recursive: true });
  await writeFile(
    path.join(runtimePackageDirectory, 'package.json'),
    JSON.stringify({
      name: '@modern-js/plugin-tanstack',
      type: 'commonjs',
      exports: {
        './runtime': { types: './runtime.d.ts', default: './runtime.js' },
      },
    }),
  );
  await writeFile(
    path.join(runtimePackageDirectory, 'runtime.d.ts'),
    [
      "export { createMemoryHistory, createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router';",
      'export type ModernRouterContext = { request?: Request; requestContext?: unknown };',
      'export const modernTanstackRouterFastDefaults: { readonly defaultStructuralSharing: true };',
      'export function createRouteStaticData<TData extends { modernRouteId?: string; modernRouteAction?: unknown; modernRouteLoader?: unknown }>(data: TData): TData;',
      'export function modernLoaderToTanstack<TLoader extends (...args: any[]) => any>(options: { hasSplat: boolean }, modernLoader: TLoader): (context: unknown) => Promise<Awaited<ReturnType<TLoader>>>;',
    ].join('\n'),
  );
  await writeFile(
    path.join(projectDirectory, 'package.json'),
    JSON.stringify({ private: true, type: 'commonjs' }),
  );
  await writeTsconfig(projectDirectory, {
    module: 'Node16',
    moduleResolution: 'Node16',
    paths: { '@tanstack/react-router': [installedReactRouterPath] },
    verbatimModuleSyntax: false,
  });
  await runTsgo(projectDirectory);
}

async function typecheckCanonicalRegisterContract(options: {
  canonicalRoutes: Record<string, string>;
  contractLines: string[];
  projectDirectory: string;
}) {
  const { canonicalRoutes, contractLines, projectDirectory } = options;
  const srcDirectory = path.join(projectDirectory, 'src');
  await mkdir(path.join(srcDirectory, 'modern-tanstack', 'index'), {
    recursive: true,
  });
  await writeFile(
    path.join(srcDirectory, 'modern-tanstack', 'index', 'router.gen.ts'),
    'export const router = { context: {} };',
  );
  await writeTanstackRegisterFile({
    canonicalRoutes,
    entries: ['index'],
    srcDirectory,
  });
  await writeFile(
    path.join(srcDirectory, 'runtime-shims.d.ts'),
    [
      "declare module '@modern-js/plugin-tanstack/runtime' { export interface Register {} }",
      "declare module '@modern-js/plugin-i18n/runtime' { export interface UltramodernCanonicalRoutes {} }",
    ].join('\n'),
  );
  await writeFile(
    path.join(srcDirectory, 'canonical-routes-contract.ts'),
    [
      "import type { UltramodernCanonicalRoutes } from '@modern-js/plugin-i18n/runtime';",
      ...contractLines,
    ].join('\n'),
  );
  await writeTsconfig(projectDirectory, {
    module: 'Preserve',
    moduleResolution: 'Bundler',
  });
  await runTsgo(projectDirectory);
}

async function generateComprehensiveRouterGen(srcDirectory: string) {
  const files = new Map([
    [
      'routes/(app)/layout.tsx',
      'export default function AppLayout() { return null; }',
    ],
    [
      'routes/(app)/users/(userId)/page.tsx',
      'export default function UserPage() { return null; }',
    ],
    [
      'routes/(app)/users/(userId)/page.data.ts',
      [
        'export const loader = () => ({ userId: "42" });',
        'export const action = () => Response.json({ ok: true });',
      ].join('\n'),
    ],
    [
      'routes/(app)/docs/splat.tsx',
      'export default function DocsSplatPage() { return null; }',
    ],
    [
      'routes/search.contract.ts',
      [
        'export const validateSearch = (search: { tab?: string }) => ({ tab: search.tab ?? "overview" });',
        'export const loaderDeps = ({ search }: { search: { tab: string } }) => ({ tab: search.tab });',
      ].join('\n'),
    ],
  ]);
  for (const [relativePath, contents] of files) {
    const filePath = path.join(srcDirectory, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
  }

  const { routerGenTs } = await generateTanstackRouterTypesSourceForEntry({
    appContext: { srcDirectory, internalSrcAlias: '@/_' } as any,
    entryName: 'golden',
    routes: [
      {
        type: 'nested',
        id: 'layout',
        isRoot: true,
        children: [
          {
            type: 'nested',
            id: '(app)/layout',
            _component: '@/_/routes/(app)/layout',
            children: [
              {
                type: 'nested',
                id: '(app)/users/(userId)/page',
                path: 'users/:userId',
                _component: '@/_/routes/(app)/users/(userId)/page',
                data: '@/_/routes/(app)/users/(userId)/page.data',
                action: '@/_/routes/(app)/users/(userId)/page.data',
                validateSearch: '@/_/routes/search.contract',
                loaderDeps: '@/_/routes/search.contract',
              },
              {
                type: 'nested',
                id: '(app)/docs/splat/page',
                path: 'docs/*',
                _component: '@/_/routes/(app)/docs/splat',
              },
            ],
          },
        ],
      },
    ] as any,
  });

  return routerGenTs;
}

describe('tanstack router type generation', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  test('strictly compiles generated routes against installed router declarations', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-types-'));
    const routerGenTs = await generateComprehensiveRouterGen(
      path.join(tempDir, 'src'),
    );

    await compileGeneratedRouterAgainstInstalledDeclarations({
      projectDirectory: tempDir,
      routerGenTs,
    });
  });

  test('generated and runtime trees agree on localized splats, root siblings, layouts and params', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-parity-'));
    const localized = applyLocalisedUrlsToRoutes(
      [
        {
          type: 'nested',
          id: 'lang',
          path: ':lang',
          children: [
            {
              type: 'nested',
              id: 'products',
              path: 'products',
              children: [{ type: 'nested', id: 'product-files', path: '*' }],
            },
            { type: 'nested', id: 'fallback', path: '*' },
          ],
        },
      ],
      ['en', 'cs'],
      { '/products': { en: '/products', cs: '/produkty' } },
      'canonical',
    );
    const routes = [
      {
        type: 'nested',
        id: 'layout',
        isRoot: true,
        children: [
          ...localized,
          {
            type: 'nested',
            children: [{ type: 'nested', path: 'one/:id?', index: false }],
          },
          { type: 'nested', children: [{ type: 'nested', path: 'two/*' }] },
          { type: 'nested', id: 'index', index: true },
        ],
      },
      { type: 'nested', id: 'sibling', path: 'outside/:lang' },
    ] as any;
    const { routerGenTs } = await generateTanstackRouterTypesSourceForEntry({
      appContext: {
        srcDirectory: path.join(tempDir, 'src'),
        internalSrcAlias: '@/_',
      } as any,
      entryName: 'parity',
      routes,
    });
    const generated = path.join(tempDir, 'router.gen.ts');
    await writeFile(generated, routerGenTs);
    const modules = path.join(tempDir, 'node_modules', '@modern-js');
    await mkdir(modules, { recursive: true });
    await symlink(
      path.resolve(__dirname, '../..'),
      path.join(modules, 'plugin-tanstack'),
      'junction',
    );
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '--eval',
      `
      import { router } from ${JSON.stringify(pathToFileURL(generated).href)};
      import { createModernBasepathRewrite } from ${JSON.stringify(pathToFileURL(path.resolve(__dirname, '../../dist/esm/runtime/basepathRewrite.mjs')).href)};
      router.update({ rewrite: createModernBasepathRewrite('/base', false, ${JSON.stringify(routes)}) });
      router.history.push(router.buildLocation({ to: '/cs/produkty/a/b', search: { q: 'tractor' }, hash: 'files' }).publicHref); router.updateLatestLocation(); await router.load();
      console.log(JSON.stringify({ ids: Object.keys(router.routesById).sort(), match: router.state.matches.at(-1).routeId, params: router.state.matches.at(-1).params, href: router.history.location.href }));
    `,
    ]);
    const routeObjects = createTanstackRouteObjectsFromConfig({
      routesConfig: { routes },
    })!;
    const runtime = createRouter({
      routeTree: createRouteTreeFromRouteObjects(routeObjects),
      history: createMemoryHistory({
        initialEntries: ['/base/cs/produkty/a/b?q=tractor#files'],
      }),
      rewrite: createModernBasepathRewrite('/base', false, routeObjects),
    });
    await runtime.load();
    expect(JSON.parse(stdout)).toEqual({
      ids: Object.keys(runtime.routesById).sort(),
      match: runtime.state.matches.at(-1)?.routeId,
      params: runtime.state.matches.at(-1)?.params,
      href: runtime.history.location.href,
    });
    expect(runtime.state.matches.at(-1)?.routeId).toBe('/$lang/products/$');
    expect(runtime.state.matches.at(-1)?.params).toMatchObject({
      lang: 'cs',
      _splat: 'a/b',
    });
    await navigateOnClient(runtime, { to: '/cs/missing/path' });
    expect(runtime.state.matches.at(-1)?.routeId).toBe('/$lang/$');
    expect(runtime.state.matches.at(-1)?.params).toMatchObject({
      lang: 'cs',
      _splat: 'missing/path',
    });
    await navigateOnClient(runtime, { to: '/outside/cs' });
    expect(runtime.state.matches.at(-1)?.params).toEqual({ lang: 'cs' });
    const canonicalRoutes = collectCanonicalRoutesForEntry(localized as any)!;
    expect(Object.keys(canonicalRoutes)).toEqual(['/$', '/products/$']);
    await typecheckCanonicalRegisterContract({
      projectDirectory: tempDir,
      canonicalRoutes,
      contractLines: [
        "const product: UltramodernCanonicalRoutes['/products/$'] = { _splat: 'a/b' };",
        "const fallback: UltramodernCanonicalRoutes['/$'] = { _splat: 'unknown/path' };",
        '// @ts-expect-error splat remains a string',
        "const invalid: UltramodernCanonicalRoutes['/products/$'] = { _splat: 42 };",
        'void product; void fallback; void invalid;',
      ],
    });
  });

  test('maps a locale-prefixed route tree to the canonical paths consumers navigate to', () => {
    const routes = [
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
              { type: 'nested', id: '(lang)/page', index: true },
              { type: 'nested', id: '(lang)/about/page', path: 'about' },
              {
                type: 'nested',
                id: '(lang)/optional/(slug$)/page',
                path: 'optional/:slug?',
              },
              { type: 'nested', id: '(lang)/files/page', path: 'files/*' },
            ],
          },
        ],
      },
    ] as any;

    // Without plugin-i18n installed, a hand-rolled `/:lang/` param must NOT
    // produce a canonical surface — the emitted module augmentation would
    // break typechecking in an app that never opted into i18n.
    expect(
      collectCanonicalRoutesForEntry(routes, { localeParamHeuristic: false }),
    ).toBeNull();

    const result = collectCanonicalRoutesForEntry(routes);
    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual([
      '/',
      '/about',
      '/files/$',
      '/optional/{-$slug}',
    ]);
  });

  test('collapses localized variants to one canonical key with typed params', async () => {
    const result = collectCanonicalRoutesForEntry([
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
                id: '(lang)/products/(slug)/page',
                path: 'products/:slug',
                modernCanonicalPath: '/products/:slug',
              },
              {
                type: 'nested',
                id: '(lang)/products/(slug)/page__localised_produkty_slug',
                path: 'produkty/:slug',
                modernCanonicalPath: '/products/:slug',
              },
              {
                type: 'nested',
                id: '(lang)/optional/(slug$)/page__localised_volitelne_slug',
                path: 'volitelne/:slug?',
                modernCanonicalPath: '/optional/:slug?',
              },
            ],
          },
        ],
      },
    ] as any);

    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual([
      '/optional/{-$slug}',
      '/products/$slug',
    ]);
    expect('/produkty/$slug' in result!).toBe(false);

    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-canonical-'));
    await typecheckCanonicalRegisterContract({
      canonicalRoutes: {
        '/': 'Record<string, never>',
        '/files/$': '{ _splat?: string }',
        ...result!,
      },
      contractLines: [
        "const rootParams: UltramodernCanonicalRoutes['/'] = {};",
        '// @ts-expect-error index canonical routes reject unexpected params',
        "const invalidRootParams: UltramodernCanonicalRoutes['/'] = { slug: 'unexpected' };",
        "const productParams: UltramodernCanonicalRoutes['/products/$slug'] = { slug: 'tractor' };",
        "const optionalParams: UltramodernCanonicalRoutes['/optional/{-$slug}'] = {};",
        "const presentOptionalParams: UltramodernCanonicalRoutes['/optional/{-$slug}'] = { slug: 'tractor' };",
        '// @ts-expect-error optional canonical params still retain their string type',
        "const invalidOptionalParams: UltramodernCanonicalRoutes['/optional/{-$slug}'] = { slug: 42 };",
        "const splatParams: UltramodernCanonicalRoutes['/files/$'] = { _splat: 'guides/intro' };",
        '// @ts-expect-error localized physical variants do not become canonical keys',
        "declare const localizedParams: UltramodernCanonicalRoutes['/produkty/$slug'];",
        '// @ts-expect-error the deduplicated product route still requires its param',
        "const missingProductParams: UltramodernCanonicalRoutes['/products/$slug'] = {};",
        'void rootParams;',
        'void productParams;',
        'void optionalParams;',
        'void presentOptionalParams;',
        'void splatParams;',
        'void invalidRootParams;',
        'void invalidOptionalParams;',
        'void localizedParams;',
        'void missingProductParams;',
      ],
      projectDirectory: tempDir,
    });
  });
});
