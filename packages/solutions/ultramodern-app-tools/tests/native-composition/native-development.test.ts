import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type RendererBuildIdentities,
  resolveRendererBuildIdentities,
} from '@modern-js/app-tools-extensions/renderer-build-identity';
import { findHostingModuleDirectory } from '@modern-js/app-tools-extensions/runtime-package-resolution';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { createRequestSession } from '@modern-js/renderer-core/session';
import type { Entrypoint } from '@modern-js/types/cli/base';
import { createRsbuild, type RsbuildPlugin, rspack } from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import { nativeClientAssetsPlugin } from '../../src/native-composition/native-assets';
import {
  RENDERER_BUILD_MANIFEST_FILE,
  RENDERER_DEVELOPMENT_DIRECTORY,
  readRendererDevelopmentBuildManifest,
} from '../../src/native-composition/native-build-manifest';
import {
  NativeDevelopment,
  nativeDevelopmentOutputDirectory,
} from '../../src/native-composition/native-development';
import { createNativeEntryGenerator } from '../../src/native-composition/native-entry';
import type { NativeDevelopmentSnapshot } from '../../src/native-composition/native-server-plugin';
import {
  type RendererBuildProfile,
  resolveCandidateRendererProfile,
  resolveRendererProfileMetadata,
} from '../../src/native-composition/renderer-profile';
import { resolveEntrypointRouterBindings } from '../../src/native-composition/renderer-router-resolution';
import { nativeRendererIsolationPlugin } from '../../src/native-composition/renderer-selection';
import { createOctaneCompilerPlugin } from '../../src/renderers/octane/compiler';
import { pluginSolidRenderer } from '../../src/renderers/solid/compiler';
import { createReplacementCompilerArtifacts } from './replacement-compiler-artifacts';

const roots: string[] = [];
const closes: (() => Promise<void>)[] = [];

afterEach(async () => {
  try {
    for (const close of closes.splice(0).reverse()) await close();
  } finally {
    for (const root of roots.splice(0))
      fs.rmSync(root, { recursive: true, force: true });
  }
});

function temporaryRoot(prefix: string): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), prefix),
    ),
  );
  roots.push(root);
  return root;
}

interface DevApp {
  readonly root: string;
  readonly identity: RendererIdentity;
  readonly session: RendererBuildIdentities;
  readonly profile: RendererBuildProfile;
  readonly authority: NativeDevelopment;
  readonly address: URL;
  edit(marker: string): void;
}

async function startDevServer(
  app: Omit<DevApp, 'address'>,
  rsbuildConfig: Parameters<typeof createRsbuild>[0]['rsbuildConfig'],
): Promise<DevApp> {
  const rsbuild = await createRsbuild({ cwd: app.root, rsbuildConfig });
  const dev = await rsbuild.createDevServer({ getPortSilently: true });
  closes.push(() => dev.close());
  closes.push(() => app.authority.close());
  const listening = await dev.listen();
  return { ...app, address: new URL(listening.urls[0]) };
}

async function render(app: DevApp, snapshot: NativeDevelopmentSnapshot) {
  const request = new Request(app.address);
  const session = createRequestSession({
    request,
    identity: app.identity,
    platform: {
      kind: 'node',
      bindings: { loaderContext: new Map<string, unknown>() },
    },
  });
  try {
    const response = await snapshot.manifest.nativeRequestHandler(request, {
      session,
      entry: app.identity,
      assets: snapshot.assets,
      nativeManifest: snapshot.nativeManifest,
      serverConfig: { ssr: true },
    });
    return await response.text();
  } finally {
    session.abort();
  }
}

/** Wait until the latest published compile renders the expected marker. */
async function until(app: DevApp, marker: string) {
  const deadline = Date.now() + 90_000;
  let last: unknown;
  for (;;) {
    try {
      const snapshot = await app.authority.resolveSnapshot(
        app.identity,
        AbortSignal.timeout(30_000),
      );
      const html = await render(app, snapshot);
      if (html.includes(marker)) {
        const manifest = await readRendererDevelopmentBuildManifest(
          path.join(app.root, 'dist'),
          app.profile,
          {
            routerFrameworks: [
              ...app.session.routerBindings.main.providers,
            ].map(provider => provider.framework),
          },
        );
        return { snapshot, html, manifest };
      }
      last = html;
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline)
      throw new Error(`Dev server never rendered ${marker}`, { cause: last });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function view(marker: string) {
  return `import './style.css';\nexport default function App() { return <main data-native-wave="${marker}">${marker}</main>; }\n`;
}

/** A real Solid or Octane app compiled by the selected native compiler. */
async function nativeApp(renderer: 'solid' | 'octane', module: boolean) {
  const root = temporaryRoot('native-dev-');
  const metadata = resolveRendererProfileMetadata(renderer);
  const dependencies: Record<string, string> = {};
  const bindings = new Map(
    metadata.frameworkPackages.map(owner => [owner.specifier, owner.directory]),
  );
  for (const specifier of new Set([
    ...bindings.keys(),
    ...Object.keys(metadata.profile.dependencies),
    '@modern-js/renderer-core',
  ])) {
    const directory =
      bindings.get(specifier) ??
      fs.realpathSync(
        path.join(
          metadata.frameworkPackages
            .map(owner =>
              findHostingModuleDirectory(specifier, owner.directory),
            )
            .find(Boolean)!,
          specifier,
        ),
      );
    const owner: { name: string; version: string } = JSON.parse(
      fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
    );
    dependencies[specifier] =
      owner.name === specifier
        ? owner.version
        : `npm:${owner.name}@${owner.version}`;
    const link = path.join(root, 'node_modules', specifier);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(directory, link, 'dir');
  }
  const packageName = `native-${renderer}-development`;
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: packageName, private: true, dependencies }),
  );
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        jsx: 'preserve',
        jsxImportSource: metadata.profile.jsxImportSource,
        module: 'ESNext',
        moduleResolution: 'Bundler',
      },
    }),
  );
  fs.mkdirSync(path.join(root, 'src'));
  const app = path.join(root, 'src', 'App.tsx');
  fs.writeFileSync(app, view('first'));
  fs.writeFileSync(
    path.join(root, 'src', 'style.css'),
    'main { color: rebeccapurple; }\n',
  );
  const internalDirectory = path.join(root, 'node_modules', '.modern-js');
  const distDirectory = path.join(root, 'dist');
  const entrypoint: Entrypoint = {
    entryName: 'main',
    entry: app,
    isAutoMount: true,
    isMainEntry: true,
  };
  const session = resolveRendererBuildIdentities({
    projectRoot: root,
    appId: packageName,
    renderer,
    profile: metadata.profile,
    mode: 'development',
    entryNames: ['main'],
    routerBindings: await resolveEntrypointRouterBindings(
      renderer,
      [entrypoint],
      [`@modern-js/renderer-${renderer}-infrastructure`],
      metadata,
    ),
  });
  const identity = session.identities.main;
  const generator = createNativeEntryGenerator(renderer);
  const context = {
    renderer,
    profile: metadata.profile,
    rendererIdentity: identity,
    appDirectory: root,
    internalDirectory,
    entrypoint,
    documentSSR: true,
    basePath: '/',
    modifyRoutes: async <T>(routes: T) => routes,
  };
  const entryDirectory = path.join(internalDirectory, renderer, 'main');
  const clientEntry = path.join(entryDirectory, 'index.ts');
  const serverEntry = path.join(entryDirectory, 'index.server.ts');
  fs.mkdirSync(entryDirectory, { recursive: true });
  fs.writeFileSync(clientEntry, await generator.client(context));
  fs.writeFileSync(serverEntry, await generator.server(context));
  const authority = new NativeDevelopment({
    renderer,
    profile: metadata.profile,
    distDirectory,
    getSessionIdentities: () => session,
  });
  return startDevServer(
    {
      root,
      identity,
      session,
      profile: metadata.profile,
      authority,
      edit: marker => fs.writeFileSync(app, view(marker)),
    },
    {
      plugins: [
        nativeRendererIsolationPlugin(renderer),
        nativeClientAssetsPlugin(renderer, () => session.identities),
        renderer === 'solid'
          ? pluginSolidRenderer({
              rendererIdentities: () => session.identities,
            })
          : createOctaneCompilerPlugin({
              rendererIdentities: () => session.identities,
            }),
        authority.plugin,
      ],
      server: { host: '127.0.0.1', port: 0, printUrls: false },
      dev: { writeToDisk: false, hmr: true, liveReload: false },
      output: { minify: false, sourceMap: false, injectStyles: false },
      performance: { printFileSize: false },
      environments: {
        client: {
          source: { entry: { main: clientEntry } },
          output: {
            target: 'web',
            assetPrefix: '/native-assets/',
            distPath: {
              root: nativeDevelopmentOutputDirectory(distDirectory, 'client'),
            },
          },
          tools: { htmlPlugin: false },
        },
        server: {
          source: { entry: { main: serverEntry } },
          output: {
            target: 'node',
            module,
            distPath: {
              root: nativeDevelopmentOutputDirectory(distDirectory, 'server'),
            },
            filename: { js: module ? '[name].mjs' : '[name].js' },
          },
          tools: { htmlPlugin: false, rspack: { externals: [] } },
        },
      },
    },
  );
}

/** A compiler outside the registry that owns its own manifest ABI. */
async function replacementApp(module: boolean) {
  const root = temporaryRoot('replacement-dev-');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'replacement-native-development', private: true }),
  );
  const profile = {
    ...resolveCandidateRendererProfile('solid'),
    renderer: 'replacement',
  };
  const buildId = 'a'.repeat(64);
  const identity: RendererIdentity = {
    renderer: 'replacement',
    appId: 'replacement-native-development',
    entryName: 'main',
    protocolVersion: 1,
    buildId,
  };
  const state = path.join(root, 'state.js');
  const clientEntry = path.join(root, 'client.js');
  const serverEntry = path.join(root, 'server.js');
  fs.writeFileSync(state, 'export const marker = "first";\n');
  fs.writeFileSync(
    clientEntry,
    'import { marker } from "./state.js";\nglobalThis.replacementCompilerMarker = marker;\n',
  );
  fs.writeFileSync(
    serverEntry,
    `import { marker } from "./state.js";
export const rendererIdentity = ${JSON.stringify(identity)};
export async function nativeRequestHandler(_request, context) {
  return new Response(marker + ":" + context.nativeManifest.owner);
}
export async function nativeCSRRequestHandler() { return new Response(marker); }
`,
  );
  const provider = { framework: 'replacement', ...profile.router };
  const session: RendererBuildIdentities = {
    identities: { main: identity },
    buildId,
    profileKey: 'b'.repeat(64),
    sourceRevision: 'workspace',
    routerBindings: {
      main: {
        owner: '@fixture/replacement-router-owner',
        evidence: 'file-routes',
        defaultProvider: provider,
        providers: [provider],
      },
    },
  };
  let poison = false;
  const compilerArtifacts = createReplacementCompilerArtifacts();
  const authority = new NativeDevelopment({
    renderer: 'replacement',
    profile,
    compilerArtifacts,
    distDirectory: path.join(root, 'dist'),
    getSessionIdentities: () => session,
  });
  const owner: RsbuildPlugin = {
    name: 'test-replacement-compiler',
    setup(api) {
      api.modifyRspackConfig((config, { environment }) => {
        if (environment.name !== 'client') return;
        config.plugins ??= [];
        config.plugins.push({
          apply(compiler) {
            compiler.hooks.thisCompilation.tap('ReplacementCompiler', current =>
              current.hooks.processAssets.tap(
                {
                  name: 'ReplacementCompiler',
                  stage: rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
                },
                () => {
                  const manifest = {
                    abi: 'replacement-compiler/v1',
                    owner: 'replacement-compiler',
                    build: {
                      identity: poison
                        ? { ...identity, buildId: 'foreign-build' }
                        : identity,
                      hydrationBuildId: current.hash,
                    },
                  };
                  current.emitAsset(
                    'compiled-artifacts/main.replacement.json',
                    new rspack.sources.RawSource(JSON.stringify(manifest)),
                    { immutable: false },
                  );
                },
              ),
            );
          },
        });
      });
    },
  };
  const app = await startDevServer(
    {
      root,
      identity,
      session,
      profile,
      authority,
      edit: marker =>
        fs.writeFileSync(
          state,
          `export const marker = ${JSON.stringify(marker)};\n`,
        ),
    },
    {
      plugins: [
        nativeClientAssetsPlugin('replacement', () => session.identities),
        owner,
        authority.plugin,
      ],
      server: { host: '127.0.0.1', port: 0, printUrls: false },
      dev: {
        assetPrefix: '/replacement-assets/',
        writeToDisk: false,
        hmr: true,
        liveReload: false,
      },
      output: { minify: false, sourceMap: false },
      performance: { printFileSize: false },
      environments: {
        client: {
          source: { entry: { main: clientEntry } },
          output: { target: 'web', assetPrefix: '/replacement-assets/' },
          tools: { htmlPlugin: false },
        },
        server: {
          source: { entry: { main: serverEntry } },
          output: {
            target: 'node',
            module,
            filename: { js: module ? '[name].mjs' : '[name].js' },
          },
          tools: { htmlPlugin: false, rspack: { externals: [] } },
        },
      },
    },
  );
  return {
    ...app,
    compilerArtifacts,
    poison(value: boolean) {
      poison = value;
    },
  };
}

describe('native development', () => {
  it.each([
    ['CommonJS', false],
    ['ESM', true],
  ])(
    'imports the newest %s server bundle after every compile',
    async (_format, module) => {
      const app = await replacementApp(module);
      const first = await until(app, 'first:replacement-compiler');
      expect(first.manifest.entries).toEqual(app.session.identities);
      expect(first.manifest.buildId).toBe(app.session.buildId);
      expect(first.snapshot.hydrationBuildId).toBe(
        first.manifest.devCompilation.compilationHashes.client,
      );
      const script = first.snapshot.assets.find(
        asset => asset.kind === 'script' && /\/main\./u.test(asset.href),
      );
      if (!script) throw new Error('The first compile emitted no script');
      const firstScript = Buffer.from(
        await (await fetch(new URL(script.href, app.address))).arrayBuffer(),
      );

      app.edit('second');
      const second = await until(app, 'second:replacement-compiler');
      expect(second.manifest.devCompilation.generation).toBeGreaterThan(
        first.manifest.devCompilation.generation,
      );
      expect(second.manifest.buildId).toBe(first.manifest.buildId);
      expect(
        second.snapshot.assets.find(
          asset => asset.kind === 'script' && /\/main\./u.test(asset.href),
        )?.href,
      ).not.toBe(script.href);
      // Pages opened before the edit still load their own scripts.
      const retained = await fetch(new URL(script.href, app.address));
      expect(retained.status).toBe(200);
      expect(Buffer.from(await retained.arrayBuffer())).toEqual(firstScript);

      // Saving again during a compile just leads to another compile.
      app.edit('third');
      app.edit('fourth');
      await until(app, 'fourth:replacement-compiler');
    },
    300_000,
  );

  it('rejects a mismatched compiler manifest and recovers on the next save', async () => {
    const app = await replacementApp(true);
    await until(app, 'first:replacement-compiler');
    app.poison(true);
    app.edit('rejected');
    await expect(
      (async () => {
        for (;;) {
          await app.authority.resolveSnapshot(
            app.identity,
            AbortSignal.timeout(30_000),
          );
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      })(),
    ).rejects.toThrow(/identity/iu);
    app.poison(false);
    app.edit('recovered');
    await until(app, 'recovered:replacement-compiler');
  }, 300_000);

  it('stops serving and removes its dev manifest when closed', async () => {
    const app = await replacementApp(true);
    await until(app, 'first:replacement-compiler');
    const manifest = path.join(
      app.root,
      'dist',
      RENDERER_DEVELOPMENT_DIRECTORY,
      RENDERER_BUILD_MANIFEST_FILE,
    );
    expect(fs.existsSync(manifest)).toBe(true);
    await app.authority.close();
    await expect(
      app.authority.resolveSnapshot(app.identity, AbortSignal.timeout(1_000)),
    ).rejects.toThrow(/closed/iu);
    expect(fs.existsSync(manifest)).toBe(false);
  }, 300_000);

  it.each([
    ['solid', false],
    ['octane', true],
  ] as const)(
    'server-renders each %s edit with the native compiler',
    async (renderer, module) => {
      const app = await nativeApp(renderer, module);
      const first = await until(app, 'first');
      expect(first.manifest.entries).toEqual(app.session.identities);
      expect(first.snapshot.manifest.rendererIdentity).toEqual(app.identity);
      app.edit(`${renderer}-second`);
      const second = await until(app, `${renderer}-second`);
      expect(second.manifest.devCompilation.generation).toBeGreaterThan(
        first.manifest.devCompilation.generation,
      );
      if (renderer === 'octane')
        expect(second.snapshot.hydrationBuildId).toBe(
          second.manifest.devCompilation.compilationHashes.client,
        );
    },
    300_000,
  );
});
