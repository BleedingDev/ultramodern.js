import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import {
  isConfigInstalledDependencyPath,
  withConfigDependencyResolution,
} from '../../src/native-composition/config-evaluator/dependency-resolution';
import { initializeOwningConfigNativeBinding } from '../../src/native-composition/config-evaluator/native-bootstrap';
import { observeConfigSourceInputs } from '../../src/native-composition/config-evaluator/observed-inputs';
import { captureConfigSourceSnapshot } from '../../src/native-composition/config-evaluator/source-snapshot';
import { readRendererFrameworkPackage } from '../../src/native-composition/renderer-installed-profile';

interface Fixture {
  directory: string;
  app: string;
  host: string;
  secondHost: string;
  outside: string;
}

async function fixture(run: (value: Fixture) => Promise<void>): Promise<void> {
  const directory = fs.realpathSync(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'ultramodern-config-dependencies-',
      ),
    ),
  );
  try {
    const roots = ['app', 'host', 'second-host', 'outside'].map(name => {
      const root = path.join(directory, name);
      fs.mkdirSync(root);
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          name,
          type: 'commonjs',
          exports: { '.': './index.cjs' },
          dependencies: {},
        }),
      );
      fs.writeFileSync(
        path.join(root, 'index.cjs'),
        `module.exports='${name}';`,
      );
      fs.writeFileSync(path.join(root, 'config.cjs'), '');
      return root;
    });
    await run({
      directory,
      app: roots[0],
      host: roots[1],
      secondHost: roots[2],
      outside: roots[3],
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function declare(root: string, name: string, field = 'dependencies'): void {
  const filename = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
  manifest[field] = { ...manifest[field], [name]: '1.0.0' };
  fs.writeFileSync(filename, JSON.stringify(manifest));
}

function install(
  root: string,
  name: string,
  value: string,
  manifest: Record<string, unknown> = {},
): string {
  const directory = path.join(root, 'node_modules', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      type: 'commonjs',
      exports: './index.cjs',
      ...manifest,
    }),
  );
  fs.writeFileSync(
    path.join(directory, 'index.cjs'),
    `module.exports='${value}';`,
  );
  return directory;
}

function requestFrom(root: string): NodeJS.Require {
  return createRequire(path.join(root, 'config.cjs'));
}

describe('original config dependency resolution', () => {
  it('accepts authored config directories without a package manifest', async () =>
    fixture(async ({ directory, host }) => {
      const sources = path.join(directory, 'shared-config');
      fs.mkdirSync(sources);
      fs.writeFileSync(path.join(sources, 'config.cjs'), '');
      declare(host, 'shared-cohort');
      install(host, 'shared-cohort', 'shared');
      await withConfigDependencyResolution(
        { sourceRoots: [sources], dependencyRoots: [host] },
        async () =>
          expect(requestFrom(sources)('shared-cohort')).toBe('shared'),
      );
    }));

  it('prefers the original app and falls back only to audited runtime dependencies', async () =>
    fixture(async ({ app, host }) => {
      for (const name of ['app-first', 'host-only']) declare(host, name);
      declare(host, 'optional-only', 'optionalDependencies');
      declare(host, 'development-only', 'devDependencies');
      install(app, 'app-first', 'app');
      install(host, 'app-first', 'host');
      install(host, 'host-only', 'host-only');
      install(host, 'optional-only', 'optional');
      install(host, 'development-only', 'development');
      install(host, 'undeclared', 'undeclared');
      await withConfigDependencyResolution(
        { sourceRoots: [app], dependencyRoots: [host] },
        async () => {
          const request = requestFrom(app);
          expect(request('app-first')).toBe('app');
          expect(request('host-only')).toBe('host-only');
          expect(request('optional-only')).toBe('optional');
          expect(() => request('development-only')).toThrow('development-only');
          expect(() => request('undeclared')).toThrow('undeclared');
        },
      );
    }));

  it('preserves native import and require export conditions through delayed callbacks', async () =>
    fixture(async ({ app, host }) => {
      declare(host, 'conditional-cohort');
      const dependency = install(host, 'conditional-cohort', 'require', {
        exports: { import: './import.mjs', require: './index.cjs' },
      });
      fs.writeFileSync(
        path.join(dependency, 'import.mjs'),
        "export default 'import';",
      );
      const filename = path.join(app, 'config.mjs');
      fs.writeFileSync(
        filename,
        "import value from 'conditional-cohort'; export default async () => { await new Promise(resolve => setTimeout(resolve, 1)); return [value, (await import('conditional-cohort')).default, import.meta.url]; };",
      );
      await withConfigDependencyResolution(
        { sourceRoots: [app], dependencyRoots: [host] },
        async () => {
          expect(requestFrom(app)('conditional-cohort')).toBe('require');
          const namespace = await import(
            /* webpackIgnore: true */ pathToFileURL(filename).href
          );
          expect(await namespace.default()).toEqual([
            'import',
            'import',
            pathToFileURL(filename).href,
          ]);
        },
      );
    }));

  it.each([
    'cjs',
    'esm',
  ] as const)('observes the selected aliased package owner from an installed %s parent', async mode =>
    fixture(async ({ app, host, outside }) => {
      declare(host, 'installed-parent');
      const parent = install(host, 'installed-parent', 'parent', {
        exports: { require: './index.cjs', import: './index.mjs' },
        dependencies: { 'framework-alias': '1.2.3' },
      });
      const runtime = path.join(outside, 'physical-runtime');
      for (const format of ['cjs', 'esm-node']) {
        fs.mkdirSync(path.join(runtime, 'dist', format, 'cli'), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(runtime, 'dist', format, 'package.json'),
          JSON.stringify({
            type: format === 'cjs' ? 'commonjs' : 'module',
          }),
        );
      }
      fs.writeFileSync(
        path.join(runtime, 'package.json'),
        JSON.stringify({
          name: '@renamed/physical-runtime',
          version: '1.2.3',
          exports: {
            './manifest': {
              require: './dist/cjs/cli/index.cjs',
              import: './dist/esm-node/cli/index.mjs',
            },
          },
        }),
      );
      fs.writeFileSync(
        path.join(runtime, 'dist/cjs/cli/index.cjs'),
        'module.exports = __filename;',
      );
      fs.writeFileSync(
        path.join(runtime, 'dist/esm-node/cli/index.mjs'),
        'export default import.meta.url;',
      );
      fs.mkdirSync(path.join(parent, 'node_modules'));
      fs.symlinkSync(
        runtime,
        path.join(parent, 'node_modules/framework-alias'),
      );
      fs.writeFileSync(
        path.join(parent, 'index.cjs'),
        "module.exports = () => require.resolve('framework-alias/manifest');",
      );
      fs.writeFileSync(
        path.join(parent, 'index.mjs'),
        "import filename from 'framework-alias/manifest'; export default filename;",
      );
      const baseline = captureConfigSourceSnapshot({ sourceRoots: [app] });
      const binding = initializeOwningConfigNativeBinding();
      const observed = await withConfigDependencyResolution(
        { sourceRoots: [app], dependencyRoots: [host] },
        () =>
          observeConfigSourceInputs(
            baseline,
            async () => {
              expect(
                isConfigInstalledDependencyPath(
                  path.join(
                    runtime,
                    'dist',
                    mode === 'cjs' ? 'cjs' : 'esm-node',
                    'cli/package.json',
                  ),
                ),
              ).toBe(false);
              const filename =
                mode === 'cjs'
                  ? requestFrom(app)('installed-parent')()
                  : fileURLToPath(
                      (
                        await import(
                          /* webpackIgnore: true */ pathToFileURL(
                            path.join(parent, 'index.mjs'),
                          ).href
                        )
                      ).default,
                    );
              // This real owning lookup probes missing nested manifests and
              // skips format markers before reading the physical owner.
              const owner = readRendererFrameworkPackage({
                specifier: 'framework-alias',
                filename,
              });
              expect(
                isConfigInstalledDependencyPath(
                  path.join(outside, 'unrelated.json'),
                ),
              ).toBe(false);
              return owner;
            },
            isConfigInstalledDependencyPath,
            undefined,
            binding,
          ),
      );
      expect(observed.value).toEqual({
        specifier: 'framework-alias',
        name: '@renamed/physical-runtime',
        version: '1.2.3',
        directory: runtime,
      });
    }));

  it.each([
    'relative-only',
    'self-reference',
  ] as const)('does not promote a %s installed descendant to sibling source authority', async mode =>
    fixture(async ({ app, host, outside }) => {
      declare(host, 'relative-parent');
      const parent = install(host, 'relative-parent', 'parent');
      const shared = path.join(outside, 'authored-shared');
      fs.mkdirSync(shared);
      fs.writeFileSync(
        path.join(shared, 'package.json'),
        JSON.stringify({
          name: 'authored-shared',
          version: '1.0.0',
          exports: './entry.cjs',
        }),
      );
      fs.writeFileSync(path.join(shared, 'selection.json'), '"solid"');
      fs.writeFileSync(
        path.join(shared, 'entry.cjs'),
        `${mode === 'self-reference' ? "require.resolve('authored-shared');" : ''}
module.exports = () => require('node:fs').readFileSync(require('node:path').join(__dirname, 'selection.json'), 'utf8');`,
      );
      fs.writeFileSync(
        path.join(parent, 'index.cjs'),
        `module.exports = require(${JSON.stringify(path.relative(parent, path.join(shared, 'entry.cjs')))});`,
      );
      const baseline = captureConfigSourceSnapshot({ sourceRoots: [app] });
      const binding = initializeOwningConfigNativeBinding();
      await expect(
        withConfigDependencyResolution(
          { sourceRoots: [app], dependencyRoots: [host] },
          () =>
            observeConfigSourceInputs(
              baseline,
              async () => requestFrom(app)('relative-parent')(),
              isConfigInstalledDependencyPath,
              undefined,
              binding,
            ),
        ),
      ).rejects.toThrow(
        `uncovered source path ${path.join(shared, 'selection.json')}`,
      );
    }));

  it('resolves the exact cohort root own name through its Node exports or main', async () =>
    fixture(async ({ app, host, secondHost }) => {
      const filename = path.join(secondHost, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
      delete manifest.exports;
      manifest.main = './index.cjs';
      fs.writeFileSync(filename, JSON.stringify(manifest));
      await withConfigDependencyResolution(
        { sourceRoots: [app], dependencyRoots: [host, secondHost] },
        async () => {
          expect(requestFrom(app)('host')).toBe('host');
          expect(requestFrom(app)('second-host')).toBe('second-host');
        },
      );
    }));

  it('uses declared roots in order and continues only when their dependency is absent', async () =>
    fixture(async ({ app, host, secondHost }) => {
      declare(host, 'missing-first');
      declare(secondHost, 'missing-first');
      declare(secondHost, 'second-only');
      declare(host, 'first-wins');
      declare(secondHost, 'first-wins');
      install(secondHost, 'missing-first', 'second');
      install(secondHost, 'second-only', 'second-only');
      install(host, 'first-wins', 'first');
      install(secondHost, 'first-wins', 'second');
      await withConfigDependencyResolution(
        { sourceRoots: [app], dependencyRoots: [host, secondHost] },
        async () => {
          expect(requestFrom(app)('missing-first')).toBe('second');
          expect(requestFrom(app)('second-only')).toBe('second-only');
          expect(requestFrom(app)('first-wins')).toBe('first');
        },
      );
    }));

  it.each([
    [
      'invalid-exports',
      { exports: { './allowed': './index.cjs' } },
      'ERR_PACKAGE_PATH_NOT_EXPORTED',
    ],
    ['invalid-main', { exports: './missing.cjs' }, 'MODULE_NOT_FOUND'],
  ] as const)('preserves the installed app %s error', async (name, manifest, code) =>
    fixture(async ({ app, host }) => {
      declare(host, name);
      install(host, name, 'hidden fallback');
      install(app, name, 'app', manifest);
      await expect(
        withConfigDependencyResolution(
          { sourceRoots: [app], dependencyRoots: [host] },
          async () => requestFrom(app)(name),
        ),
      ).rejects.toMatchObject({ code });
    }));

  it('does not replace installed app evaluation failures', async () =>
    fixture(async ({ app, host }) => {
      declare(host, 'throwing-app');
      install(host, 'throwing-app', 'hidden fallback');
      const dependency = install(app, 'throwing-app', 'app');
      fs.writeFileSync(
        path.join(dependency, 'index.cjs'),
        "throw new Error('APP_FAILURE');",
      );
      await expect(
        withConfigDependencyResolution(
          { sourceRoots: [app], dependencyRoots: [host] },
          async () => requestFrom(app)('throwing-app'),
        ),
      ).rejects.toThrow('APP_FAILURE');
    }));

  it('stops at an installed invalid cohort dependency instead of trying a later root', async () =>
    fixture(async ({ app, host, secondHost }) => {
      for (const root of [host, secondHost]) declare(root, 'broken-cohort');
      install(host, 'broken-cohort', 'broken', { exports: './missing.cjs' });
      install(secondHost, 'broken-cohort', 'hidden fallback');
      await expect(
        withConfigDependencyResolution(
          { sourceRoots: [app], dependencyRoots: [host, secondHost] },
          async () => requestFrom(app)('broken-cohort'),
        ),
      ).rejects.toMatchObject({ code: 'MODULE_NOT_FOUND' });
    }));

  it('does not rescue a missing dependency imported by an installed app package', async () =>
    fixture(async ({ app, host }) => {
      declare(host, 'missing-transitive');
      install(host, 'missing-transitive', 'hidden fallback');
      const dependency = install(app, 'app-plugin', 'app');
      fs.writeFileSync(
        path.join(dependency, 'index.cjs'),
        "module.exports=require('missing-transitive');",
      );
      await expect(
        withConfigDependencyResolution(
          { sourceRoots: [app], dependencyRoots: [host] },
          async () => requestFrom(app)('app-plugin'),
        ),
      ).rejects.toMatchObject({ code: 'MODULE_NOT_FOUND' });
    }));

  it('does not rescue cohort transitive imports under broad authored workspace coverage', async () =>
    fixture(async ({ directory, app, host, secondHost }) => {
      for (const root of [host, secondHost]) declare(root, 'cohort-helper');
      install(secondHost, 'cohort-helper', 'second-cohort-helper');
      fs.writeFileSync(
        path.join(host, 'index.cjs'),
        "module.exports=require('cohort-helper');",
      );
      fs.writeFileSync(
        path.join(app, 'authored-helper.cjs'),
        "module.exports=require('cohort-helper');",
      );
      const operation = withConfigDependencyResolution(
        { sourceRoots: [directory], dependencyRoots: [host, secondHost] },
        async () => {
          const request = requestFrom(app);
          expect(request('./authored-helper.cjs')).toBe('second-cohort-helper');
          return request('host');
        },
      );
      await expect(operation).rejects.toMatchObject({
        code: 'MODULE_NOT_FOUND',
      });
      await expect(operation).rejects.toThrow('cohort-helper');
    }));

  it.each([
    'require',
    'import',
  ] as const)('does not rescue workspace symlink dependency transitive %s imports', async mode =>
    fixture(async ({ directory, app, host }) => {
      declare(host, 'missing-workspace-helper');
      install(host, 'missing-workspace-helper', 'hidden fallback');
      const plugin = path.join(directory, 'packages', 'local-plugin');
      fs.mkdirSync(plugin, { recursive: true });
      fs.writeFileSync(
        path.join(plugin, 'package.json'),
        JSON.stringify({
          name: 'local-plugin',
          exports: { import: './index.mjs', require: './index.cjs' },
        }),
      );
      fs.writeFileSync(
        path.join(plugin, 'index.cjs'),
        "module.exports=require('missing-workspace-helper');",
      );
      fs.writeFileSync(
        path.join(plugin, 'index.mjs'),
        "import value from 'missing-workspace-helper'; export default value;",
      );
      fs.mkdirSync(path.join(app, 'node_modules'));
      fs.symlinkSync(plugin, path.join(app, 'node_modules', 'app-plugin'));
      const config = path.join(app, 'workspace-plugin.config.mjs');
      fs.writeFileSync(
        config,
        "import value from 'app-plugin'; export default value;",
      );
      fs.writeFileSync(
        path.join(app, 'authored-helper.cjs'),
        "module.exports=require('missing-workspace-helper');",
      );
      const operation = withConfigDependencyResolution(
        { sourceRoots: [directory], dependencyRoots: [host] },
        async () => {
          expect(requestFrom(app)('./authored-helper.cjs')).toBe(
            'hidden fallback',
          );
          if (mode === 'require') return requestFrom(app)('app-plugin');
          return import(/* webpackIgnore: true */ pathToFileURL(config).href);
        },
      );
      await expect(operation).rejects.toMatchObject({
        code: mode === 'require' ? 'MODULE_NOT_FOUND' : 'ERR_MODULE_NOT_FOUND',
      });
      await expect(operation).rejects.toThrow('missing-workspace-helper');
    }));

  it('rejects canonical dependency parents and source links escaping the authored roots', async () =>
    fixture(async ({ app, host, outside }) => {
      declare(host, 'missing-transitive');
      install(host, 'missing-transitive', 'hidden fallback');
      const dependency = install(app, 'app-plugin', 'app');
      fs.writeFileSync(path.join(dependency, 'index.cjs'), '');
      const alias = path.join(app, 'alias.cjs');
      fs.symlinkSync(path.join(dependency, 'index.cjs'), alias);
      const escapingAlias = path.join(app, 'escape.cjs');
      fs.symlinkSync(path.join(outside, 'config.cjs'), escapingAlias);
      await withConfigDependencyResolution(
        { sourceRoots: [app], dependencyRoots: [host] },
        async () => {
          expect(() => createRequire(alias)('missing-transitive')).toThrow(
            'missing-transitive',
          );
          expect(() =>
            createRequire(escapingAlias)('missing-transitive'),
          ).toThrow('missing-transitive');
          expect(() => requestFrom(app)('./missing-transitive')).toThrow(
            'missing-transitive',
          );
        },
      );
    }));

  it.each([
    'exported-link',
    'relative-helper',
  ] as const)('preserves installed ownership through an escaped %s', async mode =>
    fixture(async ({ directory, app, host }) => {
      declare(host, 'missing-escaped-helper');
      install(host, 'missing-escaped-helper', 'hidden fallback');
      const plugin = path.join(directory, 'packages', 'plugin');
      const shared = path.join(directory, 'packages', 'shared');
      fs.mkdirSync(plugin, { recursive: true });
      fs.mkdirSync(shared);
      fs.writeFileSync(
        path.join(plugin, 'package.json'),
        JSON.stringify({ name: 'plugin', exports: './index.cjs' }),
      );
      const entry = path.join(shared, 'entry.cjs');
      fs.writeFileSync(
        entry,
        "module.exports=require('missing-escaped-helper');",
      );
      if (mode === 'exported-link')
        fs.symlinkSync(entry, path.join(plugin, 'index.cjs'));
      else
        fs.writeFileSync(
          path.join(plugin, 'index.cjs'),
          "module.exports=require('../shared/entry.cjs');",
        );
      fs.mkdirSync(path.join(app, 'node_modules'));
      fs.symlinkSync(plugin, path.join(app, 'node_modules', 'plugin'));
      await expect(
        withConfigDependencyResolution(
          { sourceRoots: [directory], dependencyRoots: [host] },
          async () => requestFrom(app)('plugin'),
        ),
      ).rejects.toMatchObject({ code: 'MODULE_NOT_FOUND' });
    }));

  it.each([
    '#plugin',
    './node_modules/plugin',
  ] as const)('preserves installed ownership when entered through %s', async specifier =>
    fixture(async ({ directory, app, host }) => {
      declare(host, 'missing-entry-helper');
      install(host, 'missing-entry-helper', 'hidden fallback');
      const plugin = path.join(directory, 'packages', 'plugin');
      fs.mkdirSync(plugin, { recursive: true });
      fs.writeFileSync(
        path.join(plugin, 'package.json'),
        JSON.stringify({
          name: 'plugin',
          exports: './index.cjs',
          main: './index.cjs',
        }),
      );
      fs.writeFileSync(
        path.join(plugin, 'index.cjs'),
        "module.exports=require('missing-entry-helper');",
      );
      fs.mkdirSync(path.join(app, 'node_modules'));
      fs.symlinkSync(plugin, path.join(app, 'node_modules', 'plugin'));
      const manifestFile = path.join(app, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      manifest.imports = { '#plugin': 'plugin' };
      fs.writeFileSync(manifestFile, JSON.stringify(manifest));
      await expect(
        withConfigDependencyResolution(
          { sourceRoots: [directory], dependencyRoots: [host] },
          async () => requestFrom(app)(specifier),
        ),
      ).rejects.toMatchObject({ code: 'MODULE_NOT_FOUND' });
    }));

  it('keeps an authored self-reference distinct from an installed same-name package', async () =>
    fixture(async ({ directory, app, host }) => {
      declare(host, 'self-helper');
      install(host, 'self-helper', 'authored self');
      install(app, 'app', 'installed decoy');
      fs.writeFileSync(
        path.join(app, 'index.cjs'),
        "module.exports=require('self-helper');",
      );
      await withConfigDependencyResolution(
        { sourceRoots: [directory], dependencyRoots: [host] },
        async () => expect(requestFrom(app)('app')).toBe('authored self'),
      );
    }));

  it('preserves cohort ownership for a cached dependency and its escaped cached helper', async () =>
    fixture(async ({ directory, app, host, secondHost }) => {
      declare(host, 'cached-plugin');
      declare(secondHost, 'missing-cached-helper');
      install(secondHost, 'missing-cached-helper', 'hidden fallback');
      const plugin = path.join(directory, 'packages', 'cached-plugin');
      const shared = path.join(directory, 'packages', 'cached-shared');
      fs.mkdirSync(plugin, { recursive: true });
      fs.mkdirSync(shared);
      fs.writeFileSync(
        path.join(plugin, 'package.json'),
        JSON.stringify({ name: 'cached-plugin', exports: './index.cjs' }),
      );
      fs.writeFileSync(
        path.join(plugin, 'index.cjs'),
        "module.exports=require('../cached-shared/entry.cjs');",
      );
      fs.writeFileSync(
        path.join(shared, 'entry.cjs'),
        "module.exports=()=>require('missing-cached-helper');",
      );
      fs.mkdirSync(path.join(host, 'node_modules'));
      fs.symlinkSync(plugin, path.join(host, 'node_modules', 'cached-plugin'));
      const cached = requestFrom(host)('cached-plugin');
      await expect(
        withConfigDependencyResolution(
          { sourceRoots: [directory], dependencyRoots: [host, secondHost] },
          async () => cached(),
        ),
      ).rejects.toMatchObject({ code: 'MODULE_NOT_FOUND' });
    }));

  it('isolates concurrent source scopes and unrelated loads', async () =>
    fixture(async ({ app, host, secondHost, outside }) => {
      for (const root of [host, secondHost]) declare(root, 'cohort');
      install(host, 'cohort', 'first');
      install(secondHost, 'cohort', 'second');
      let release: () => void = () => {};
      const blocked = new Promise<void>(resolve => {
        release = resolve;
      });
      const first = withConfigDependencyResolution(
        { sourceRoots: [app], dependencyRoots: [host] },
        async () => {
          await blocked;
          return requestFrom(app)('cohort');
        },
      );
      const second = withConfigDependencyResolution(
        { sourceRoots: [outside], dependencyRoots: [secondHost] },
        async () => {
          await blocked;
          return requestFrom(outside)('cohort');
        },
      );
      try {
        expect(() => requestFrom(app)('cohort')).toThrow('cohort');
      } finally {
        release();
      }
      expect(await Promise.all([first, second])).toEqual(['first', 'second']);
    }));

  it.each([
    'success',
    'failure',
  ] as const)('ends fallback scope after %s', async outcome =>
    fixture(async ({ app, host }) => {
      declare(host, 'fresh-after-evaluation');
      install(host, 'fresh-after-evaluation', 'host');
      const operation = withConfigDependencyResolution(
        { sourceRoots: [app], dependencyRoots: [host] },
        async () => {
          if (outcome === 'failure') throw new Error('EVALUATION_FAILURE');
          return 'evaluated';
        },
      );
      if (outcome === 'failure')
        await expect(operation).rejects.toThrow('EVALUATION_FAILURE');
      else expect(await operation).toBe('evaluated');
      expect(() => requestFrom(app)('fresh-after-evaluation')).toThrow(
        'fresh-after-evaluation',
      );
    }));
});
