import { ChildProcess, spawn } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import fs from 'node:fs';
import { createRequire, findPackageJSON } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from '@rstest/core';

// Resolve both parent and child through the real owning public package builds.
const {
  loadUltramodernConfigSnapshot,
}: typeof import('../../src/native-composition/config-evaluator') =
  createRequire(path.resolve(__dirname, '../../package.json'))(
    '@modern-js/ultramodern-app-tools/config-evaluator',
  );

const ownedRoots: string[] = [];

afterEach(() => {
  for (const root of ownedRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

function fixture(renderer = 'solid') {
  const root = fs.mkdtempSync(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'um-config-evaluator-',
    ),
  );
  ownedRoots.push(root);
  const appDirectory = path.join(root, 'app');
  const trace = path.join(root, 'invocations.jsonl');
  fs.mkdirSync(path.join(appDirectory, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(appDirectory, 'package.json'),
    JSON.stringify({ name: 'config-evaluator-fixture', version: '1.0.0' }),
  );
  for (const entry of ['main', 'admin']) {
    fs.writeFileSync(
      path.join(appDirectory, 'src', `${entry}.tsx`),
      `export default function ${entry}() { return null; }\n`,
    );
  }
  fs.writeFileSync(
    path.join(appDirectory, 'selection.cjs'),
    `module.exports = ${JSON.stringify(renderer)};\n`,
  );
  fs.writeFileSync(
    path.join(appDirectory, 'modern.config.ts'),
    `import { defineConfig } from '@modern-js/ultramodern-app-tools';
import { appendFileSync } from 'node:fs';
import renderer from './selection.cjs';
const trace = ${JSON.stringify(trace)};
export default defineConfig(async context => {
  appendFileSync(trace, JSON.stringify({ kind: 'primary', context, nodeEnv: process.env.NODE_ENV, pid: process.pid }) + '\\n');
  await Promise.resolve();
  return {
    renderer,
    source: { disableDefaultEntries: true, entries: { main: './src/main.tsx', admin: './src/admin.tsx' } },
    plugins: [{
      name: 'fixture:authored-entry-hook',
      setup(api) {
        api.modifyEntrypoints(({ entrypoints }) => {
          appendFileSync(trace, JSON.stringify({ kind: 'entry-hook', command: api.getAppContext().command, configFile: api.getAppContext().configFile, isProd: api.getAppContext().isProd, entries: entrypoints.map(entry => entry.entryName), pid: process.pid }) + '\\n');
          return { entrypoints };
        });
      },
    }],
  };
});\n`,
  );
  return {
    root,
    appDirectory,
    trace,
    invocations() {
      return fs.existsSync(trace)
        ? fs
            .readFileSync(trace, 'utf8')
            .trim()
            .split('\n')
            .map(line => JSON.parse(line))
        : [];
    },
    options: { appDirectory, env: 'development', command: 'dev' },
  };
}

async function waitForInvocation(file: string): Promise<void> {
  const deadline = Date.now() + 20000;
  while (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    if (Date.now() > deadline)
      throw new Error('Evaluator callback did not run');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function withModernEnv<T>(value: string | undefined, evaluate: () => T): T {
  const original = process.env.MODERN_ENV;
  if (value === undefined) delete process.env.MODERN_ENV;
  else process.env.MODERN_ENV = value;
  try {
    // fork captures this environment before the returned Promise yields.
    return evaluate();
  } finally {
    if (original === undefined) delete process.env.MODERN_ENV;
    else process.env.MODERN_ENV = original;
  }
}

describe('isolated owning configuration evaluator', () => {
  it('rejects actual authored access to the cached framework binding even when caught', async () => {
    const app = fixture();
    const owner = createRequire(path.resolve(__dirname, '../../package.json'));
    const rsbuild = createRequire(owner.resolve('@rsbuild/core/package.json'));
    const rspack = createRequire(rsbuild.resolve('@rspack/core/package.json'));
    const binding = rspack.resolve('@rspack/binding');
    const configFile = path.join(app.appDirectory, 'modern.config.ts');
    fs.writeFileSync(
      configFile,
      fs
        .readFileSync(configFile, 'utf8')
        .replace(
          'await Promise.resolve();',
          `try { const { createRequire } = await import('node:module'); createRequire(import.meta.url)(${JSON.stringify(binding)}); } catch {}`,
        ),
    );
    await expect(loadUltramodernConfigSnapshot(app.options)).rejects.toThrow(
      'native binding module',
    );
    expect(
      app.invocations().filter(call => call.kind === 'primary'),
    ).toHaveLength(1);
  });

  it.each([
    'RSPACK_BINDING',
    'NAPI_RS_NATIVE_LIBRARY_PATH',
    'NAPI_RS_FORCE_WASI',
  ])('rejects inherited %s before authored callbacks or foreign binding execution', async name => {
    const app = fixture();
    const marker = path.join(app.root, 'foreign-executed');
    const foreign = path.join(app.root, 'foreign-binding.cjs');
    fs.writeFileSync(
      foreign,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); module.exports = {};`,
    );
    const original = process.env[name];
    process.env[name] = foreign;
    const pending = loadUltramodernConfigSnapshot(app.options);
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
    await expect(pending).rejects.toThrow(`native binding override ${name}`);
    expect(app.invocations()).toEqual([]);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it.each([
    'react',
    'solid',
    'octane',
  ])('evaluates %s original source and actual entry hooks before app installation', async renderer => {
    const app = fixture(renderer);
    const result = await loadUltramodernConfigSnapshot(app.options);
    expect(result.renderer).toBe(renderer);
    expect(result.entries.map(entry => entry.entryName)).toEqual([
      'main',
      'admin',
    ]);
    expect(result.primaryEntryName).toBe('main');
    expect(Object.keys(result.routerBindings ?? {})).toEqual(['main', 'admin']);
    for (const binding of Object.values(result.routerBindings ?? {})) {
      expect(binding).toEqual(
        expect.objectContaining({
          owner: expect.any(String),
          evidence: expect.stringMatching(
            /^(owned-default|file-routes|provider-registry)$/u,
          ),
          defaultProvider: expect.objectContaining({
            name: expect.any(String),
            version: expect.any(String),
            coreName: expect.any(String),
            coreVersion: expect.any(String),
          }),
        }),
      );
    }
    expect(fs.existsSync(path.join(app.appDirectory, 'node_modules'))).toBe(
      false,
    );
    expect(app.invocations()).toEqual([
      {
        kind: 'primary',
        context: { env: 'development', command: 'dev' },
        nodeEnv: 'development',
        pid: expect.any(Number),
      },
      {
        kind: 'entry-hook',
        command: 'dev',
        configFile: path.join(app.appDirectory, 'modern.config.ts'),
        isProd: false,
        entries: ['main', 'admin'],
        pid: expect.any(Number),
      },
    ]);
    expect(app.invocations()[0].pid).not.toBe(process.pid);
    expect(() => process.kill(app.invocations()[0].pid, 0)).toThrow();
    expect(result.consumedSourceInputs.kind).toBe(
      'observed-config-source-inputs',
    );
    expect(Object.isFrozen(result.consumedSourceInputs)).toBe(true);
    expect(Object.isFrozen(result.consumedSourceInputs.observations)).toBe(
      true,
    );
    const consumedPaths = result.consumedSourceInputs.observations.map(
      input => input.path,
    );
    expect(consumedPaths).toEqual(
      expect.arrayContaining([
        path.join(app.appDirectory, 'modern.config.ts'),
        path.join(app.appDirectory, 'selection.cjs'),
      ]),
    );
    expect(result.sourceSnapshot.kind).toBe('bounded-config-source-snapshot');
    expect(() => result.assertUnchanged()).not.toThrow();
  });

  it('uses the same private owning Effect bridge for actual native ESM descendants', async () => {
    const app = fixture('react');
    const owningRequire = createRequire(
      path.resolve(__dirname, '../../package.json'),
    );
    const cjsConfig = owningRequire.resolve(
      '@modern-js/app-tools-extensions/config',
    );
    const owningManifest = findPackageJSON(cjsConfig, cjsConfig);
    if (!owningManifest)
      throw new Error('Missing owning Effect config package');
    const globalPackages = path.join(app.root, 'global-node-path/node_modules');
    fs.mkdirSync(path.join(globalPackages, '@modern-js'), { recursive: true });
    fs.symlinkSync(
      path.dirname(owningManifest),
      path.join(globalPackages, '@modern-js/app-tools-extensions'),
      'dir',
    );
    const absentCohort = path.join(app.root, 'absent-cohort');
    fs.mkdirSync(absentCohort);
    fs.writeFileSync(
      path.join(absentCohort, 'package.json'),
      JSON.stringify({
        name: 'fixture-absent-effect-cohort',
        dependencies: { '@modern-js/app-tools-extensions': '1.0.0' },
      }),
    );
    const helper = path.join(app.appDirectory, 'compiler.mjs');
    fs.writeFileSync(
      helper,
      `import { resolveEffectTsgoCompiler } from '@modern-js/app-tools-extensions/config';
export default () => resolveEffectTsgoCompiler({ from: import.meta.url });
`,
    );
    // A real CJS import() enters Node's ESM loader. VM-generated imports and
    // ordinary config imports remain subject to the owning synchronous Jiti.
    fs.writeFileSync(
      path.join(app.appDirectory, 'native-import.cjs'),
      "module.exports = () => import('./compiler.mjs');\n",
    );
    fs.writeFileSync(
      path.join(app.appDirectory, 'modern.config.ts'),
      `import { defineConfig } from '@modern-js/ultramodern-app-tools';
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);
export default defineConfig(async () => {
  const cjsConfig = nativeRequire.resolve('@modern-js/app-tools-extensions/config');
  const { default: resolveCompiler } = await nativeRequire('./native-import.cjs')();
  const compiler = resolveCompiler();
  appendFileSync(${JSON.stringify(app.trace)}, JSON.stringify({ kind: 'native-effect', compiler, cjsConfig }) + '\\n');
  return { renderer: 'react', source: { disableDefaultEntries: true, entries: { main: './src/main.tsx', admin: './src/admin.tsx' } } };
});
`,
    );
    const originalNodePath = process.env.NODE_PATH;
    process.env.NODE_PATH = [globalPackages, originalNodePath]
      .filter(Boolean)
      .join(path.delimiter);
    let evaluation: ReturnType<typeof loadUltramodernConfigSnapshot>;
    try {
      // The fresh child retains inherited global roots. Its native import
      // must select the declared cohort even when CJS finds this same owner
      // through NODE_PATH, which ESM does not search.
      evaluation = loadUltramodernConfigSnapshot({
        ...app.options,
        dependencyRoots: [
          absentCohort,
          path.resolve(__dirname, '../../../../toolkit/ultramodern-create'),
        ],
      });
    } finally {
      if (originalNodePath === undefined) delete process.env.NODE_PATH;
      else process.env.NODE_PATH = originalNodePath;
    }
    const result = await evaluation;
    expect(result.renderer).toBe('react');
    expect(app.invocations()).toEqual([
      { kind: 'native-effect', compiler: expect.any(String), cjsConfig },
    ]);
    expect(fs.realpathSync(app.invocations()[0].cjsConfig)).toBe(cjsConfig);
    expect(process.env.NODE_PATH).toBe(originalNodePath);
    expect(fs.existsSync(app.invocations()[0].compiler)).toBe(true);
    expect(result.consumedSourceInputs.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: helper,
          operation: 'module',
          existed: true,
        }),
      ]),
    );
  });

  it('evaluates primary and local callbacks once with exact context', async () => {
    const app = fixture();
    const cacheDirectory = path.join(app.root, 'compiler-cache');
    const helper = path.join(app.appDirectory, 'callback-authority.ts');
    fs.mkdirSync(cacheDirectory);
    fs.writeFileSync(
      helper,
      "export enum CallbackMarker { Local = 'original-local-source' }\n",
    );
    fs.writeFileSync(
      path.join(app.appDirectory, 'modern.config.local.ts'),
      `import { appendFileSync } from 'node:fs';
import { CallbackMarker } from './callback-authority.ts';
export default async (context: { env: string; command: string }) => {
  appendFileSync(${JSON.stringify(app.trace)}, JSON.stringify({ kind: 'local', context, pid: process.pid, fsCache: process.env.JITI_FS_CACHE, marker: CallbackMarker.Local }) + '\\n');
  return { html: { title: 'Authored local configuration' } };
};\n`,
    );
    const originalEnvironment = {
      JITI_FS_CACHE: process.env.JITI_FS_CACHE,
      JITI_CACHE: process.env.JITI_CACHE,
      TMPDIR: process.env.TMPDIR,
    };
    try {
      process.env.JITI_FS_CACHE = 'true';
      process.env.JITI_CACHE = 'true';
      process.env.TMPDIR = cacheDirectory;
      const result = await loadUltramodernConfigSnapshot({
        ...app.options,
        env: 'staging',
        command: 'start',
      });
      expect(process.env.JITI_FS_CACHE).toBe('true');
      expect(process.env.JITI_CACHE).toBe('true');
      expect(process.env.TMPDIR).toBe(cacheDirectory);
      expect(fs.existsSync(path.join(cacheDirectory, 'jiti'))).toBe(false);
      expect(
        result.consumedSourceInputs.observations.map(input => input.path),
      ).toEqual(
        expect.arrayContaining([
          path.join(app.appDirectory, 'modern.config.ts'),
          path.join(app.appDirectory, 'modern.config.local.ts'),
          path.join(app.appDirectory, 'selection.cjs'),
          helper,
        ]),
      );
    } finally {
      for (const [name, original] of Object.entries(originalEnvironment)) {
        if (original === undefined) delete process.env[name];
        else process.env[name] = original;
      }
    }
    expect(
      app.invocations().filter(event => event.kind !== 'entry-hook'),
    ).toEqual([
      {
        kind: 'primary',
        context: { env: 'staging', command: 'start' },
        nodeEnv: 'staging',
        pid: expect.any(Number),
      },
      {
        kind: 'local',
        context: { env: 'staging', command: 'start' },
        pid: expect.any(Number),
        fsCache: 'false',
        marker: 'original-local-source',
      },
    ]);
  });

  it('discards native CJS dependency caches between snapshots', async () => {
    const app = fixture();
    const first = await loadUltramodernConfigSnapshot(app.options);
    fs.writeFileSync(
      path.join(app.appDirectory, 'selection.cjs'),
      "module.exports = 'octane';\n",
    );
    expect(() => first.assertUnchanged()).toThrow(
      'Config source snapshot changed',
    );
    const second = await loadUltramodernConfigSnapshot(app.options);
    expect(second.renderer).toBe('octane');
    const callbacks = app
      .invocations()
      .filter(event => event.kind === 'primary');
    expect(callbacks).toHaveLength(2);
    expect(callbacks[0].pid).not.toBe(callbacks[1].pid);
  });

  it('preserves native ESM descendant import conditions inside the owning CJS evaluator', async () => {
    const app = fixture();
    const cohort = path.join(app.root, 'conditional-cohort');
    const dependency = path.join(
      cohort,
      'node_modules/@fixture/conditional-renderer',
    );
    fs.mkdirSync(dependency, { recursive: true });
    fs.writeFileSync(
      path.join(cohort, 'package.json'),
      JSON.stringify({
        name: 'fixture-conditional-cohort',
        dependencies: { '@fixture/conditional-renderer': '1.0.0' },
      }),
    );
    fs.writeFileSync(
      path.join(dependency, 'package.json'),
      JSON.stringify({
        name: '@fixture/conditional-renderer',
        exports: { import: './import.mjs', require: './require.cjs' },
      }),
    );
    fs.writeFileSync(
      path.join(dependency, 'import.mjs'),
      "export default 'solid';\n",
    );
    fs.writeFileSync(
      path.join(dependency, 'require.cjs'),
      "module.exports = 'octane';\n",
    );
    fs.writeFileSync(
      path.join(app.appDirectory, 'native-selection.mjs'),
      "import renderer from '@fixture/conditional-renderer'; export default renderer;\n",
    );
    // Public createRequire loads this as native CJS; its import() preserves
    // Node's import conditions instead of Jiti's synchronous .mjs transform.
    fs.writeFileSync(
      path.join(app.appDirectory, 'native-import.cjs'),
      "module.exports = () => import('./native-selection.mjs');\n",
    );
    const filename = path.join(app.appDirectory, 'modern.config.ts');
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, 'utf8')
        .replace(
          "import renderer from './selection.cjs';",
          "import renderer from './selection.cjs';\nimport { createRequire } from 'node:module';\nconst nativeRequire = createRequire(import.meta.url);",
        )
        .replace(
          'await Promise.resolve();',
          "const { default: nativeRenderer } = await nativeRequire('./native-import.cjs')();",
        )
        .replace('    renderer,', '    renderer: nativeRenderer,'),
    );
    expect(
      (
        await loadUltramodernConfigSnapshot({
          ...app.options,
          dependencyRoots: [cohort],
        })
      ).renderer,
    ).toBe('solid');
  });

  it('prefers newly installed original dependencies after an earlier cohort fallback', async () => {
    const app = fixture();
    const cohort = path.join(app.root, 'cli-cohort');
    fs.mkdirSync(cohort);
    fs.writeFileSync(
      path.join(cohort, 'package.json'),
      JSON.stringify({
        name: 'fixture-cli-cohort',
        dependencies: { '@fixture/renderer-choice': '1.0.0' },
      }),
    );
    const installChoice = (root: string, renderer: string) => {
      const dependency = path.join(
        root,
        'node_modules/@fixture/renderer-choice',
      );
      fs.mkdirSync(dependency, { recursive: true });
      fs.writeFileSync(
        path.join(dependency, 'package.json'),
        JSON.stringify({ name: '@fixture/renderer-choice', main: 'index.cjs' }),
      );
      fs.writeFileSync(
        path.join(dependency, 'index.cjs'),
        `module.exports = ${JSON.stringify(renderer)};\n`,
      );
    };
    installChoice(cohort, 'solid');
    const filename = path.join(app.appDirectory, 'modern.config.ts');
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, 'utf8')
        .replace("'./selection.cjs'", "'@fixture/renderer-choice'"),
    );
    const options = { ...app.options, dependencyRoots: [cohort] };
    expect((await loadUltramodernConfigSnapshot(options)).renderer).toBe(
      'solid',
    );
    installChoice(app.appDirectory, 'octane');
    expect((await loadUltramodernConfigSnapshot(options)).renderer).toBe(
      'octane',
    );
  });

  it('resolves the owning published namespace instead of a source-name decoy', async () => {
    const app = fixture();
    const packageRoot = path.resolve(__dirname, '../..');
    // This copy stays below the actual cohort's installed dependencies. No
    // dependency links or source aliases are created for the isolated worker.
    // It lives in the installed namespace, like a published owner: a copy in
    // the package source tree would change the framework cohort bytes and
    // config source snapshots that concurrently running test files observe.
    const owner = fs.mkdtempSync(
      path.join(
        process.env.OWNED_CONFIG_EVALUATOR_PACKAGE_TEMP_ROOT ??
          path.join(packageRoot, 'node_modules'),
        '.config-evaluator-owner-',
      ),
    );
    ownedRoots.push(owner);
    fs.mkdirSync(path.join(owner, 'dist/cjs'), { recursive: true });
    fs.cpSync(
      path.join(packageRoot, 'dist/cjs'),
      path.join(owner, 'dist/cjs'),
      { recursive: true },
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    );
    const publishedName = '@bleedingdev/modern-js-ultramodern-app-tools';
    manifest.name = publishedName;
    fs.writeFileSync(
      path.join(owner, 'package.json'),
      JSON.stringify(manifest),
    );
    const decoy = path.join(
      owner,
      'node_modules/@modern-js/ultramodern-app-tools',
    );
    fs.mkdirSync(decoy, { recursive: true });
    fs.writeFileSync(
      path.join(decoy, 'package.json'),
      JSON.stringify({
        name: '@modern-js/ultramodern-app-tools',
        exports: { './config-evaluator-worker': './wrong-owner.cjs' },
      }),
    );
    fs.writeFileSync(
      path.join(decoy, 'wrong-owner.cjs'),
      "throw new Error('source-name decoy worker executed');\n",
    );
    const filename = path.join(app.appDirectory, 'modern.config.ts');
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, 'utf8')
        .replace('@modern-js/ultramodern-app-tools', publishedName),
    );
    const publicEvaluator: typeof import('../../src/native-composition/config-evaluator') =
      createRequire(path.join(owner, 'package.json'))(
        `${publishedName}/config-evaluator`,
      );
    expect(
      (await publicEvaluator.loadUltramodernConfigSnapshot(app.options))
        .renderer,
    ).toBe('solid');
    expect(app.invocations().map(event => event.kind)).toEqual([
      'primary',
      'entry-hook',
    ]);
  });

  it('rejects authored source changes during an asynchronous callback', async () => {
    const app = fixture();
    const filename = path.join(app.appDirectory, 'modern.config.ts');
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, 'utf8')
        .replace(
          'await Promise.resolve();',
          'await new Promise(resolve => setTimeout(resolve, 1000));',
        ),
    );
    const pending = loadUltramodernConfigSnapshot(app.options);
    await waitForInvocation(app.trace);
    fs.writeFileSync(
      path.join(app.appDirectory, 'selection.cjs'),
      "module.exports = 'octane';\n",
    );
    await expect(pending).rejects.toThrow('Config source snapshot changed');
  });

  it('rejects source edits restored after the child observes changed renderer data', async () => {
    const app = fixture();
    const observed = path.join(app.root, 'observed-renderer');
    const filename = path.join(app.appDirectory, 'modern.config.ts');
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, 'utf8')
        .replace("import renderer from './selection.cjs';", '')
        .replace(
          'appendFileSync(trace,',
          "const readGate = new Promise(resolve => process.once('message', resolve));\n  appendFileSync(trace,",
        )
        .replace(
          'await Promise.resolve();',
          `
await readGate;
const renderer = require('./selection.cjs');
const completeGate = new Promise(resolve => process.once('message', resolve));
appendFileSync(${JSON.stringify(observed)}, renderer);
await completeGate;
`,
        ),
    );
    const workerFile = createRequire(
      path.resolve(__dirname, '../../package.json'),
    ).resolve('@modern-js/ultramodern-app-tools/config-evaluator-worker');
    const children = channel('child_process');
    let child: ChildProcess | undefined;
    const observeChild = (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'process' in message &&
        message.process instanceof ChildProcess
      ) {
        const candidate = message.process;
        candidate.once('spawn', () => {
          if (candidate.spawnargs.includes(workerFile)) child = candidate;
        });
      }
    };
    const send = (kind: 'ready' | 'complete') =>
      new Promise<void>((resolve, reject) => {
        if (!child) {
          reject(
            new Error('The owning public evaluator child was not observed'),
          );
          return;
        }
        child.send({ kind }, error => (error ? reject(error) : resolve()));
      });
    const controller = new AbortController();
    children.subscribe(observeChild);
    const outcome = loadUltramodernConfigSnapshot({
      ...app.options,
      signal: controller.signal,
    }).then(
      value => ({ value, error: undefined }),
      error => ({ value: undefined, error }),
    );
    try {
      await waitForInvocation(app.trace);
      const selection = path.join(app.appDirectory, 'selection.cjs');
      const original = fs.readFileSync(selection);
      fs.writeFileSync(selection, "module.exports = 'octane';\n");
      await send('ready');
      await waitForInvocation(observed);
      expect(fs.readFileSync(observed, 'utf8')).toBe('octane');
      fs.writeFileSync(selection, original);
      await send('complete');
      expect((await outcome).error?.message).toContain(
        'Config source snapshot changed',
      );
    } finally {
      controller.abort();
      await outcome;
      children.unsubscribe(observeChild);
    }
  });

  it('propagates real configuration failures', async () => {
    const app = fixture();
    fs.writeFileSync(
      path.join(app.appDirectory, 'modern.config.ts'),
      "throw new Error('authored config failure');\n",
    );
    await expect(loadUltramodernConfigSnapshot(app.options)).rejects.toThrow(
      'authored config failure',
    );
  });

  it.each([
    { kind: 'error' },
    { kind: 'error', error: null },
    { kind: 'error', error: { name: 'Error', message: 42 } },
    {
      kind: 'result',
      result: {
        renderer: 'solid',
        entries: [{ entryName: 'main', isMainEntry: true }],
        primaryEntryName: 'main',
      },
    },
    {
      kind: 'result',
      result: {
        renderer: 'solid',
        entries: [{ entryName: 'main', isMainEntry: true }],
        primaryEntryName: 'main',
        routerBindings: null,
      },
    },
    {
      kind: 'result',
      result: {
        renderer: 'solid',
        entries: [{ entryName: 'main', isMainEntry: true }],
        primaryEntryName: 'main',
        routerBindings: {},
      },
    },
  ])('rejects malformed authored IPC without crashing the parent: %j', async message => {
    const app = fixture();
    const filename = path.join(app.appDirectory, 'modern.config.ts');
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, 'utf8')
        .replace(
          'await Promise.resolve();',
          `process.on('SIGTERM', () => {}); process.send(${JSON.stringify(message)}); await new Promise(() => {});`,
        ),
    );
    await expect(loadUltramodernConfigSnapshot(app.options)).rejects.toThrow(
      'UltraModern config evaluator sent invalid metadata',
    );
    const pid = app.invocations()[0].pid;
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it.each([
    { modernEnv: undefined, env: 'production', mode: 'production' },
    { modernEnv: 'staging', env: 'production', mode: 'staging' },
  ])('loads original app dotenv with owning mode precedence without changing parent env: %j', async ({
    modernEnv,
    env,
    mode,
  }) => {
    const app = fixture();
    const variable = `MODERN_EVALUATOR_${process.pid}`;
    const parentNodeEnv = process.env.NODE_ENV;
    expect(process.env[variable]).toBeUndefined();
    fs.writeFileSync(
      path.join(app.appDirectory, '.env'),
      `${variable}=react\n`,
    );
    fs.writeFileSync(
      path.join(app.appDirectory, `.env.${mode}`),
      `${variable}=solid\n`,
    );
    const filename = path.join(app.appDirectory, 'modern.config.ts');
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, 'utf8')
        .replace(
          '    renderer,',
          `    renderer: process.env[${JSON.stringify(variable)}],`,
        ),
    );
    const result = await withModernEnv(modernEnv, () =>
      loadUltramodernConfigSnapshot({ ...app.options, env }),
    );
    expect(result.renderer).toBe('solid');
    expect(app.invocations()[0].context).toEqual({ env, command: 'dev' });
    expect(app.invocations()[0].nodeEnv).toBe(env);
    expect(
      app.invocations().find(event => event.kind === 'entry-hook')?.isProd,
    ).toBe(true);
    expect(process.env.NODE_ENV).toBe(parentNodeEnv);
    expect(process.env[variable]).toBeUndefined();
    fs.writeFileSync(
      path.join(app.appDirectory, `.env.${mode}`),
      `${variable}=octane\n`,
    );
    expect(() => result.assertUnchanged()).toThrow(
      'Config source snapshot changed',
    );
  });

  it('terminates the owning evaluator on cancellation', async () => {
    const app = fixture();
    const filename = path.join(app.appDirectory, 'modern.config.ts');
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, 'utf8')
        .replace(
          'await Promise.resolve();',
          "process.on('SIGTERM', () => {}); await new Promise(() => {});",
        ),
    );
    const controller = new AbortController();
    const pending = loadUltramodernConfigSnapshot({
      ...app.options,
      signal: controller.signal,
    });
    await waitForInvocation(app.trace);
    const pid = app.invocations()[0].pid;
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('enforces the owning evaluator deadline', async () => {
    const app = fixture();
    await expect(
      loadUltramodernConfigSnapshot({ ...app.options, timeoutMs: 1 }),
    ).rejects.toThrow('UltraModern config evaluation exceeded 1ms');
  });

  it('exits the owning evaluator after its parent process disappears', async () => {
    const app = fixture();
    const filename = path.join(app.appDirectory, 'modern.config.ts');
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, 'utf8')
        .replace(
          'await Promise.resolve();',
          'await new Promise(() => setInterval(() => {}, 1000));',
        ),
    );
    const packageRoot = path.resolve(__dirname, '../..');
    const evaluatorFile = createRequire(
      path.join(packageRoot, 'package.json'),
    ).resolve('@modern-js/ultramodern-app-tools/config-evaluator');
    const parent = spawn(
      process.execPath,
      [
        '-e',
        `
const fs = require('node:fs');
const { loadUltramodernConfigSnapshot } = require(${JSON.stringify(evaluatorFile)});
loadUltramodernConfigSnapshot(${JSON.stringify(app.options)}).catch(error => {
  console.error(error); process.exit(2);
});
setInterval(() => {
  if (fs.existsSync(${JSON.stringify(app.trace)})) process.exit(0);
}, 20);
setTimeout(() => process.exit(3), 20000);
`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let diagnostics = '';
    parent.stdout.on('data', chunk => {
      diagnostics += chunk;
    });
    parent.stderr.on('data', chunk => {
      diagnostics += chunk;
    });
    let pid: number | undefined;
    let evaluatorExited = false;
    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        parent.once('error', reject);
        parent.once('close', resolve);
      });
      expect(diagnostics).toBe('');
      expect(exitCode).toBe(0);
      pid = app.invocations()[0].pid;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try {
          process.kill(pid!, 0);
        } catch {
          evaluatorExited = true;
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Owning evaluator survived parent disconnect');
    } finally {
      parent.kill('SIGKILL');
      if (pid === undefined && !evaluatorExited) {
        pid = app.invocations().find(event => event.kind === 'primary')?.pid;
      }
      if (pid && !evaluatorExited) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      }
    }
  });

  it('rejects deadlines which overflow Node timers', async () => {
    const app = fixture();
    await expect(
      loadUltramodernConfigSnapshot({ ...app.options, timeoutMs: 2147483648 }),
    ).rejects.toThrow('timeoutMs must be between 1 and 2147483647');
    expect(app.invocations()).toEqual([]);
  });

  it('rejects inherited NODE_OPTIONS including harmless memory options without mutating the parent', async () => {
    const app = fixture();
    const original = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = '--max-old-space-size=2048';
    try {
      await expect(loadUltramodernConfigSnapshot(app.options)).rejects.toThrow(
        'config evaluator does not support nonempty NODE_OPTIONS',
      );
      expect(process.env.NODE_OPTIONS).toBe('--max-old-space-size=2048');
      expect(app.invocations()).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = original;
    }
  });
});
