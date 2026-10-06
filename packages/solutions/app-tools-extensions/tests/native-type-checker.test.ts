import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRsbuild, rspack } from '@rsbuild/core';
import {
  configureUltramodernTypeChecker,
  missingJsxRuntimeHint,
  resolveNativeTypeCheckerCommand,
  UltramodernNativeTypeChecker,
} from '../src/native-type-checker';

const require = createRequire(import.meta.url);
const compilerManifestPath = require.resolve('typescript/package.json');
const compilerManifest = JSON.parse(
  fs.readFileSync(compilerManifestPath, 'utf8'),
) as { version: string };
if (compilerManifest.version !== '7.0.2') {
  throw new Error(
    `Native checker fixtures require TypeScript 7.0.2; resolved ${compilerManifest.version}.`,
  );
}
// The package bin is a Node.js launcher; use its own resolver for the Go executable.
const { default: getExePath } = await import(
  pathToFileURL(
    path.join(path.dirname(compilerManifestPath), 'lib/getExePath.js'),
  ).href
);
const compiler: string = getExePath();

test('the selected stable native checker uses its real public bin and rejects invalid package owners', () => {
  const directory = path.dirname(compilerManifestPath);
  const metadata = JSON.parse(fs.readFileSync(compilerManifestPath, 'utf8'));
  const selected = resolveNativeTypeCheckerCommand(compilerManifestPath);
  expect(selected.executable).toBe(process.execPath);
  expect(selected.args).toEqual([
    fs.realpathSync(path.resolve(directory, metadata.bin.tsc)),
  ]);
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'native-checker-owner-')),
  );
  const owner = path.join(root, 'package');
  const manifest = path.join(owner, 'package.json');
  try {
    fs.mkdirSync(owner);
    const write = (override: Record<string, unknown>) =>
      fs.writeFileSync(manifest, JSON.stringify({ ...metadata, ...override }));
    for (const override of [
      { name: '@typescript/native-preview' },
      { version: '6.0.3' },
      { version: '7.0.2-dev.20261004' },
    ]) {
      write(override);
      expect(() => resolveNativeTypeCheckerCommand(manifest)).toThrow(
        'requires typescript@7.0.2',
      );
    }
    for (const bin of [undefined, {}, { tsc: path.join(root, 'tsc') }]) {
      write({ bin });
      expect(() => resolveNativeTypeCheckerCommand(manifest)).toThrow(
        "requires the selected package's public tsc bin",
      );
    }
    fs.writeFileSync(path.join(root, 'tsc'), 'throw new Error("foreign bin");');
    write({ bin: { tsc: '../tsc' } });
    expect(() => resolveNativeTypeCheckerCommand(manifest)).toThrow(
      'public tsc bin must belong to its selected package',
    );
    fs.symlinkSync(path.join(root, 'tsc'), path.join(owner, 'tsc'));
    write({ bin: { tsc: 'tsc' } });
    expect(() => resolveNativeTypeCheckerCommand(manifest)).toThrow(
      'public tsc bin must belong to its selected package',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the resolved checker overwrite reaches native JSX and type inputs without changing authored config', async () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'native-checker-jsx-')),
  );
  const configFile = path.join(root, 'tsconfig.json');
  const config = JSON.stringify({
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'preserve',
      allowJs: true,
      checkJs: true,
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      types: ['node'],
    },
    include: ['src'],
  });
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'node_modules/@types'), {
      recursive: true,
    });
    for (const name of ['node', 'react'])
      fs.symlinkSync(
        path.dirname(require.resolve(`@types/${name}/package.json`)),
        path.join(root, 'node_modules/@types', name),
        'dir',
      );
    const source = path.join(root, 'src/App.jsx');
    fs.writeFileSync(
      source,
      'export default function App() { return <main id="native-jsx"><button type="button">Native React</button></main>; }',
    );
    fs.writeFileSync(configFile, config);
    await expect(
      new UltramodernNativeTypeChecker({
        compiler: () => compiler,
        configFile,
        build: false,
      }).check(),
    ).rejects.toThrow('TS7026');
    // This error is excluded only by the actual resolved checker option.
    fs.writeFileSync(
      path.join(root, 'src/ignored.ts'),
      'export const ignored: string = 1;',
    );
    fs.writeFileSync(
      path.join(root, 'main.js'),
      'console.info("native JSX check");',
    );
    const builderRequire = createRequire(require.resolve('@modern-js/builder'));
    const { pluginTypeCheck } = await import(
      pathToFileURL(builderRequire.resolve('@rsbuild/plugin-type-check')).href
    );
    const completed: Array<{ hasErrors: boolean; diagnostics: string }> = [];
    const host = await createRsbuild({
      cwd: root,
      config: {
        mode: 'production',
        source: { entry: { main: path.join(root, 'main.js') } },
        output: { distPath: { root: path.join(root, 'dist') } },
        plugins: [
          pluginTypeCheck({
            tsCheckerOptions: {
              typescript: {
                configFile,
                tsgo: true,
                configOverwrite: {
                  exclude: ['src/ignored.ts'],
                  compilerOptions: {
                    jsxImportSource: 'react',
                    types: ['node', 'react'],
                  },
                },
              },
            },
          }),
          {
            name: 'native-checker-overwrite-regression',
            setup(api) {
              api.onAfterBuild(({ stats }) => {
                completed.push({
                  hasErrors: stats.hasErrors(),
                  diagnostics: stats.toString({
                    all: false,
                    errors: true,
                    errorDetails: true,
                  }),
                });
              });
              api.modifyBundlerChain({
                order: 'post',
                handler(chain, { CHAIN_ID }) {
                  configureUltramodernTypeChecker(
                    chain,
                    CHAIN_ID.PLUGIN.TS_CHECKER,
                    () => resolveNativeTypeCheckerCommand(compilerManifestPath),
                  );
                },
              });
            },
          },
        ],
      },
    });
    const result = await host.build();
    await result.close();
    expect(completed).toHaveLength(1);
    expect(completed[0].hasErrors).toBe(false);
    expect(fs.readFileSync(configFile, 'utf8')).toBe(config);
    expect(
      fs
        .readdirSync(root)
        .filter(file => file.startsWith('.ultramodern-native-checker.')),
    ).toEqual([]);
    fs.writeFileSync(
      source,
      'export default function App() { return <main definitelyNotAReactAttribute={true} />; }',
    );
    await expect(host.build()).rejects.toThrow('Rspack build failed.');
    expect(completed).toHaveLength(2);
    expect(completed[1].hasErrors).toBe(true);
    expect(completed[1].diagnostics).toContain('TS2322');
    expect(completed[1].diagnostics).toContain('App.jsx');
    expect(completed[1].diagnostics).toContain('definitelyNotAReactAttribute');
    expect(fs.readFileSync(configFile, 'utf8')).toBe(config);
    expect(
      fs
        .readdirSync(root)
        .filter(file => file.startsWith('.ultramodern-native-checker.')),
    ).toEqual([]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test('the checker overwrite selects inputs before validation and preserves the authored incremental output path', async () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'native-checker-input-overwrite-')),
  );
  const configFile = path.join(root, 'tsconfig.application.json');
  const buildInfoFile = path.join(root, 'tsconfig.application.tsbuildinfo');
  const source = path.join(root, 'src/index.ts');
  const config = `\uFEFF{
    // The base project has no inputs until the checker overwrite is applied.
    "compilerOptions": {
      "target": "ESNext",
      "module": "ESNext",
      "moduleResolution": "Bundler",
      "incremental": true,
      "strict": true,
      "types": [],
    },
    "include": ["empty-base"],
  }\n`;
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(source, 'export const value: string = "checked";');
    fs.writeFileSync(configFile, config);
    const options = {
      build: false,
      compiler: () => compiler,
      configFile,
    };
    await expect(
      new UltramodernNativeTypeChecker(options).check(),
    ).rejects.toThrow('TS18003');
    const checker = new UltramodernNativeTypeChecker({
      ...options,
      configOverwrite: { include: ['src'] },
    });
    await checker.check();
    expect(fs.readFileSync(configFile, 'utf8')).toBe(config);
    expect(fs.existsSync(buildInfoFile)).toBe(true);
    expect(fs.readdirSync(root).sort()).toEqual(
      [
        'src',
        'tsconfig.application.json',
        'tsconfig.application.tsbuildinfo',
      ].sort(),
    );
    expect(fs.readdirSync(path.join(root, 'src'))).toEqual(['index.ts']);
    fs.writeFileSync(source, 'export const value: string = 1;');
    await expect(checker.check()).rejects.toThrow('TS2322');
    expect(fs.readFileSync(configFile, 'utf8')).toBe(config);
    expect(fs.existsSync(buildInfoFile)).toBe(true);
    expect(fs.readdirSync(root).sort()).toEqual(
      [
        'src',
        'tsconfig.application.json',
        'tsconfig.application.tsbuildinfo',
      ].sort(),
    );
    expect(fs.readdirSync(path.join(root, 'src'))).toEqual(['index.ts']);
    fs.writeFileSync(source, 'export const value: string = "checked";');
    await checker.check();
    const buildInfo = fs.readFileSync(buildInfoFile);
    const buildInfoState = fs.statSync(buildInfoFile, { bigint: true });
    await checker.check();
    expect(fs.readFileSync(buildInfoFile)).toEqual(buildInfo);
    const unchangedBuildInfo = fs.statSync(buildInfoFile, { bigint: true });
    expect(unchangedBuildInfo.ino).toBe(buildInfoState.ino);
    expect(unchangedBuildInfo.mtimeNs).toBe(buildInfoState.mtimeNs);
    expect(fs.readFileSync(configFile, 'utf8')).toBe(config);
    expect(fs.readdirSync(root).sort()).toEqual(
      [
        'src',
        'tsconfig.application.json',
        'tsconfig.application.tsbuildinfo',
      ].sort(),
    );
    expect(fs.readdirSync(path.join(root, 'src'))).toEqual(['index.ts']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.each([
  {
    description: 'an unquoted property name',
    config: `{
      compilerOptions: { "module": "ESNext", "types": [] },
      "files": ["index.ts"]
    }`,
  },
  {
    description: 'a single-quoted option value',
    config: `{
      "compilerOptions": { "module": 'ESNext', "types": [] },
      "files": ["index.ts"]
    }`,
  },
])('rejects authored JSONC with $description before normalizing a checker overwrite', async ({
  config,
}) => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'native-checker-invalid-jsonc-')),
  );
  const configFile = path.join(root, 'tsconfig.json');
  try {
    fs.writeFileSync(
      path.join(root, 'index.ts'),
      'export const value = "valid";',
    );
    fs.writeFileSync(configFile, config);
    const options = {
      build: false,
      compiler: () => compiler,
      configFile,
    };
    await expect(
      new UltramodernNativeTypeChecker(options).check(),
    ).rejects.toThrow(/TS\d+/);
    expect(fs.readFileSync(configFile, 'utf8')).toBe(config);
    await expect(
      new UltramodernNativeTypeChecker({
        ...options,
        configOverwrite: { compilerOptions: { strict: true } },
      }).check(),
    ).rejects.toThrow(/requires valid JSONC/);
    expect(fs.readFileSync(configFile, 'utf8')).toBe(config);
    expect(fs.readdirSync(root).sort()).toEqual(['index.ts', 'tsconfig.json']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checks and rebuilds referenced projects without overriding their emit contracts', async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'native-reference-check-'),
  );
  const write = (file: string, value: string | object) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  };
  try {
    const compilerOptions = {
      composite: true,
      declaration: true,
      emitDeclarationOnly: true,
      noEmit: false,
      strict: true,
      types: [],
    };
    write('lib/tsconfig.json', { compilerOptions, files: ['index.ts'] });
    write('lib/index.ts', 'export interface Value { name: string }');
    write('app/tsconfig.json', {
      compilerOptions,
      references: [{ path: '../lib' }],
      files: ['index.ts'],
    });
    write(
      'app/index.ts',
      "import type { Value } from '../lib'; export const item: Value = { name: 'ok' };",
    );
    write('tsconfig.json', { files: [], references: [{ path: './app' }] });
    const checker = new UltramodernNativeTypeChecker({
      build: true,
      compiler: () => compiler,
      configFile: path.join(root, 'tsconfig.json'),
      configOverwrite: { compilerOptions: { strict: true, noEmit: true } },
    });
    await checker.check();
    expect(fs.existsSync(path.join(root, 'lib/index.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'app/index.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'app/index.js'))).toBe(false);
    write('lib/index.ts', 'export interface Value { name: number }');
    await expect(checker.check()).rejects.toThrow('TS2322');
    write('lib/index.ts', 'export interface Value { name: string }');
    await checker.check();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ordinary project checks build references but emit no app output and surface compiler failures', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-project-check-'));
  try {
    fs.mkdirSync(path.join(root, 'lib'));
    fs.writeFileSync(
      path.join(root, 'lib/index.ts'),
      'export interface Value { name: string }',
    );
    fs.writeFileSync(
      path.join(root, 'lib/tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          composite: true,
          declaration: true,
          emitDeclarationOnly: true,
          types: [],
        },
        files: ['index.ts'],
      }),
    );
    fs.writeFileSync(
      path.join(root, 'index.ts'),
      "import type { Value } from './lib'; export const value: Value = { name: 'ok' };",
    );
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { types: [] },
        files: ['index.ts'],
        references: [{ path: './lib' }],
      }),
    );
    const options = {
      build: false,
      compiler: () => compiler,
      configFile: path.join(root, 'tsconfig.json'),
    };
    await new UltramodernNativeTypeChecker(options).check();
    expect(fs.existsSync(path.join(root, 'index.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'index.d.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'lib/index.d.ts'))).toBe(true);
    fs.writeFileSync(
      path.join(root, 'lib/index.ts'),
      'export interface Value { name: number }',
    );
    await expect(
      new UltramodernNativeTypeChecker(options).check(),
    ).rejects.toThrow('TS2322');
    await expect(
      new UltramodernNativeTypeChecker({
        ...options,
        compiler: () => path.join(root, 'missing'),
      }).check(),
    ).rejects.toThrow(/UltramodernNativeTypeChecker failed:\n.*ENOENT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the rspack plugin regenerates a generated checker config from the project tsconfig before each check', async () => {
  // The builder writes the checker config to `<app>/.modern-js/tsgo/` once.
  // `references` cannot be inherited through `extends`, so a reference added
  // to the project tsconfig while `modern dev` runs must be restated on the
  // next compilation, and the project tsconfig must be a watched input.
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'native-plugin-refresh-')),
  );
  const compilerOptions = {
    composite: true,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    types: [],
  };
  const write = (relative: string, value: string) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  write('lib/index.ts', 'export interface Value { name: string }');
  write(
    'lib/tsconfig.json',
    JSON.stringify({ compilerOptions, files: ['index.ts'] }),
  );
  write(
    'app/index.ts',
    "import type { Value } from '../lib'; export const item: Value = { name: 'ok' };",
  );
  // The project tsconfig as it is when the builder configures the checker: no reference yet.
  write(
    'app/tsconfig.json',
    JSON.stringify({ compilerOptions, files: ['index.ts'] }),
  );
  // The generated checker config, exactly as `withTsgoDefaults` writes it.
  write(
    'app/.modern-js/tsgo/tsconfig.abc.json',
    JSON.stringify({
      extends: '../../tsconfig.json',
      compilerOptions: { baseUrl: null, rootDir: path.join(root, 'app') },
    }),
  );
  // The developer then adds the reference while the dev server is running.
  write(
    'app/tsconfig.json',
    JSON.stringify({
      compilerOptions,
      files: ['index.ts'],
      references: [{ path: '../lib' }],
    }),
  );
  const generated = path.join(root, 'app/.modern-js/tsgo/tsconfig.abc.json');
  // The referenced project is built, as a workspace typecheck step does before
  // `modern build`; with the reference restated, `app` resolves `lib` through
  // its declarations instead of compiling `lib`'s source inside its own program.
  await new UltramodernNativeTypeChecker({
    build: true,
    compiler: () => compiler,
    configFile: path.join(root, 'lib/tsconfig.json'),
  }).check();
  const build = rspack({
    context: root,
    mode: 'development',
    devtool: false,
    entry: './app/index.ts',
    output: { path: path.join(root, 'dist') },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'builtin:swc-loader',
          options: { jsc: { parser: { syntax: 'typescript' } } },
        },
      ],
    },
    plugins: [
      new UltramodernNativeTypeChecker({
        build: false,
        configFile: generated,
        compiler: () => compiler,
      }),
    ],
  });
  try {
    const stats = await new Promise<any>((resolve, reject) =>
      build.run((error, result) => (error ? reject(error) : resolve(result))),
    );
    expect(stats.toString({ all: false, errors: true })).not.toContain('error');
    const refreshed = JSON.parse(fs.readFileSync(generated, 'utf8')) as {
      references?: Array<{ path: string }>;
    };
    expect(refreshed.references).toEqual([
      { path: path.join(root, 'lib').replaceAll(path.sep, '/') },
    ]);
    expect(
      stats.compilation.fileDependencies.has(
        path.join(root, 'app/tsconfig.json'),
      ),
    ).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      build.close(error => (error ? reject(error) : resolve())),
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test('the rspack plugin keeps a missing project tsconfig registered so its return rebuilds', async () => {
  // Mid-edit the project tsconfig can be absent for a compilation. The
  // generated config still names it through `extends`; it must be registered
  // as a file and as a missing dependency (not realpathed, which would throw on
  // Windows), so restoring the file triggers the next compilation on its own.
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'native-plugin-missing-')),
  );
  const write = (relative: string, value: string) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  write('app/index.ts', 'export const item = 1;');
  write(
    'app/.modern-js/tsgo/tsconfig.abc.json',
    JSON.stringify({
      extends: '../../tsconfig.json',
      compilerOptions: { baseUrl: null },
    }),
  );
  const projectConfigFile = path.join(root, 'app/tsconfig.json');
  const build = rspack({
    context: root,
    mode: 'development',
    devtool: false,
    entry: './app/index.ts',
    output: { path: path.join(root, 'dist') },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'builtin:swc-loader',
          options: { jsc: { parser: { syntax: 'typescript' } } },
        },
      ],
    },
    plugins: [
      new UltramodernNativeTypeChecker({
        build: false,
        configFile: path.join(root, 'app/.modern-js/tsgo/tsconfig.abc.json'),
        compiler: () => compiler,
      }),
    ],
  });
  try {
    const stats = await new Promise<any>((resolve, reject) =>
      build.run((error, result) => (error ? reject(error) : resolve(result))),
    );
    // The compiler reports the broken project config; the build is not silent.
    expect(stats.hasErrors()).toBe(true);
    expect(stats.compilation.fileDependencies.has(projectConfigFile)).toBe(
      true,
    );
    expect(stats.compilation.missingDependencies.has(projectConfigFile)).toBe(
      true,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      build.close(error => (error ? reject(error) : resolve())),
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test('the rspack plugin keeps a newly referenced project whose tsconfig is absent registered', async () => {
  // A reference added to the project tsconfig may point at a project whose
  // tsconfig does not exist yet. `--showConfig` fails for it; the accumulated
  // watch set must survive and the referenced config must be registered as a
  // file and a missing dependency, so creating it re-triggers the compilation.
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'native-plugin-missing-ref-')),
  );
  const write = (relative: string, value: string) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  write('app/index.ts', 'export const item = 1;');
  write(
    'app/tsconfig.json',
    JSON.stringify({
      compilerOptions: { composite: true, types: [] },
      files: ['index.ts'],
      references: [{ path: '../lib' }],
    }),
  );
  write(
    'app/.modern-js/tsgo/tsconfig.abc.json',
    JSON.stringify({
      extends: '../../tsconfig.json',
      compilerOptions: { baseUrl: null, rootDir: path.join(root, 'app') },
    }),
  );
  const build = rspack({
    context: root,
    mode: 'development',
    devtool: false,
    entry: './app/index.ts',
    output: { path: path.join(root, 'dist') },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'builtin:swc-loader',
          options: { jsc: { parser: { syntax: 'typescript' } } },
        },
      ],
    },
    plugins: [
      new UltramodernNativeTypeChecker({
        build: false,
        configFile: path.join(root, 'app/.modern-js/tsgo/tsconfig.abc.json'),
        compiler: () => compiler,
      }),
    ],
  });
  try {
    const stats = await new Promise<any>((resolve, reject) =>
      build.run((error, result) => (error ? reject(error) : resolve(result))),
    );
    expect(stats.hasErrors()).toBe(true);
    const missingReference = path.join(root, 'lib/tsconfig.json');
    expect(stats.compilation.fileDependencies.has(missingReference)).toBe(true);
    expect(stats.compilation.missingDependencies.has(missingReference)).toBe(
      true,
    );
    // The inputs collected before the failing reference are not lost.
    expect(
      stats.compilation.fileDependencies.has(path.join(root, 'app/index.ts')),
    ).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      build.close(error => (error ? reject(error) : resolve())),
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test('the rspack plugin reports type errors as build errors and registers referenced type-only inputs', async () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'native-plugin-check-')),
  );
  const compilerOptions = {
    composite: true,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    types: [],
  };
  for (const [relative, value] of Object.entries({
    'lib/index.ts': 'export interface Value { name: number }',
    'lib/tsconfig.json': JSON.stringify({
      compilerOptions,
      files: ['index.ts'],
    }),
    'app/index.ts':
      "import type { Value } from '../lib'; export const item: Value = { name: 'ok' };",
    'app/tsconfig.json': JSON.stringify({
      compilerOptions,
      files: ['index.ts'],
      references: [{ path: '../lib' }],
    }),
  })) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  }
  const build = rspack({
    context: root,
    mode: 'development',
    devtool: false,
    entry: './app/index.ts',
    output: { path: path.join(root, 'dist') },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'builtin:swc-loader',
          options: { jsc: { parser: { syntax: 'typescript' } } },
        },
      ],
    },
    plugins: [
      new UltramodernNativeTypeChecker({
        build: true,
        configFile: path.join(root, 'app/tsconfig.json'),
        compiler: () => compiler,
      }),
    ],
  });
  try {
    const stats = await new Promise<any>((resolve, reject) =>
      build.run((error, result) => (error ? reject(error) : resolve(result))),
    );
    expect(stats.toString({ all: false, errors: true })).toContain('TS2322');
    // Type-only inputs are outside the module graph; watch rebuilds only if they are registered.
    expect(
      stats.compilation.fileDependencies.has(path.join(root, 'lib/index.ts')),
    ).toBe(true);
    expect(
      stats.compilation.fileDependencies.has(
        path.join(root, 'app/tsconfig.json'),
      ),
    ).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      build.close(error => (error ? reject(error) : resolve())),
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test('a missing renderer JSX runtime failure names the selected jsxImportSource', async () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'native-checker-jsx-runtime-')),
  );
  const configFile = path.join(root, 'tsconfig.json');
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(
      path.join(root, 'src/page.tsx'),
      'export default function Page() { return <main>authored for another renderer</main>; }',
    );
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'preserve',
          noEmit: true,
          strict: true,
          types: [],
        },
        include: ['src'],
      }),
    );
    const failure = await new UltramodernNativeTypeChecker({
      compiler: () => compiler,
      configFile,
      build: false,
      configOverwrite: { compilerOptions: { jsxImportSource: 'octane' } },
    })
      .check()
      .then(
        () => undefined,
        (error: Error) => error.message,
      );
    expect(failure).toContain(
      "error TS2875: This JSX tag requires the module path 'octane/jsx-runtime'",
    );
    expect(failure).toContain(
      "Hint: JSX compiles against jsxImportSource 'octane', the selected renderer's runtime, but 'octane/jsx-runtime' cannot be resolved from this app.",
    );
    expect(missingJsxRuntimeHint('error TS2322: unrelated')).toBe('');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
