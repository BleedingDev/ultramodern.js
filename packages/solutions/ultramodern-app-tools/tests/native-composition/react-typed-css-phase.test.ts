import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import type { RendererBuildIdentities } from '@modern-js/app-tools-extensions/renderer-build-identity';
import {
  createRsbuild,
  type RsbuildPlugin,
  type Rspack,
  rspack,
} from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  isUltramodernReleaseIdentityBannerPlugin,
  UltramodernReleaseIdentityBannerPlugin,
} from '../../src/native-composition/preset';
import { REACT_RENDERER_IDENTITY_ELEMENT_ID } from '../../src/native-composition/react-build-metadata';
import { ReactTypedCssPhase } from '../../src/native-composition/react-typed-css-phase';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';

const roots: string[] = [];
const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closes.splice(0).map(close => close()));
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-react-real-typed-css-'),
  );
  roots.push(root);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'actual-typed-css-proof', private: true }),
  );
  fs.writeFileSync(
    path.join(root, 'src', 'style.module.css'),
    '.selected { color: red; }\n',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'authored.d.ts'),
    'export declare const authored: string;\n',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'main.js'),
    "import styles from './style.module.css'; document.body.dataset.selected = styles.selected; globalThis.actualBuildMarker = ULTRAMODERN_BUILD_MARKER; globalThis.actualSourceRevision = ULTRAMODERN_SOURCE_REVISION; globalThis.actualMarkerBranch = ULTRAMODERN_BUILD_MARKER.length === 64;\n",
  );
  return root;
}

function actualProducer(): RsbuildPlugin {
  const builder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../cli/builder/package.json',
  );
  return createRequire(builder)(
    '@rsbuild/plugin-typed-css-modules',
  ).pluginTypedCSSModules();
}

function identities(root: string): RendererBuildIdentities {
  const declarations = fs.readFileSync(
    path.join(root, 'src', 'style.module.css.d.ts'),
  );
  const buildMarker = createHash('sha256').update(declarations).digest('hex');
  const profile = resolveRendererProfile('react');
  const provider = { ...profile.router, framework: 'react-router' as const };
  return {
    identities: {
      main: {
        renderer: 'react',
        appId: 'actual-typed-css-proof',
        entryName: 'main',
        protocolVersion: 1,
        buildId: buildMarker,
      },
    },
    routerBindings: {
      main: {
        owner: '@modern-js/plugin-router',
        evidence: 'owned-default',
        defaultProvider: provider,
        providers: [provider],
      },
    },
    buildMarker,
    sourceRevision: 'workspace',
    inputDigest: buildMarker,
    profileDigest: 'b'.repeat(64),
    compilerDigest: 'c'.repeat(64),
    frameworkCohortDigest: 'd'.repeat(64),
    cacheAllowed: false,
    promotable: false,
  };
}

async function compile(
  root: string,
  {
    dependentWeb = false,
    multiWeb = false,
    dev = false,
    mutateAuthored = false,
    mutateAfterDiscovery = false,
    changedCompletedIdentity = false,
    watch = false,
    bindRuntimeIdentity = true,
    corruptCachedDeclaration,
    additionalPlugins = [],
  }: {
    dependentWeb?: boolean;
    multiWeb?: boolean;
    dev?: boolean;
    mutateAuthored?: boolean;
    mutateAfterDiscovery?: boolean;
    changedCompletedIdentity?: boolean;
    watch?: boolean;
    bindRuntimeIdentity?: boolean;
    corruptCachedDeclaration?: 'tamper' | 'missing';
    additionalPlugins?: RsbuildPlugin[];
  } = {},
) {
  let finalized = 0;
  let phase: ReactTypedCssPhase;
  let stats: Rspack.Stats | Rspack.MultiStats | undefined;
  let htmlPath = '';
  const previousHTML = new Map<string, string | undefined>();
  let producerRuns = 0;
  const producerPasses: Array<{
    compiler: string;
    pass: number;
    resource: string;
  }> = [];
  const compiledPasses: Array<{
    compiler: string;
    pass: number;
    modules: Array<{
      name?: string;
      built?: boolean;
      cached?: boolean;
    }>;
  }> = [];
  let persistedAcknowledgments = 0;
  let publications = 0;
  let discoveryPrivate = false;
  const metadata: RsbuildPlugin = {
    name: 'test-owning-react-typed-css-phase',
    setup(api) {
      phase.install(api);
      api.onBeforeBuild(async () => {
        let ready = false;
        void phase.resolveIdentities().then(
          () => {
            ready = true;
          },
          () => {},
        );
        await Promise.resolve();
        const output = path.join(root, 'dist', htmlPath);
        const previous = previousHTML.get(htmlPath);
        discoveryPrivate =
          finalized === 1 &&
          publications === 0 &&
          !ready &&
          (previous === undefined
            ? !fs.existsSync(output)
            : fs.readFileSync(output, 'utf8') === previous);
        if (mutateAfterDiscovery)
          fs.writeFileSync(
            path.join(root, 'src', 'authored.d.ts'),
            'export declare const authored: number;\n',
          );
      });
      api.onAfterBuild(({ stats: result }) => {
        stats = result;
      });
      api.onAfterCreateCompiler(({ compiler }) => {
        if (!dev)
          closes.push(
            () =>
              new Promise<void>((resolve, reject) =>
                compiler.close(error => (error ? reject(error) : resolve())),
              ),
          );
        for (const current of 'compilers' in compiler
          ? compiler.compilers
          : [compiler]) {
          let pass = 0;
          current.hooks.beforeRun.tap('test-native-pass', () => {
            pass++;
          });
          current.hooks.done.tap('test-native-pass', result => {
            const modules =
              result.toJson({
                all: false,
                modules: true,
                cachedModules: true,
                nestedModules: true,
              }).modules ?? [];
            compiledPasses.push({
              compiler: current.options.name!,
              pass,
              modules: modules
                .flatMap(module => [module, ...(module.modules ?? [])])
                .filter(module => module.name?.includes('style.module.css'))
                .map(module => ({
                  name: module.name,
                  built: module.built,
                  cached: module.cached,
                })),
            });
          });
          current.hooks.thisCompilation.tap(
            'test-native-cache-observation',
            compilation => {
              rspack.NormalModule.getCompilationHooks(compilation).loader.tap(
                'test-native-cache-observation',
                loaderContext => {
                  const acknowledgment = Object.getOwnPropertyDescriptor(
                    loaderContext,
                    'ultramodernReactTypedCssProduced',
                  );
                  if (typeof acknowledgment?.value === 'function')
                    Object.defineProperty(
                      loaderContext,
                      'ultramodernReactTypedCssProduced',
                      {
                        value: (...args: unknown[]) => {
                          producerRuns++;
                          producerPasses.push({
                            compiler: current.options.name!,
                            pass,
                            resource: loaderContext.resource,
                          });
                          return Reflect.apply(
                            acknowledgment.value,
                            loaderContext,
                            args,
                          );
                        },
                        configurable: true,
                      },
                    );
                },
              );
              compilation.hooks.finishModules.tap(
                'test-native-cache-observation',
                modules => {
                  for (const module of modules)
                    if (
                      Object.hasOwn(
                        module.buildInfo,
                        'ultramodernReactTypedCss',
                      )
                    )
                      persistedAcknowledgments++;
                },
              );
              if (corruptCachedDeclaration)
                compilation.hooks.processAssets.tap(
                  {
                    name: 'test-cached-declaration-checkpoint',
                    stage: rspack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
                  },
                  () => {
                    const declaration = path.join(
                      root,
                      'src',
                      'style.module.css.d.ts',
                    );
                    if (corruptCachedDeclaration === 'missing')
                      fs.unlinkSync(declaration);
                    else
                      fs.writeFileSync(
                        declaration,
                        'export declare const corrupt: string;\n',
                      );
                  },
                );
            },
          );
        }
      });
      api.modifyHTMLTags((tags, { filename, environment }) => {
        if (environment.name === 'client') {
          htmlPath = filename;
          if (!previousHTML.has(filename)) {
            const output = path.join(root, 'dist', filename);
            previousHTML.set(
              filename,
              fs.existsSync(output)
                ? fs.readFileSync(output, 'utf8')
                : undefined,
            );
          }
          tags.bodyTags.push({
            tag: 'script',
            attrs: {
              id: REACT_RENDERER_IDENTITY_ELEMENT_ID,
              type: 'application/json',
            },
            children: phase.pendingHTML(filename, 'main'),
          });
        }
        return tags;
      });
      if (dependentWeb)
        api.modifyRspackConfig((config, { environment }) => {
          if (environment.name === 'secondary')
            config.dependencies = ['client'];
          return config;
        });
      if (mutateAuthored)
        api.onAfterCreateCompiler(({ compiler }) => {
          const client =
            'compilers' in compiler
              ? compiler.compilers.find(
                  candidate => candidate.options.name === 'client',
                )!
              : compiler;
          client.hooks.thisCompilation.tap(
            'test-real-authored-mutation',
            compilation => {
              compilation.hooks.finishModules.tap(
                'test-real-authored-mutation',
                () =>
                  fs.writeFileSync(
                    path.join(root, 'src', 'authored.d.ts'),
                    'export declare const authored: number;\n',
                  ),
              );
            },
          );
        });
    },
  };
  phase = new ReactTypedCssPhase({
    appDirectory: root,
    internalDirectory: path.join(root, '.modern-js'),
    distDirectory: path.join(root, 'dist'),
    bindRuntimeIdentity,
    finalize: async () => {
      finalized++;
      const resolved = identities(root);
      return changedCompletedIdentity && finalized === 2
        ? { ...resolved, inputDigest: 'f'.repeat(64) }
        : resolved;
    },
    ...(dev
      ? {
          publishDevelopment: async () => {
            publications++;
          },
        }
      : {
          publishMetadata: async () => {
            publications++;
          },
        }),
  });
  const environment = {
    source: {
      entry: { main: path.join(root, 'src', 'main.js') },
      ...(!bindRuntimeIdentity
        ? {
            define: {
              ULTRAMODERN_BUILD_MARKER: JSON.stringify('a'.repeat(64)),
              ULTRAMODERN_SOURCE_REVISION: JSON.stringify('workspace'),
            },
          }
        : {}),
    },
    output: {
      target: 'web' as const,
      distPath: { root: path.join(root, 'dist') },
      cleanDistPath: false,
    },
    performance: {
      buildCache: { cacheDirectory: path.join(root, '.modern-js', 'cache') },
    },
  };
  const rsbuild = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      mode: dev ? 'development' : 'production',
      server: { host: '127.0.0.1', port: 0, printUrls: false },
      dev: { writeToDisk: false, hmr: false, liveReload: false },
      plugins: [actualProducer(), ...additionalPlugins, metadata],
      performance: { printFileSize: false },
      environments: {
        client: environment,
        ...(dependentWeb || multiWeb
          ? {
              secondary: {
                ...environment,
                output: {
                  ...environment.output,
                  distPath: { root: path.join(root, 'dist', 'secondary') },
                },
              },
            }
          : {}),
      },
    },
  });
  let html: string | undefined;
  let result;
  if (dev) {
    const server = await rsbuild.createDevServer({ getPortSilently: true });
    closes.push(() => server.close());
    const listening = await server.listen();
    await phase.resolveIdentities();
    html = await (await fetch(new URL(htmlPath, listening.urls[0]))).text();
  } else result = await rsbuild.build({ watch });
  const resolved = await phase.resolveIdentities();
  return {
    resolved,
    finalized,
    phase,
    result,
    stats: stats!,
    htmlPath,
    producerRuns,
    persistedAcknowledgments,
    producerPasses,
    compiledPasses,
    html,
    publications,
    discoveryPrivate,
  };
}

describe('React typed CSS metadata with the real native producer', () => {
  it('captures actual generated declaration bytes and replaces only owning pending HTML metadata', async () => {
    const root = fixture();
    const {
      resolved,
      finalized,
      htmlPath,
      publications,
      discoveryPrivate,
      stats,
    } = await compile(root);
    const declarations = fs.readFileSync(
      path.join(root, 'src', 'style.module.css.d.ts'),
      'utf8',
    );
    expect(declarations).toContain('selected');
    expect(declarations).toContain('automatically generated');
    expect(finalized).toBe(2);
    expect(publications).toBe(1);
    expect(discoveryPrivate).toBe(true);
    const html = fs.readFileSync(path.join(root, 'dist', htmlPath), 'utf8');
    expect(html).toContain(JSON.stringify(resolved.identities.main));
    expect(html).not.toContain('ultramodernPendingReactIdentity');
    expect(
      fs.readFileSync(path.join(root, 'src', 'authored.d.ts'), 'utf8'),
    ).toContain('string');
    const results = 'stats' in stats ? stats.stats : [stats];
    const compilation = results.find(
      result => result.compilation.name === 'client',
    )!.compilation;
    const bundle = compilation
      .getAssets()
      .find(asset => asset.name.endsWith('.js'))!;
    const execution = { document: { body: { dataset: {} } } };
    runInNewContext(bundle.source.source().toString(), execution);
    expect(execution).toMatchObject({
      actualBuildMarker: resolved.buildMarker,
      actualSourceRevision: resolved.sourceRevision,
      actualMarkerBranch: true,
    });
  });

  it('replaces only the actual compiled CJS preset banner across a realm boundary', async () => {
    const filename = path.resolve(
      __dirname,
      '../../dist/cjs/native-composition/preset.js',
    );
    const compiled: typeof import('../../src/native-composition/preset') =
      runInNewContext(
        `(function(require, module, exports, __filename, __dirname) {\n${fs.readFileSync(filename, 'utf8')}\n})(require, module, module.exports, __filename, __dirname); module.exports;`,
        {
          require: createRequire(filename),
          module: { exports: {} },
          __filename: filename,
          __dirname: path.dirname(filename),
          process,
        },
      );
    const preset = compiled.createPresetUltramodernConfig({
      deliveryUnit: {
        buildMarker: '1'.repeat(16),
        unitId: 'actual/typed-css-proof',
        version: '1.2.3',
      },
    });
    const configure = preset.tools?.rspack;
    if (typeof configure !== 'function')
      throw new Error('Compiled owning preset did not expose its native hook');
    let owningBanner: unknown;
    const plugin: RsbuildPlugin = {
      name: 'test-compiled-preset-banner',
      setup(api) {
        api.modifyRspackConfig(async (config, utils) => {
          const configured = (await configure(config, utils)) ?? config;
          const banner = configured.plugins?.find(
            isUltramodernReleaseIdentityBannerPlugin,
          );
          if (!banner)
            throw new Error('Compiled preset banner has no owning marker');
          owningBanner = banner;
          configured.plugins ??= [];
          configured.plugins.push(
            new rspack.BannerPlugin({
              banner: 'void "unrelated-authored-banner";',
              raw: true,
              stage: rspack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
            }),
          );
          return configured;
        });
      },
    };
    const root = fixture();
    const built = await compile(root, { additionalPlugins: [plugin] });
    expect(owningBanner).not.toBeInstanceOf(
      UltramodernReleaseIdentityBannerPlugin,
    );
    expect(isUltramodernReleaseIdentityBannerPlugin(owningBanner)).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(
        owningBanner,
        Symbol.for('@modern-js/ultramodern-app-tools/release-identity-banner'),
      ),
    ).toEqual({
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    const legacyMarker = preset.source?.globalVars?.ULTRAMODERN_BUILD_MARKER;
    expect(legacyMarker).toMatch(/^[0-9a-f]{16}$/u);
    const results = 'stats' in built.stats ? built.stats.stats : [built.stats];
    for (const result of results)
      for (const asset of result.compilation.getAssets()) {
        if (!asset.name.endsWith('.js')) continue;
        const source = asset.source.source().toString();
        expect(source).not.toContain(legacyMarker);
        expect(source).toContain(
          `void ${JSON.stringify(built.resolved.buildMarker)}`,
        );
        expect(source).toContain('unrelated-authored-banner');
      }
  });

  it.each([
    false,
    true,
  ])('finishes two real web producers without a module-phase barrier, dependent=%s', async dependentWeb => {
    const root = fixture();
    const { resolved, finalized, htmlPath } = await compile(root, {
      multiWeb: true,
      dependentWeb,
    });
    expect(finalized).toBe(2);
    expect(
      fs.readFileSync(path.join(root, 'dist', htmlPath), 'utf8'),
    ).toContain(JSON.stringify(resolved.identities.main));
  });

  it('preserves the native producer acknowledgment in a warm persistent cache', async () => {
    const root = fixture();
    const cold = await compile(root, { bindRuntimeIdentity: false });
    await closes.pop()!();
    const declarationTime = fs.statSync(
      path.join(root, 'src', 'style.module.css.d.ts'),
    ).mtimeMs;
    const warm = await compile(root, { bindRuntimeIdentity: false });
    expect(cold.producerRuns).toBeGreaterThan(0);
    expect(
      warm.producerRuns,
      JSON.stringify({
        cold: {
          producerPasses: cold.producerPasses,
          compiledPasses: cold.compiledPasses,
        },
        warm: {
          producerPasses: warm.producerPasses,
          compiledPasses: warm.compiledPasses,
        },
      }),
    ).toBe(0);
    expect(warm.persistedAcknowledgments).toBeGreaterThan(0);
    expect(warm.resolved.identities).toEqual(cold.resolved.identities);
    expect(
      fs.statSync(path.join(root, 'src', 'style.module.css.d.ts')).mtimeMs,
    ).toBe(declarationTime);
    const results = 'stats' in warm.stats ? warm.stats.stats : [warm.stats];
    const json = results
      .find(result => result.compilation.name === 'client')!
      .toJson({
        all: false,
        modules: true,
        cachedModules: true,
        nestedModules: true,
      });
    const modules =
      json.modules?.flatMap(module => [module, ...(module.modules ?? [])]) ??
      [];
    const css = modules.find(module =>
      module.name?.includes('style.module.css'),
    );
    expect(css).toBeDefined();
    expect(css?.built).toBe(false);
  });

  it('measures native unbound cache reuse across two public compiler runs', async () => {
    const root = fixture();
    fs.writeFileSync(
      path.join(root, 'src', 'main.js'),
      "import styles from './style.module.css'; document.body.dataset.selected = styles.selected;\n",
    );
    const runTwice = async () => {
      const rsbuild = await createRsbuild({
        cwd: root,
        rsbuildConfig: {
          mode: 'production',
          plugins: [actualProducer()],
          source: { entry: { main: path.join(root, 'src', 'main.js') } },
          output: {
            target: 'web',
            distPath: { root: path.join(root, 'dist') },
            cleanDistPath: false,
          },
          performance: {
            printFileSize: false,
            buildCache: {
              cacheDirectory: path.join(root, '.modern-js', 'cache'),
            },
          },
        },
      });
      const compiler = await rsbuild.createCompiler();
      const observations: Array<{ built: boolean | undefined }> = [];
      try {
        for (let pass = 0; pass < 2; pass++) {
          const stats = await new Promise<Rspack.Stats | Rspack.MultiStats>(
            (resolve, reject) =>
              compiler.run((error, result) => {
                if (error) reject(error);
                else if (!result || result.hasErrors())
                  reject(new Error('Native cache control did not compile'));
                else resolve(result);
              }),
          );
          const result = 'stats' in stats ? stats.stats[0] : stats;
          const modules =
            result.toJson({
              all: false,
              modules: true,
              cachedModules: true,
              nestedModules: true,
            }).modules ?? [];
          const css = modules
            .flatMap(module => [module, ...(module.modules ?? [])])
            .find(module => module.name?.includes('style.module.css'));
          expect(css).toBeDefined();
          observations.push({ built: css?.built });
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          compiler.close(error => (error ? reject(error) : resolve())),
        );
      }
      return observations;
    };
    const cold = await runTwice();
    const declaration = path.join(root, 'src', 'style.module.css.d.ts');
    const bytes = fs.readFileSync(declaration, 'utf8');
    const warm = await runTwice();
    // Native repeated run recompiles CSS even without owning phase hooks,
    // RuntimeModule, banners or DefinePlugin. Its first run restores the cache.
    expect(cold).toEqual([{ built: true }, { built: true }]);
    expect(warm).toEqual([{ built: false }, { built: true }]);
    expect(fs.readFileSync(declaration, 'utf8')).toBe(bytes);
  });

  it('restores cached acknowledgments before the native second emitting run', async () => {
    const root = fixture();
    const cold = await compile(root);
    await closes.pop()!();
    const declaration = path.join(root, 'src', 'style.module.css.d.ts');
    const bytes = fs.readFileSync(declaration, 'utf8');
    const warm = await compile(root);
    expect(warm.producerPasses.map(record => record.pass)).toEqual([2]);
    expect(
      warm.compiledPasses.map(
        pass =>
          pass.modules.find(module => module.name?.includes('style.module.css'))
            ?.built,
      ),
    ).toEqual([false, true]);
    expect(warm.persistedAcknowledgments).toBeGreaterThan(0);
    expect(warm.resolved).toEqual(cold.resolved);
    expect(warm.finalized).toBe(2);
    expect(warm.publications).toBe(1);
    expect(warm.discoveryPrivate).toBe(true);
    expect(fs.readFileSync(declaration, 'utf8')).toBe(bytes);
    const results = 'stats' in warm.stats ? warm.stats.stats : [warm.stats];
    const compilation = results.find(
      result => result.compilation.name === 'client',
    )!.compilation;
    const bundle = compilation
      .getAssets()
      .find(asset => asset.name.endsWith('.js'))!;
    const execution = { document: { body: { dataset: {} } } };
    const source = bundle.source.source().toString();
    runInNewContext(source, execution);
    expect(source).toContain(
      `void ${JSON.stringify(warm.resolved.buildMarker)}`,
    );
    expect(execution).toMatchObject({
      actualBuildMarker: warm.resolved.buildMarker,
      actualSourceRevision: warm.resolved.sourceRevision,
      actualMarkerBranch: true,
    });
  });

  it('finalizes the real development document in the native memory output filesystem', async () => {
    const root = fixture();
    const { html, htmlPath, resolved } = await compile(root, { dev: true });
    expect(html).toContain(JSON.stringify(resolved.identities.main));
    expect(html).not.toContain('ultramodernPendingReactIdentity');
    expect(fs.existsSync(path.join(root, 'dist', htmlPath))).toBe(false);
  });

  it.each([
    'tamper',
    'missing',
  ] as const)('rejects %s of an acknowledged declaration at the cached graph checkpoint', async change => {
    const root = fixture();
    await compile(root);
    await closes.pop()!();
    const declaration = path.join(root, 'src', 'style.module.css.d.ts');
    await expect(
      compile(root, { corruptCachedDeclaration: change }),
    ).rejects.toThrow(/cached producer output is missing or changed|ENOENT/u);
    if (change === 'missing') expect(fs.existsSync(declaration)).toBe(false);
    else
      expect(fs.readFileSync(declaration, 'utf8')).toBe(
        'export declare const corrupt: string;\n',
      );
  });

  it('rejects an unrelated authored declaration mutation during real production', async () => {
    await expect(compile(fixture(), { mutateAuthored: true })).rejects.toThrow(
      'React authored inputs changed',
    );
  });

  it('rejects an authored change after private discovery and before emission', async () => {
    await expect(
      compile(fixture(), { mutateAfterDiscovery: true }),
    ).rejects.toThrow('React authored inputs changed');
  });

  it('rejects a changed completed compiler identity before publication', async () => {
    await expect(
      compile(fixture(), { changedCompletedIdentity: true }),
    ).rejects.toThrow(
      'Native build inputs changed during compilation (inputDigest)',
    );
  });

  it('rejects production watch before emitting a stale runtime identity', async () => {
    await expect(compile(fixture(), { watch: true })).rejects.toThrow(
      'React production build --watch',
    );
  });
});
