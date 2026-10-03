import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RendererBuildIdentities } from '@modern-js/app-tools-extensions/renderer-build-identity';
import {
  createRsbuild,
  type RsbuildPlugin,
  type Rspack,
  rspack,
} from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
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
    "import styles from './style.module.css'; document.body.dataset.selected = styles.selected;\n",
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
  }: {
    dependentWeb?: boolean;
    multiWeb?: boolean;
    dev?: boolean;
    mutateAuthored?: boolean;
  } = {},
) {
  let finalized = 0;
  let phase: ReactTypedCssPhase;
  let stats: Rspack.Stats | Rspack.MultiStats | undefined;
  let htmlPath = '';
  let producerRuns = 0;
  let persistedAcknowledgments = 0;
  const metadata: RsbuildPlugin = {
    name: 'test-owning-react-typed-css-phase',
    setup(api) {
      phase.install(api);
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
          : [compiler])
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
            },
          );
      });
      api.modifyHTMLTags((tags, { filename, environment }) => {
        if (environment.name === 'client') {
          htmlPath = filename;
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
    finalize: async () => {
      finalized++;
      return identities(root);
    },
  });
  const environment = {
    source: { entry: { main: path.join(root, 'src', 'main.js') } },
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
      plugins: [actualProducer(), metadata],
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
  } else result = await rsbuild.build();
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
    html,
  };
}

describe('React typed CSS metadata with the real native producer', () => {
  it('captures actual generated declaration bytes and replaces only owning pending HTML metadata', async () => {
    const root = fixture();
    const { resolved, finalized, htmlPath } = await compile(root);
    const declarations = fs.readFileSync(
      path.join(root, 'src', 'style.module.css.d.ts'),
      'utf8',
    );
    expect(declarations).toContain('selected');
    expect(declarations).toContain('automatically generated');
    expect(finalized).toBe(1);
    const html = fs.readFileSync(path.join(root, 'dist', htmlPath), 'utf8');
    expect(html).toContain(JSON.stringify(resolved.identities.main));
    expect(html).not.toContain('ultramodernPendingReactIdentity');
    expect(
      fs.readFileSync(path.join(root, 'src', 'authored.d.ts'), 'utf8'),
    ).toContain('string');
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
    expect(finalized).toBe(1);
    expect(
      fs.readFileSync(path.join(root, 'dist', htmlPath), 'utf8'),
    ).toContain(JSON.stringify(resolved.identities.main));
  });

  it('preserves the native producer acknowledgment in a warm persistent cache', async () => {
    const root = fixture();
    const cold = await compile(root);
    await closes.pop()!();
    const declarationTime = fs.statSync(
      path.join(root, 'src', 'style.module.css.d.ts'),
    ).mtimeMs;
    const warm = await compile(root);
    expect(cold.producerRuns).toBeGreaterThan(0);
    expect(warm.producerRuns).toBe(0);
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

  it('finalizes the real development document in the native memory output filesystem', async () => {
    const root = fixture();
    const { html, htmlPath, resolved } = await compile(root, { dev: true });
    expect(html).toContain(JSON.stringify(resolved.identities.main));
    expect(html).not.toContain('ultramodernPendingReactIdentity');
    expect(fs.existsSync(path.join(root, 'dist', htmlPath))).toBe(false);
  });

  it('rejects an unrelated authored declaration mutation during real production', async () => {
    await expect(compile(fixture(), { mutateAuthored: true })).rejects.toThrow(
      'React authored inputs changed',
    );
  });
});
