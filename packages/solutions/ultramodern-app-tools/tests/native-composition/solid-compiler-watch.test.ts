import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findHostingModuleDirectory } from '@modern-js/app-tools-extensions/runtime-package-resolution';
import type { RendererIdentity } from '@modern-js/renderer-core';
import {
  createRsbuild,
  type RsbuildDevServer,
  type RsbuildPluginAPI,
  type Rspack,
} from '@rsbuild/core';
import { expect, it } from '@rstest/core';
import { resolveRendererProfileMetadata } from '../../src/native-composition/renderer-profile';
import {
  pluginSolidRenderer,
  validateSolidModuleManifest,
} from '../../src/renderers/solid/compiler';

function receipts() {
  const values: Rspack.Stats[] = [];
  let pending: ((stats: Rspack.Stats) => void) | undefined;
  return {
    push(stats: Rspack.Stats) {
      if (pending) {
        const resolve = pending;
        pending = undefined;
        resolve(stats);
      } else values.push(stats);
    },
    async next(label: string) {
      if (values.length) return values.shift()!;
      return new Promise<Rspack.Stats>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = undefined;
          reject(new Error(`Timed out waiting for Solid ${label} Stats`));
        }, 30_000);
        pending = stats => {
          clearTimeout(timer);
          resolve(stats);
        };
      });
    },
  };
}

it('keeps one real watcher alive across initial syntax, discovery and missing lazy-module errors', async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'solid-watch-'),
    ),
  );
  let dev: RsbuildDevServer | undefined;
  try {
    const metadata = resolveRendererProfileMetadata('solid');
    const dependencies: Record<string, string> = {};
    const bindings = new Map(
      metadata.frameworkPackages.map(owner => [
        owner.specifier,
        owner.directory,
      ]),
    );
    for (const specifier of new Set([
      ...bindings.keys(),
      ...Object.keys(metadata.profile.dependencies),
      '@modern-js/renderer-core',
    ])) {
      let directory = bindings.get(specifier);
      if (!directory) {
        const hosting = metadata.frameworkPackages
          .map(owner => findHostingModuleDirectory(specifier, owner.directory))
          .find(Boolean);
        if (!hosting)
          throw new Error(`No installed native owner for ${specifier}`);
        directory = fs.realpathSync(path.join(hosting, specifier));
      }
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
    const app = path.join(root, 'src/App.ts');
    const inventory = path.join(root, 'src/Inventory.ts');
    const lazy = path.join(root, 'shared/Lazy.ts');
    const added = path.join(root, 'shared/Added.ts');
    fs.mkdirSync(path.dirname(app), { recursive: true });
    fs.mkdirSync(path.dirname(lazy), { recursive: true });
    fs.writeFileSync(app, 'export const value = broken syntax;\n');
    const lazySource = (name: string) =>
      `import { lazy } from 'solid-js'; export const View = lazy(() => import('../shared/${name}'));\n`;
    fs.writeFileSync(inventory, lazySource('Lazy'));
    fs.writeFileSync(
      lazy,
      "export default function Lazy() { return 'lazy'; }\n",
    );
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'solid-watch-regression',
        private: true,
        dependencies,
      }),
    );
    const identity: RendererIdentity = {
      renderer: 'solid',
      appId: 'solid-watch-regression',
      entryName: 'main',
      protocolVersion: 1,
      buildId: createHash('sha256').update(root).digest('hex'),
    };
    const completed = receipts();
    const fatalErrors: Error[] = [];
    const observedCompilers: Rspack.Compiler[] = [];
    let watchClosures = 0;
    const rsbuild = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        plugins: [
          pluginSolidRenderer({
            rendererIdentities: () => ({ main: identity }),
          }),
          {
            name: 'observe-solid-watch-recovery',
            setup(api: RsbuildPluginAPI) {
              api.onAfterCreateCompiler(({ compiler }) => {
                const compilers =
                  'compilers' in compiler ? compiler.compilers : [compiler];
                expect(compilers).toHaveLength(1);
                const actual = compilers[0];
                if (!actual)
                  throw new Error('Actual Solid compiler is missing');
                observedCompilers.push(actual);
                actual.hooks.done.tap('SolidWatchReceipts', stats => {
                  completed.push(stats);
                });
                actual.hooks.failed.tap('SolidWatchReceipts', error => {
                  fatalErrors.push(error);
                });
                actual.hooks.watchClose.tap('SolidWatchReceipts', () => {
                  watchClosures++;
                });
              });
            },
          },
        ],
        source: { entry: { main: app } },
        server: { host: '127.0.0.1', port: 0, printUrls: false },
        dev: { writeToDisk: false, hmr: false, liveReload: false },
        output: { target: 'web', minify: false, sourceMap: false },
        performance: { printFileSize: false },
        tools: { htmlPlugin: false },
      },
    });
    dev = await rsbuild.createDevServer({ getPortSilently: true });
    await dev.listen();
    const manifestName = 'solid-module-manifest.main.json';
    const assertError = (stats: Rspack.Stats, filename: string) => {
      expect(stats.hasErrors()).toBe(true);
      expect(stats.compilation.entrypoints.has('main')).toBe(true);
      const diagnostics = stats.toJson({
        all: false,
        errors: true,
        errorDetails: true,
      }).errors;
      expect(
        diagnostics?.some(error =>
          error.message.includes(`Solid lazy discovery failed in ${filename}`),
        ),
      ).toBe(true);
      expect(stats.compilation.getAsset(manifestName)).toBeUndefined();
      expect(fatalErrors).toEqual([]);
      expect(watchClosures).toBe(0);
    };
    const assertReady = (stats: Rspack.Stats, key: string) => {
      expect(stats.hasErrors()).toBe(false);
      const asset = stats.compilation.getAsset(manifestName);
      if (!asset) throw new Error('Successful Solid manifest is missing');
      const manifest = validateSolidModuleManifest(
        JSON.parse(asset.source.source().toString()),
        identity,
      );
      expect(manifest.modules[key]).toBeDefined();
      expect(fatalErrors).toEqual([]);
      expect(watchClosures).toBe(0);
      expect(observedCompilers).toHaveLength(1);
    };

    const initial = await completed.next('initial syntax-error');
    assertError(initial, app);
    expect(
      [...initial.compilation.modules].some(
        module => module.nameForCondition() === app,
      ),
    ).toBe(true);
    fs.writeFileSync(app, "export const value = 'repaired';\n");
    assertReady(await completed.next('syntax recovery'), 'shared/Lazy.ts');

    // This source is deliberately outside the entry graph: only discovery parses it.
    fs.writeFileSync(inventory, 'export const View = broken syntax;\n');
    assertError(await completed.next('discovery-only error'), inventory);
    fs.writeFileSync(inventory, lazySource('Lazy'));
    assertReady(await completed.next('discovery recovery'), 'shared/Lazy.ts');

    // The missing target is outside src; its candidates must remain watched.
    fs.writeFileSync(inventory, lazySource('Added'));
    assertError(await completed.next('missing lazy module'), inventory);
    fs.writeFileSync(
      added,
      "export default function Added() { return 'added'; }\n",
    );
    assertReady(
      await completed.next('missing-module recovery'),
      'shared/Added.ts',
    );
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false);
  } finally {
    await dev?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
