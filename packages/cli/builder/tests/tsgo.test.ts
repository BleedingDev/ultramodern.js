import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from '@rstest/core';
import {
  refreshTsgoCheckerConfig,
  type TsCheckerOptions,
  withTsgoDefaults,
} from '../src/shared/tsgo';

const temporaryRoots: string[] = [];

/** A vertical's on-disk shape: sources under `src/` and a BFF under `api/`. */
const createVerticalApp = (compilerOptions: Record<string, unknown>) => {
  const appDirectory = realpathSync.native(
    mkdtempSync(path.join(tmpdir(), 'tsgo-vertical-')),
  );
  temporaryRoots.push(appDirectory);
  mkdirSync(path.join(appDirectory, 'src'), { recursive: true });
  mkdirSync(path.join(appDirectory, 'api'), { recursive: true });
  writeFileSync(
    path.join(appDirectory, 'src', 'index.ts'),
    'export const a = 1;\n',
  );
  writeFileSync(
    path.join(appDirectory, 'api', 'index.ts'),
    'export const b = 2;\n',
  );
  writeFileSync(
    path.join(appDirectory, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions, include: ['src', 'api'] }, null, 2)}\n`,
  );
  return appDirectory;
};

const readGeneratedCheckerConfig = (
  appDirectory: string,
  config: TsCheckerOptions,
) => {
  const generated = config.typescript?.configFile as string;
  expect(
    generated.startsWith(path.join(appDirectory, '.modern-js', 'tsgo')),
  ).toBe(true);
  return JSON.parse(readFileSync(generated, 'utf8')) as {
    extends: string;
    compilerOptions: Record<string, unknown>;
  };
};

const applyChain = (
  chain: ReturnType<typeof withTsgoDefaults>,
): TsCheckerOptions => {
  const entries = Array.isArray(chain) ? chain : [chain];
  let config = {} as TsCheckerOptions;
  for (const entry of entries) {
    if (typeof entry === 'function') {
      config = (entry as (input: TsCheckerOptions) => TsCheckerOptions)(
        config,
      ) as TsCheckerOptions;
      continue;
    }
    config = {
      ...config,
      ...(entry as TsCheckerOptions),
      typescript: {
        ...config.typescript,
        ...(entry as TsCheckerOptions).typescript,
      },
    };
  }
  return config;
};

describe('withTsgoDefaults', () => {
  test('uses the owning stable TypeScript 7.0.2 provider when the app has none', () => {
    const appDirectory = createVerticalApp({ strict: true });
    const config = applyChain(withTsgoDefaults(undefined, appDirectory));
    const packageJsonPath = config.typescript?.typescriptPath;
    expect(config.typescript?.tsgo).toBe(true);
    expect(typeof packageJsonPath).toBe('string');
    if (!packageJsonPath) throw new Error('The compiler provider is absent');
    const provider = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    expect(provider.name).toBe('typescript');
    expect(provider.version).toBe('7.0.2');
  });

  test('prefers the app canonical stable compiler package', () => {
    const appDirectory = createVerticalApp({ strict: true });
    const packageJsonPath = path.join(
      appDirectory,
      'node_modules/typescript/package.json',
    );
    mkdirSync(path.dirname(packageJsonPath), { recursive: true });
    writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: 'typescript', version: '7.0.2' }),
    );

    const config = applyChain(withTsgoDefaults(undefined, appDirectory));
    expect(config.typescript?.typescriptPath).toBe(packageJsonPath);
  });

  test('does not use an app preview compiler instead of the stable owning provider', () => {
    const appDirectory = createVerticalApp({ strict: true });
    const previewPath = path.join(
      appDirectory,
      'node_modules/@typescript/native-preview/package.json',
    );
    mkdirSync(path.dirname(previewPath), { recursive: true });
    writeFileSync(
      previewPath,
      JSON.stringify({
        name: '@typescript/native-preview',
        version: '7.0.0-dev.20260707.2',
      }),
    );

    const config = applyChain(withTsgoDefaults(undefined, appDirectory));
    const packageJsonPath = config.typescript?.typescriptPath;
    expect(packageJsonPath).not.toBe(previewPath);
    if (!packageJsonPath) throw new Error('The compiler provider is absent');
    expect(JSON.parse(readFileSync(packageJsonPath, 'utf8'))).toMatchObject({
      name: 'typescript',
      version: '7.0.2',
    });
  });

  test.each([
    '5.9.3',
    '6.0.2',
    '7.0.0-dev.20260707.2',
    '7.0.2-rc.1',
    '7.1.0',
    '8.0.0',
  ])(
    'rejects app compiler %s without replacing it with another provider',
    version => {
      const appDirectory = createVerticalApp({ strict: true });
      const packageJsonPath = path.join(
        appDirectory,
        'node_modules/typescript/package.json',
      );
      mkdirSync(path.dirname(packageJsonPath), { recursive: true });
      writeFileSync(
        packageJsonPath,
        JSON.stringify({ name: 'typescript', version }),
      );

      expect(() => withTsgoDefaults(undefined, appDirectory)).toThrow(
        `requires typescript@7.0.2; found typescript@${version}`,
      );
      expect(readFileSync(packageJsonPath, 'utf8')).toBe(
        JSON.stringify({ name: 'typescript', version }),
      );
    },
  );

  test('rejects a different package posing as the canonical compiler', () => {
    const appDirectory = createVerticalApp({ strict: true });
    const packageJsonPath = path.join(
      appDirectory,
      'node_modules/typescript/package.json',
    );
    mkdirSync(path.dirname(packageJsonPath), { recursive: true });
    writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: '@typescript/native-preview', version: '7.0.2' }),
    );

    expect(() => withTsgoDefaults(undefined, appDirectory)).toThrow(
      'requires typescript@7.0.2; found @typescript/native-preview@7.0.2',
    );
  });

  test('neutralises the removed `baseUrl` option for the type checker', () => {
    // TypeScript 7 removed `baseUrl` (TS5102). Every project whose tsconfig
    // still sets it must keep building, so the checker gets an override that
    // blanks the option out.
    const config = applyChain(withTsgoDefaults(undefined, process.cwd()));

    expect(config.typescript?.configOverwrite?.compilerOptions).toMatchObject({
      baseUrl: null,
    });
  });

  test('keeps user tsChecker options and their own overrides', () => {
    const config = applyChain(
      withTsgoDefaults(
        {
          typescript: {
            memoryLimit: 4096,
            configOverwrite: { compilerOptions: { strict: true } },
          },
        },
        process.cwd(),
      ),
    );

    expect(config.typescript?.memoryLimit).toBe(4096);
    expect(config.typescript?.configOverwrite?.compilerOptions).toMatchObject({
      strict: true,
      baseUrl: null,
    });
  });

  test('drops `moduleResolution` when the project still asks for node10', () => {
    const config = applyChain(
      withTsgoDefaults(
        {
          typescript: {
            configOverwrite: { compilerOptions: { moduleResolution: 'node' } },
          },
        },
        process.cwd(),
      ),
    );

    expect(config.typescript?.configOverwrite?.compilerOptions).toMatchObject({
      baseUrl: null,
      moduleResolution: null,
    });
  });

  test('keeps rootDir at the app root for a composite vertical layout', () => {
    // The generated checker config lives in `.modern-js/tsgo/`. With
    // `composite` and no explicit `rootDir`, TypeScript would default the root
    // to that generated directory and reject every file under `src/` and
    // `api/` with TS6059.
    const appDirectory = createVerticalApp({ composite: true, baseUrl: '.' });
    const config = applyChain(
      withTsgoDefaults(
        { typescript: { configFile: 'tsconfig.json' } },
        appDirectory,
      ),
    );
    const generated = readGeneratedCheckerConfig(appDirectory, config);

    expect(generated.compilerOptions.rootDir).toBe(
      appDirectory.replaceAll(path.sep, '/'),
    );
    expect(generated.compilerOptions.baseUrl).toBeNull();
  });

  test('resolves an explicit relative rootDir against the project, not the generated config', () => {
    const appDirectory = createVerticalApp({ rootDir: '.', baseUrl: '.' });
    const config = applyChain(
      withTsgoDefaults(
        { typescript: { configFile: 'tsconfig.json' } },
        appDirectory,
      ),
    );
    const generated = readGeneratedCheckerConfig(appDirectory, config);

    // `.` next to the project config means the app root; inherited into
    // `.modern-js/tsgo/` it would otherwise mean the generated directory.
    expect(generated.compilerOptions.rootDir).toBe(
      appDirectory.replaceAll(path.sep, '/'),
    );
  });

  test('keeps the project root for a non-composite project without rootDir', () => {
    const appDirectory = createVerticalApp({ baseUrl: '.' });
    const config = applyChain(
      withTsgoDefaults(
        { typescript: { configFile: 'tsconfig.json' } },
        appDirectory,
      ),
    );
    const generated = readGeneratedCheckerConfig(appDirectory, config);

    expect(generated.compilerOptions.rootDir).toBe(
      appDirectory.replaceAll(path.sep, '/'),
    );
  });

  test('preserves an inherited rootDir relative to its declaring config', () => {
    const appDirectory = createVerticalApp({});
    mkdirSync(path.join(appDirectory, 'config'));
    writeFileSync(
      path.join(appDirectory, 'config/base.json'),
      JSON.stringify({ compilerOptions: { rootDir: '..' } }),
    );
    writeFileSync(
      path.join(appDirectory, 'tsconfig.json'),
      JSON.stringify({
        extends: './config/base.json',
        include: ['src', 'api'],
      }),
    );
    const config = applyChain(
      withTsgoDefaults(
        { typescript: { configFile: 'tsconfig.json' } },
        appDirectory,
      ),
    );
    const generated = readGeneratedCheckerConfig(appDirectory, config);

    expect(generated.compilerOptions.rootDir).toBe(
      appDirectory.replaceAll(path.sep, '/'),
    );
  });

  test('builds ordinary app sources with the stable native compiler and keeps strict errors', () => {
    const appDirectory = createVerticalApp({
      strict: true,
      types: [],
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      outDir: 'dist',
    });
    const projectConfigFile = path.join(appDirectory, 'tsconfig.json');
    const authoredConfig = readFileSync(projectConfigFile, 'utf8');
    const config = applyChain(
      withTsgoDefaults(
        { typescript: { configFile: 'tsconfig.json' } },
        appDirectory,
      ),
    );
    const packageJsonPath = config.typescript?.typescriptPath;
    if (!packageJsonPath) throw new Error('The compiler provider is absent');
    const provider = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const compiler = path.resolve(
      path.dirname(packageJsonPath),
      provider.bin.tsc,
    );
    const args = [
      compiler,
      '--build',
      config.typescript?.configFile as string,
      '--pretty',
      'false',
    ];

    // Build mode checks root containment; --noEmit alone cannot catch TS6059.
    const valid = spawnSync(process.execPath, args, {
      cwd: appDirectory,
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(valid.error).toBeUndefined();
    expect(valid.stdout + valid.stderr).toBe('');
    expect(valid.status).toBe(0);
    expect(
      readFileSync(path.join(appDirectory, 'dist/src/index.js'), 'utf8'),
    ).toContain('export const a = 1;');
    expect(
      readFileSync(path.join(appDirectory, 'dist/api/index.js'), 'utf8'),
    ).toContain('export const b = 2;');

    writeFileSync(
      path.join(appDirectory, 'src/index.ts'),
      'export const a: string = 1;\n',
    );
    const invalid = spawnSync(process.execPath, [...args, '--force'], {
      cwd: appDirectory,
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(invalid.error).toBeUndefined();
    expect(invalid.status).not.toBe(0);
    expect(invalid.stdout + invalid.stderr).toContain('TS2322');
    expect(invalid.stdout + invalid.stderr).not.toContain('TS6059');
    expect(readFileSync(projectConfigFile, 'utf8')).toBe(authoredConfig);
  });

  test('restates project references so a referenced sibling stays a project boundary', () => {
    // `references` is the one top-level property TypeScript does not inherit
    // through `extends`. Dropping it pulls a referenced sibling's sources into
    // this program and checks them against this program's globals, instead of
    // redirecting to the sibling's own declarations.
    const appDirectory = createVerticalApp({ composite: true });
    writeFileSync(
      path.join(appDirectory, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: { composite: true },
          include: ['src', 'api'],
          references: [
            { path: '../checkout' },
            { path: '../../packages/shared' },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const config = applyChain(
      withTsgoDefaults(
        { typescript: { configFile: 'tsconfig.json' } },
        appDirectory,
      ),
    );
    const generated = readGeneratedCheckerConfig(appDirectory, config) as {
      references?: Array<{ path: string }>;
    };

    // Resolved against the project config, not the generated directory.
    expect(generated.references).toEqual([
      {
        path: path
          .resolve(appDirectory, '../checkout')
          .replaceAll(path.sep, '/'),
      },
      {
        path: path
          .resolve(appDirectory, '../../packages/shared')
          .replaceAll(path.sep, '/'),
      },
    ]);
  });

  test('refreshes restated references from the project config on demand', () => {
    // The generated file is written at builder configuration. During
    // `modern dev` the checker asks for a refresh before every run, so a
    // reference added, removed or retargeted in the project's tsconfig reaches
    // the next compilation instead of the next restart.
    const appDirectory = createVerticalApp({ composite: true });
    const config = applyChain(
      withTsgoDefaults(
        { typescript: { configFile: 'tsconfig.json' } },
        appDirectory,
      ),
    );
    const generatedFile = config.typescript?.configFile as string;
    expect(
      'references' in readGeneratedCheckerConfig(appDirectory, config),
    ).toBe(false);

    writeFileSync(
      path.join(appDirectory, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: { composite: true },
          include: ['src', 'api'],
          references: [{ path: '../checkout' }],
        },
        null,
        2,
      )}\n`,
    );
    expect(refreshTsgoCheckerConfig(generatedFile)).toBe(
      path.join(appDirectory, 'tsconfig.json'),
    );
    const refreshed = readGeneratedCheckerConfig(appDirectory, config) as {
      references?: Array<{ path: string }>;
    };
    expect(refreshed.references).toEqual([
      {
        path: path
          .resolve(appDirectory, '../checkout')
          .replaceAll(path.sep, '/'),
      },
    ]);

    // Not a generated checker config: nothing to refresh, nothing to watch.
    expect(
      refreshTsgoCheckerConfig(path.join(appDirectory, 'tsconfig.json')),
    ).toBeUndefined();
  });

  test('keeps handing back the project config to watch while it is malformed or missing', () => {
    // Mid-edit the project tsconfig may be unparsable or briefly absent. The
    // refresh must not throw, must leave the last good generated config in
    // place, and must still return the path so the checker keeps watching it
    // and the next save re-triggers the compilation.
    const appDirectory = createVerticalApp({ composite: true });
    const projectConfigFile = path.join(appDirectory, 'tsconfig.json');
    const config = applyChain(
      withTsgoDefaults(
        { typescript: { configFile: 'tsconfig.json' } },
        appDirectory,
      ),
    );
    const generatedFile = config.typescript?.configFile as string;
    const lastGood = readFileSync(generatedFile, 'utf8');

    writeFileSync(projectConfigFile, '{ "compilerOptions": { "composite": tru');
    expect(refreshTsgoCheckerConfig(generatedFile)).toBe(projectConfigFile);
    expect(readFileSync(generatedFile, 'utf8')).toBe(lastGood);

    rmSync(projectConfigFile);
    expect(refreshTsgoCheckerConfig(generatedFile)).toBe(projectConfigFile);
    expect(readFileSync(generatedFile, 'utf8')).toBe(lastGood);
  });

  test('omits references when the project declares none', () => {
    const appDirectory = createVerticalApp({ composite: true });
    const config = applyChain(
      withTsgoDefaults(
        { typescript: { configFile: 'tsconfig.json' } },
        appDirectory,
      ),
    );
    const generated = readGeneratedCheckerConfig(appDirectory, config);

    expect('references' in generated).toBe(false);
  });

  test('preserves explicit tsgo opt-out and the selected stable provider', () => {
    const config = applyChain(
      withTsgoDefaults({ typescript: { tsgo: false } }, process.cwd()),
    );

    expect(config.typescript?.tsgo).toBe(false);
    expect(config.typescript?.typescriptPath).toBeDefined();
    // Native-only configuration overrides do not apply to the explicit opt-out.
    expect(config.typescript?.configOverwrite).toBeUndefined();
  });

  afterEach(() => {
    while (temporaryRoots.length) {
      rmSync(temporaryRoots.pop()!, { force: true, recursive: true });
    }
  });
});
