import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';

const packageDirectory = path.resolve(__dirname, '../..');
const requireFromPackage = createRequire(
  path.join(packageDirectory, 'package.json'),
);
const compilers = [
  { name: 'TypeScript', package: 'typescript', binary: 'tsc' },
];
const consumers = compilers.flatMap(compiler =>
  ['.mts', '.cts'].map(extension => ({ ...compiler, extension })),
);

function checkInstalledDeclarations(
  consumer: (typeof consumers)[number],
  source: string,
  {
    react = false,
    tanstack = false,
    selectedReactEnvironment = false,
  }: {
    react?: boolean;
    tanstack?: boolean;
    selectedReactEnvironment?: boolean;
  } = {},
) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-renderer-public-types-'),
  );
  try {
    const scope = path.join(directory, 'node_modules/@modern-js');
    fs.mkdirSync(scope, { recursive: true });
    fs.symlinkSync(
      packageDirectory,
      path.join(scope, 'ultramodern-app-tools'),
      'dir',
    );
    fs.symlinkSync(
      path.join(packageDirectory, 'node_modules/@modern-js/app-tools'),
      path.join(scope, 'app-tools'),
      'dir',
    );
    if (tanstack) {
      fs.symlinkSync(
        path.join(packageDirectory, 'node_modules/@modern-js/plugin-tanstack'),
        path.join(scope, 'plugin-tanstack'),
        'dir',
      );
    }
    const ambientDirectory = path.join(directory, 'node_modules/@types');
    fs.mkdirSync(ambientDirectory, { recursive: true });
    fs.symlinkSync(
      path.join(packageDirectory, 'node_modules/@types/node'),
      path.join(ambientDirectory, 'node'),
      'dir',
    );
    if (react) {
      fs.symlinkSync(
        path.join(packageDirectory, 'node_modules/@modern-js/runtime'),
        path.join(scope, 'runtime'),
        'dir',
      );
      fs.symlinkSync(
        path.join(
          packageDirectory,
          'node_modules/@modern-js/runtime-extensions',
        ),
        path.join(scope, 'runtime-extensions'),
        'dir',
      );
      fs.symlinkSync(
        path.join(
          packageDirectory,
          'node_modules/@modern-js/plugin/node_modules/@types/react',
        ),
        path.join(ambientDirectory, 'react'),
        'dir',
      );
    }
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'ultramodern-public-declaration-consumer',
        private: true,
        dependencies: {
          '@modern-js/ultramodern-app-tools': 'workspace:*',
          '@modern-js/app-tools': 'workspace:*',
          ...(tanstack ? { '@modern-js/plugin-tanstack': 'workspace:*' } : {}),
        },
      }),
    );
    const filename = `consumer${consumer.extension}`;
    fs.writeFileSync(path.join(directory, filename), source);
    const files = [filename];
    if (selectedReactEnvironment) {
      fs.writeFileSync(
        path.join(directory, 'env.d.ts'),
        '/// <reference types="@modern-js/ultramodern-app-tools/react-types" />\n',
      );
      fs.writeFileSync(
        path.join(directory, 'selected-react.tsx'),
        `import './style.css';
import styles from './style.module.css';
export const valid = <button type="button" className={styles.root}>React JSX</button>;
// @ts-expect-error Selected React JSX attributes remain typed.
export const invalid = <main definitelyNotAReactAttribute={true} />;
// @ts-expect-error Asset declarations do not admit missing JavaScript imports.
import './missing-runtime.js';
`,
      );
      fs.writeFileSync(
        path.join(directory, 'style.css'),
        'button { color: red; }\n',
      );
      fs.writeFileSync(
        path.join(directory, 'style.module.css'),
        '.root { display: block; }\n',
      );
      files.push('env.d.ts', 'selected-react.tsx');
    }
    fs.writeFileSync(
      path.join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: ['node'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ESNext',
          ...(selectedReactEnvironment
            ? { jsx: 'react-jsx', noUncheckedSideEffectImports: true }
            : {}),
        },
        files,
      }),
    );
    const compilerManifestPath = requireFromPackage.resolve(
      `${consumer.package}/package.json`,
    );
    const compilerManifest = JSON.parse(
      fs.readFileSync(compilerManifestPath, 'utf8'),
    );
    expect(compilerManifest).toMatchObject({
      name: 'typescript',
      version: '7.0.2',
    });
    const launcher = path.resolve(
      path.dirname(compilerManifestPath),
      compilerManifest.bin[consumer.binary],
    );
    const result = spawnSync(
      process.execPath,
      [launcher, '-p', path.join(directory, 'tsconfig.json'), '--listFiles'],
      { cwd: directory, encoding: 'utf8', timeout: 45_000 },
    );
    const lines = `${result.stdout ?? ''}${result.stderr ?? ''}`
      .split(/\r?\n/u)
      .filter(Boolean);
    const loadedFiles = lines.filter(
      line => path.isAbsolute(line) && fs.existsSync(line),
    );
    const diagnostics = lines
      .filter(line => !loadedFiles.includes(line))
      .join('\n');
    expect(result.error).toBeUndefined();
    expect(
      result.status,
      `${consumer.name} ${compilerManifest.version} ${consumer.extension} public declarations:\n${diagnostics}`,
    ).toBe(0);
    const graph = loadedFiles.map(file => file.replaceAll('\\', '/'));
    const declarations = graph.filter(
      file =>
        !files.some(
          source => file === path.join(directory, source).replaceAll('\\', '/'),
        ),
    );
    expect(declarations.length).toBeGreaterThan(0);
    expect(
      declarations.filter(file => !/\.d\.(?:ts|mts|cts)$/u.test(file)),
    ).toEqual([]);
    for (const entry of ['index', 'cli', 'rsbuild']) {
      expect(
        graph.some(file =>
          new RegExp(
            `/native-composition/${entry}\\.d\\.(?:ts|mts)$`,
            'u',
          ).test(file),
        ),
        `The actual public ${entry} declaration must enter the consumer program`,
      ).toBe(true);
    }
    return graph;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const sharedConsumer = `
import {
  defineConfig, resolveUltramodernConfig, resolveRendererProfile,
  resolveCandidateRendererProfile,
  readRendererBuildManifest, readRendererDevelopmentBuildManifest,
  validateRendererBuildManifest,
  type AppUserConfig, type ConfigParams, type RendererBuildManifest,
  type RendererDevelopmentBuildManifest, type RendererBuildProfile,
  type RegisteredRenderer, type UserConfigExport,
} from '@modern-js/ultramodern-app-tools';
import { generateRouteArtifacts } from '@modern-js/ultramodern-app-tools/cli';
import { resolveUltramodernRsbuildConfig } from '@modern-js/ultramodern-app-tools/rsbuild';
import type {
  AppTools, CLIElement, CLIElementTypes, CLIFileSystemRoute,
} from '@modern-js/app-tools/cli-config';

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
export type ConfigIsTyped = Assert<Same<IsAny<AppUserConfig>, false>>;
export type PluginConfigIsTyped = Assert<Same<IsAny<AppTools['config']>, false>>;

const plugin: NonNullable<AppUserConfig['plugins']>[number] = {
  name: 'installed-native-metadata',
  setup(api) {
    const config: AppTools['config'] = api.getConfig();
    const directory: string = api.getAppContext().appDirectory;
    api.modifyFileSystemRoutes(event => {
      event.routes = [{
        type: 'nested', origin: 'file-system', path: '/catalog',
        component: './src/routes/catalog/page.ts',
        data: './src/routes/catalog/page.data.ts',
        children: [{
          type: 'nested', origin: 'config', path: ':id',
          component: './src/routes/catalog/item.ts',
        }],
      }];
      return event;
    });
    void config; void directory;
  },
};

const config: AppUserConfig = {
  renderer: 'solid', plugins: [plugin],
  source: { entries: { main: { entry: './src/main.ts', disableMount: true } } },
  output: { svgDefaultExport: 'url', distPath: { root: 'dist' } },
  server: { ssr: true },
  dev: {
    mockDir: './mock', server: { watch: true, cors: false },
    setupMiddlewares: [middlewares => {
      middlewares.push((_request, _response, next) => next());
    }],
  },
  html: { title: 'Native declarations', meta: { description: 'Native app' } },
  builderPlugins: [{ name: 'installed-native-builder', setup(api) { api.onBeforeBuild(() => {}); } }],
};
const objectExport: UserConfigExport<AppUserConfig> = defineConfig(config);
const syncExport: UserConfigExport<AppUserConfig> = defineConfig(context => {
  const params: ConfigParams = context;
  const env: string = params.env;
  const command: string = params.command;
  void env; void command;
  return { ...config, renderer: 'octane' };
});
const asyncExport: UserConfigExport<AppUserConfig> = defineConfig(async context => {
  const command: string = context.command;
  await Promise.resolve(command);
  return config;
});
const resolved: Promise<AppUserConfig> = resolveUltramodernConfig(asyncExport, { env: 'test', command: 'build' });
const generated: Promise<void> = generateRouteArtifacts({ appDirectory: process.cwd(), configPath: 'modern.config.ts' });
const builder = resolveUltramodernRsbuildConfig({
  command: 'build', cwd: process.cwd(),
  modifyModernConfig: async authored => ({ ...authored, renderer: 'solid', plugins: authored.plugins }),
});
const profile = resolveRendererProfile('octane');
const renderer: 'react' | 'solid' | 'octane' = profile.renderer;
export type SelectedProfile = Assert<Same<typeof profile.renderer, RegisteredRenderer>>;
const candidate = resolveCandidateRendererProfile('solid');
export type SelectedCandidate = Assert<Same<typeof candidate.renderer, RegisteredRenderer>>;
declare const manifest: RendererBuildManifest;
const manifestRenderer: 'react' | 'solid' | 'octane' = manifest.profile.renderer;
export type SelectedManifest = Assert<Same<typeof manifest.profile.renderer, RegisteredRenderer>>;
const validatedManifest = validateRendererBuildManifest(manifest, profile);
const validatedRenderer: RegisteredRenderer = validatedManifest.profile.renderer;
const loadedManifest: Promise<RendererBuildManifest> = readRendererBuildManifest('.', profile);
const loadedDevelopmentManifest: Promise<RendererDevelopmentBuildManifest> = readRendererDevelopmentBuildManifest('.', profile);
export type OpenTransport = Assert<Same<RendererBuildProfile<string>['renderer'], string>>;
declare const transportProfile: RendererBuildProfile<string>;
const transportManifest = validateRendererBuildManifest(manifest, transportProfile);
export type GenericManifest = Assert<Same<typeof transportManifest.profile.renderer, string>>;
// @ts-expect-error An open transport profile does not imply SDK selection.
const unselectedRenderer: RegisteredRenderer = transportManifest.profile.renderer;
// @ts-expect-error A renderer value must belong to the supported selection.
defineConfig({ renderer: 'unsupported' });
void objectExport; void syncExport; void resolved; void generated; void builder;
void renderer; void manifestRenderer; void validatedRenderer;
void loadedManifest; void loadedDevelopmentManifest; void unselectedRenderer;
`;

const neutralConsumer = `${sharedConsumer}
export type EmptyRegistry = Assert<Same<keyof CLIElementTypes, never>>;
export type NoElementValue = Assert<Same<CLIElement, never>>;
export type NoRouteElement = Assert<Same<NonNullable<CLIFileSystemRoute<CLIElement>['element']>, never>>;
export type NoRouteErrorElement = Assert<Same<NonNullable<CLIFileSystemRoute<CLIElement>['errorElement']>, never>>;
const route: CLIFileSystemRoute<CLIElement> = {
  type: 'nested', origin: 'file-system', component: './page.ts',
};
// @ts-expect-error Native CLI metadata does not admit renderer elements without an owning type entry.
route.element = 'renderer element';
// @ts-expect-error Route components remain filenames in the neutral metadata program.
route.component = () => 'component';
void route;
`;

const reactConsumer = `${sharedConsumer}
import type { composeReactRenderer } from '@modern-js/ultramodern-app-tools/react-composition';
import type { ReactNode } from 'react';
export type ReactFactoryIsTyped = Assert<Same<IsAny<typeof composeReactRenderer>, false>>;
export type ReactRegistryEntry = Assert<Same<keyof CLIElementTypes, 'react'>>;
export type ReactRegistryNode = Assert<Same<CLIElementTypes['react'], ReactNode>>;
export type ReactElementSlot = Assert<Same<NonNullable<CLIElement>, NonNullable<CLIElementTypes['react']>>>;
export type ReactRouteSlot = Assert<Same<NonNullable<CLIFileSystemRoute<CLIElement>['element']>, NonNullable<CLIElementTypes['react']>>>;
const reactRoute: CLIFileSystemRoute<CLIElement> = {
  type: 'nested', origin: 'config', component: './page.tsx',
  element: 'React text child', errorElement: 123,
};
const reactPlugin: NonNullable<AppUserConfig['plugins']>[number] = {
  name: 'installed-react-route-metadata',
  setup(api) {
    api.modifyFileSystemRoutes(event => ({ ...event, routes: [reactRoute] }));
  },
};
const defaultReact: UserConfigExport<AppUserConfig> = defineConfig({
  plugins: [reactPlugin],
  output: { ssg: { routes: [{ url: '/catalog', output: 'catalog/index.html' }] } },
  source: { entries: { main: './src/main.tsx' } },
  server: { ssr: { moduleFederationAppSSR: true } },
});
void defaultReact;
`;

const tanstackReactConsumer = `${sharedConsumer}
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';

const tanstackReactConfig = defineConfig({
  renderer: 'react',
  plugins: [tanstackRouterPlugin()],
  server: {
    rsc: true,
    ssrByEntries: { index: { mode: 'stream' } },
  },
  deploy: {
    worker: { ssr: true, name: 'react-rsc-proof' },
  },
});
void tanstackReactConfig;
`;

const nativeReactPluginConsumer = `${sharedConsumer}
import type { AppTools as NativeAppTools, CliPlugin } from '@modern-js/app-tools';
import type { RuntimePlugin } from '@modern-js/runtime';
import {
  routerPlugin as nativeRouterPlugin,
  routerProviderRegistryHooks,
} from '@modern-js/runtime/router/internal';
import { createRouterPlugin } from '@modern-js/runtime-extensions/router-provider';
import type { ReactNode } from 'react';

const createNativeRouterProvider: typeof nativeRouterPlugin = createRouterPlugin({
  defaultProvider: { name: 'react-router', factory: nativeRouterPlugin },
  registryHooks: routerProviderRegistryHooks,
});
const nativeRouterProvider: ReturnType<typeof nativeRouterPlugin> = createNativeRouterProvider({
  framework: 'react-router',
});
// @ts-expect-error Native router configuration remains typed through composition.
createNativeRouterProvider({ framework: 123 });
void nativeRouterProvider;

export type SelectedReactRegistry = Assert<Same<keyof CLIElementTypes, 'react'>>;
export type SelectedReactNode = Assert<Same<CLIElementTypes['react'], ReactNode>>;
export type NativePluginIsTyped = Assert<Same<IsAny<CliPlugin<NativeAppTools>>, false>>;
const selectedRoute: CLIFileSystemRoute<CLIElement> = {
  type: 'nested', origin: 'config', component: './page.tsx',
  element: 'React route child', errorElement: 123,
};
// @ts-expect-error React route elements cannot contain arbitrary objects.
selectedRoute.element = { invalidReactNode: true };
// @ts-expect-error CLI route component metadata remains a filename.
selectedRoute.component = () => 'invalid component';
const selectedPlugin: NonNullable<AppUserConfig['plugins']>[number] = {
  name: 'selected-react-route-types',
  setup(api) {
    api.modifyFileSystemRoutes(event => {
      // @ts-expect-error Route callbacks keep their typed route collection.
      event.routes = 'invalid routes';
      return { ...event, routes: [selectedRoute] };
    });
  },
};
const nativeReactPlugin: CliPlugin<NativeAppTools> = {
  name: 'native-react-plugin-abi',
  setup(api) {
    api.modifyFileSystemRoutes(event => {
      // @ts-expect-error Native plugin route callbacks keep their typed collection.
      event.routes = 'invalid routes';
      return { ...event, routes: [selectedRoute] };
    });
  },
};
const nativeRuntimePlugin: RuntimePlugin = {
  name: 'native-runtime-hook-context',
  setup(api) {
    api.onBeforeRender(context => {
      type ContextIsTyped = Assert<Same<IsAny<typeof context>, false>>;
      const typedContext: ContextIsTyped = true;
      const isBrowser: boolean = context.isBrowser;
      context.initialData = { message: 'typed native hook' };
      // @ts-expect-error Runtime hook contexts retain their native field types.
      context.isBrowser = 'invalid browser flag';
      void typedContext; void isBrowser;
      return context;
    });
  },
};
const defaultReact = defineConfig({
  plugins: [nativeReactPlugin, selectedPlugin],
});
const explicitReact = defineConfig({
  renderer: 'react',
  plugins: [nativeReactPlugin],
});
const callbackReact = defineConfig(context => {
  const command: string = context.command;
  // @ts-expect-error The configuration callback context stays typed.
  const invalidCommand: number = context.command;
  void command; void invalidCommand;
  return {
    renderer: 'react',
    plugins: [nativeReactPlugin],
  };
});
void defaultReact; void explicitReact; void callbackReact; void nativeRuntimePlugin;
`;

const legacyReactFactoryConsumer = `${sharedConsumer}
import {
  defineConfig as defineReactConfig,
  type AppTools as ReactAppTools,
  type CliPlugin,
} from '@modern-js/app-tools';
import { ultramodernAppTools } from '@modern-js/ultramodern-app-tools';
import type { ReactNode } from 'react';

export type ReactRootRegistry = Assert<Same<keyof CLIElementTypes, 'react'>>;
export type ReactRootNode = Assert<Same<CLIElementTypes['react'], ReactNode>>;
const base: CliPlugin<ReactAppTools> = ultramodernAppTools();
const typedReactConfig = defineReactConfig({ plugins: [base] });
const inferredReactConfig = defineReactConfig({ plugins: [ultramodernAppTools()] });
type BaseAPI = Parameters<NonNullable<ReturnType<typeof ultramodernAppTools>['setup']>>[0];
function verifyBaseRoutes(api: BaseAPI) {
  api.modifyFileSystemRoutes(event => {
    // @ts-expect-error React CLI route callbacks keep their typed collection.
    event.routes = 'invalid routes';
    const route: CLIFileSystemRoute<CLIElement> = {
      type: 'nested', origin: 'config', component: './page.tsx',
      element: 'React route child', errorElement: 123,
    };
    // @ts-expect-error React route elements cannot contain arbitrary objects.
    route.element = { invalidReactNode: true };
    return { ...event, routes: [route] };
  });
}
void base; void typedReactConfig; void inferredReactConfig; void verifyBaseRoutes;
`;

describe('installed renderer-neutral public declarations', () => {
  it.each(consumers)(
    'keeps native root, CLI, and Rsbuild consumers renderer-free with $name $extension',
    consumer => {
      const graph = checkInstalledDeclarations(consumer, neutralConsumer);
      expect(
        graph.filter(
          file =>
            file.includes('/node_modules/@types/react/') ||
            file.includes('/node_modules/react/') ||
            file.endsWith('/packages/toolkit/types/cli/index.d.ts') ||
            file.includes('/packages/toolkit/plugin/dist/types/runtime/') ||
            file.includes(
              '/packages/toolkit/plugin/dist/types/types/runtime/',
            ) ||
            file.includes('/renderers/react/composition.d.') ||
            file.includes('/renderers/react/types.d.') ||
            (file.includes('ultramodern-app-tools') &&
              file.endsWith('/lib/react-types.d.ts')),
        ),
      ).toEqual([]);
      expect(
        graph.some(file =>
          file.endsWith('/app-tools/dist/types/types/config/base.d.ts'),
        ),
      ).toBe(true);
    },
    60_000,
  );

  it.each(consumers)(
    'admits the explicit React factory through the React root without an environment opt-in with $name $extension',
    consumer => {
      const graph = checkInstalledDeclarations(
        consumer,
        legacyReactFactoryConsumer,
        { react: true },
      );
      expect(
        graph.some(file =>
          file.endsWith('/app-tools/dist/types/types/config/index.d.ts'),
        ),
      ).toBe(true);
      expect(
        graph.filter(
          file =>
            file.includes('/renderers/react/composition.d.') ||
            file.includes('/renderers/react/types.d.') ||
            (file.includes('ultramodern-app-tools') &&
              file.endsWith('/lib/react-types.d.ts')),
        ),
      ).toEqual([]);
    },
    60_000,
  );

  it.each(consumers)(
    'admits React route elements through its owned opt-in with $name $extension',
    consumer => {
      const graph = checkInstalledDeclarations(consumer, reactConsumer, {
        react: true,
      });
      expect(
        graph.some(file => file.endsWith('/renderers/react/composition.d.ts')),
      ).toBe(true);
      expect(
        graph.some(file => file.includes('/node_modules/@types/react/')),
      ).toBe(true);
    },
    60_000,
  );

  it.each(consumers)(
    'admits the public TanStack plugin in React config with $name $extension',
    consumer => {
      const graph = checkInstalledDeclarations(
        consumer,
        tanstackReactConsumer,
        {
          react: true,
          tanstack: true,
        },
      );
      expect(
        graph.some(file =>
          file.endsWith('/plugin-tanstack/dist/types/cli/index.d.ts'),
        ),
      ).toBe(true);
      expect(
        graph.filter(file => file.includes('/renderers/react/composition.d.')),
      ).toEqual([]);
    },
    60_000,
  );

  it.each(consumers)(
    'admits the native React plugin ABI through only the selected React environment with $name $extension',
    consumer => {
      const graph = checkInstalledDeclarations(
        consumer,
        nativeReactPluginConsumer,
        { react: true, selectedReactEnvironment: true },
      );
      expect(
        graph.some(file => file.endsWith('/renderers/react/types.d.ts')),
      ).toBe(true);
      expect(
        graph.some(
          file =>
            file.includes('ultramodern-app-tools') &&
            file.endsWith('/lib/react-types.d.ts'),
        ),
      ).toBe(true);
      expect(
        graph.some(file => file.endsWith('/app-tools/dist/types/index.d.ts')),
      ).toBe(true);
      expect(
        graph.some(file => file.endsWith('/app-tools/lib/types.d.ts')),
      ).toBe(true);
      expect(
        graph.filter(file => file.includes('/renderers/react/composition.d.')),
      ).toEqual([]);
    },
    60_000,
  );
});
