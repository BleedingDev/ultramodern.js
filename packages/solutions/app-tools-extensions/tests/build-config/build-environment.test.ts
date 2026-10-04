import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getBuildConfigEnvironment,
  resolveEffectTsgoCompiler,
} from '../../src/build-config/public';

const nativePlatformName = `@typescript/typescript-${process.platform}-${process.arch}`;
const effectPlatformName = `@effect/tsgo-${process.platform}-${process.arch}`;
const compilerBasename = process.platform === 'win32' ? 'tsc.exe' : 'tsc';
const nativeGitHead = '2bd066d87f5bafd315be9f40889d0a60b9e58e0b';
const nativeVersion = '7.0.2';
const effectVersion = '0.45.0';

const LIFECYCLE_HOOK_NAMES = [
  'run',
  'watchRun',
  'done',
  'afterDone',
  'failed',
  'shutdown',
  'watchClose',
] as const;

type LifecycleHookName = (typeof LIFECYCLE_HOOK_NAMES)[number];
type TestRspackConfig = {
  plugins?: Rspack.Plugin[];
};

async function withEnvironment<T>(
  name: string,
  value: string | undefined,
  action: () => T | Promise<T>,
): Promise<T> {
  const previous = process.env[name];

  try {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
    return await action();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

function withWorkingDirectory<T>(directory: string, action: () => T): T {
  const previous = process.cwd();

  try {
    process.chdir(directory);
    return action();
  } finally {
    process.chdir(previous);
  }
}

function effectCompilerPath(
  directory: string,
  version = nativeVersion,
): string {
  return join(
    directory,
    'node_modules',
    effectPlatformName,
    'artifacts/typescript',
    version,
    compilerBasename,
  );
}

function effectMetadataPath(directory: string): string {
  return join(
    directory,
    'node_modules',
    effectPlatformName,
    'lib/upstream.json',
  );
}

function writeEffectTsgoPackage(directory: string): void {
  const packageDirectory = join(directory, 'node_modules/@effect/tsgo');
  mkdirSync(join(packageDirectory, 'bin'), { recursive: true });
  writeFileSync(
    join(packageDirectory, 'package.json'),
    JSON.stringify({ name: packageName, ...packageJson }),
  );
  return packageDirectory;
}

/**
 * Lays out an installed Effect TS-Go with its platform package and a native
 * TypeScript install, and returns the packaged TypeScript compiler path.
 */
function writeEffectTsgoPackage(
  directory: string,
  platformTarget = `${process.platform}-${process.arch}`,
): string {
  writePackageJson(directory, '@effect/tsgo', {
    bin: { 'effect-tsgo': './dist/effect-tsgo.cjs' },
  });
  const platformDirectory = writePackageJson(
    directory,
    `@effect/tsgo-${platformTarget}`,
    { version: '0.46.1' },
  );
  mkdirSync(join(platformDirectory, 'lib'));
  writeFileSync(
    join(platformDirectory, 'lib/upstream.json'),
    JSON.stringify({
      name: '@effect/tsgo',
      version: effectVersion,
      bin: { 'effect-tsgo': './bin/effect-tsgo.js' },
      exports: { './package.json': './package.json' },
      optionalDependencies: { [effectPlatformName]: effectVersion },
    }),
  );
  writeFileSync(
    join(packageDirectory, 'bin/effect-tsgo.js'),
    `require('node:fs').writeFileSync(${JSON.stringify(join(directory, 'cli-started'))}, 'unexpected spawn');\nthrow new Error('Effect discovery must not execute its CLI');\n`,
  );
  writeTypeScriptPackage(
    join(directory, 'node_modules/typescript'),
    nativeVersion,
  );
  writeNativePlatformPackage(
    join(directory, 'node_modules', nativePlatformName),
  );
  const platformDirectory = join(directory, 'node_modules', effectPlatformName);
  mkdirSync(join(platformDirectory, 'lib'), { recursive: true });
  writeFileSync(
    join(platformDirectory, 'package.json'),
    JSON.stringify({
      name: effectPlatformName,
      version: effectVersion,
      os: [process.platform],
      cpu: [process.arch],
      exports: { './package.json': './package.json' },
    }),
  );
  writeFileSync(
    effectMetadataPath(directory),
    JSON.stringify({
      schemaVersion: 5,
      components: {
        typescript: {
          [nativeVersion]: {
            gitHead: nativeGitHead,
            provider: 'typescript-go',
          },
        },
      },
    }),
  );
}

function writeTypeScriptPackage(directory: string, version: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: 'typescript',
      version,
      gitHead: nativeGitHead,
      bin: { tsc: './bin/tsc' },
      optionalDependencies: { [nativePlatformName]: version },
      exports: { './package.json': './package.json' },
    }),
  );
}

function writeNativePlatformPackage(
  directory: string,
  version = nativeVersion,
): void {
  mkdirSync(join(directory, 'lib'), { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: nativePlatformName,
      version,
      gitHead: nativeGitHead,
      os: [process.platform],
      cpu: [process.arch],
      exports: { './package.json': './package.json' },
    }),
  );
  writeFileSync(
    join(directory, 'lib', compilerBasename),
    'native TypeScript compiler\n',
  );
}

function writeCompiler(compilerPath: string, mode: number): void {
  mkdirSync(join(compilerPath, '..'), { recursive: true });
  writeFileSync(
    compilerPath,
    `#!/usr/bin/env node\nconsole.log('fixture compiler');\n`,
  );
  chmodSync(compilerPath, mode);
}

test('reads build config environment without process-global state', async () => {
  await withEnvironment('ZE_FAIL_BUILD', 'true', () => {
    assert.equal(getBuildConfigEnvironment('ZE_FAIL_BUILD'), 'true');
  });
  await withEnvironment('ZE_FAIL_BUILD', undefined, () => {
    assert.equal(getBuildConfigEnvironment('ZE_FAIL_BUILD'), undefined);
  });
  assert.deepEqual(
    Object.getOwnPropertySymbols(process).filter(symbol =>
      symbol.description?.startsWith('@modern-js/app-tools/'),
    ),
    [],
  );
});

test('repairs Unix execute bits and preserves Windows package paths without mutation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'app-tools-effect-tsgo-mode-'));
  const compilerPath = effectCompilerPath(directory);
  const temporaryRoot = join(directory, 'tmp');

  try {
    mkdirSync(temporaryRoot);
    const compilerPath = writeEffectTsgoPackage(directory);
    writeCompiler(compilerPath, 0o600);
    writeEffectTsgoPackage(directory);
    await withEnvironment('TMPDIR', temporaryRoot, () =>
      withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
        const firstResolution = resolveEffectTsgoCompiler({
          from: pathToFileURL(join(directory, 'modern.config.ts')),
        });
        const secondResolution = resolveEffectTsgoCompiler({
          from: pathToFileURL(join(directory, 'modern.config.ts')),
        });

        if (process.platform === 'win32') {
          assert.equal(firstResolution, compilerPath);
        } else {
          assert.notEqual(firstResolution, compilerPath);
          accessSync(firstResolution, constants.X_OK);
          assert.throws(() => accessSync(compilerPath, constants.X_OK));
        }
        assert.equal(secondResolution, firstResolution);
        assert.equal(
          readFileSync(firstResolution, 'utf-8'),
          readFileSync(compilerPath, 'utf-8'),
        );
        // Windows needs Node for this JS fixture; Unix must execute the repaired file.
        assert.equal(
          execFileSync(
            process.platform === 'win32' ? process.execPath : firstResolution,
            process.platform === 'win32' ? [firstResolution] : [],
            { encoding: 'utf-8' },
          ).trim(),
          'fixture compiler',
        );
      }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deduplicates Unix executable copies while retaining native Windows paths', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'app-tools-effect-tsgo-cache-'));
  const firstPackage = join(directory, 'first');
  const secondPackage = join(directory, 'second');
  const temporaryRoot = join(directory, 'tmp');
  const firstCompiler = effectCompilerPath(firstPackage);
  const secondCompiler = effectCompilerPath(secondPackage);

  try {
    mkdirSync(temporaryRoot);
    const firstCompiler = writeEffectTsgoPackage(firstPackage);
    const secondCompiler = writeEffectTsgoPackage(secondPackage);
    writeCompiler(firstCompiler, 0o600);
    writeCompiler(secondCompiler, 0o600);
    writeEffectTsgoPackage(firstPackage);
    writeEffectTsgoPackage(secondPackage);

    await withEnvironment('TMPDIR', temporaryRoot, () =>
      withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
        const firstResolution = resolveEffectTsgoCompiler({
          from: pathToFileURL(join(firstPackage, 'modern.config.ts')),
        });
        const secondResolution = resolveEffectTsgoCompiler({
          from: pathToFileURL(join(secondPackage, 'modern.config.ts')),
        });

        if (process.platform === 'win32') {
          assert.equal(firstResolution, firstCompiler);
          assert.equal(secondResolution, secondCompiler);
        } else {
          assert.equal(secondResolution, firstResolution);
          accessSync(firstResolution, constants.X_OK);
        }
        for (const resolvedCompiler of [firstResolution, secondResolution]) {
          assert.equal(
            execFileSync(process.execPath, [resolvedCompiler], {
              encoding: 'utf-8',
            }).trim(),
            'fixture compiler',
          );
        }
      }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('resolves and executes a platform-native compiler override directly', async () => {
  await withEnvironment('EFFECT_TSGO_BIN', process.execPath, () => {
    const compiler = resolveEffectTsgoCompiler({ from: import.meta.url });
    assert.equal(compiler, process.execPath);
    assert.equal(
      execFileSync(compiler, ['--version'], { encoding: 'utf-8' }).trim(),
      process.version,
    );
  });
});

test('resolves Effect TS-Go from the requesting module origin', async () => {
  const originDirectory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-origin-'),
  );
  const workingDirectory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-cwd-'),
  );
  const originCompilerPath = effectCompilerPath(originDirectory);
  const cwdCompilerPath = effectCompilerPath(workingDirectory);

  try {
    writeEffectTsgoPackage(originDirectory);
    writeEffectTsgoPackage(workingDirectory);
    writeCompiler(originCompilerPath, 0o700);
    writeCompiler(cwdCompilerPath, 0o700);
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      withWorkingDirectory(workingDirectory, () => {
        assert.equal(
          realpathSync(
            resolveEffectTsgoCompiler({
              from: pathToFileURL(join(originDirectory, 'modern.config.ts')),
            }),
          ),
          realpathSync(originCompilerPath),
        );
      });
    });
  } finally {
    rmSync(originDirectory, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test('selects the installed native alias from the original anchor without running the provider CLI', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-backend-'),
  );
  const appDirectory = join(directory, 'app');
  const stagingDirectory = join(directory, 'empty-stage');
  const nativeDirectory = join(directory, 'selected-native');
  const compilerPath = effectCompilerPath(appDirectory);
  try {
    mkdirSync(stagingDirectory);
    writeEffectTsgoPackage(appDirectory);
    writeTypeScriptPackage(
      join(appDirectory, 'node_modules/typescript'),
      '5.9.3',
    );
    writeTypeScriptPackage(nativeDirectory, '7.0.2');
    writeNativePlatformPackage(
      join(nativeDirectory, 'node_modules', nativePlatformName),
    );
    mkdirSync(join(appDirectory, 'node_modules/@typescript'), {
      recursive: true,
    });
    symlinkSync(
      nativeDirectory,
      join(appDirectory, 'node_modules/@typescript/native'),
      'dir',
    );
    writeCompiler(compilerPath, 0o700);
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      withWorkingDirectory(stagingDirectory, () => {
        assert.equal(
          resolveEffectTsgoCompiler({
            from: pathToFileURL(
              join(appDirectory, 'module-federation.config.ts'),
            ),
          }),
          compilerPath,
        );
        assert.equal(existsSync(join(appDirectory, 'cli-started')), false);
        assert.equal(process.cwd(), realpathSync(stagingDirectory));
      });
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('selects the exact canonical native version instead of another artifact with the same gitHead', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-exact-version-'),
  );
  try {
    writeEffectTsgoPackage(directory);
    writeTypeScriptPackage(
      join(directory, 'node_modules/@typescript/native'),
      '7.1.0',
    );
    writeCompiler(effectCompilerPath(directory), 0o700);
    writeCompiler(effectCompilerPath(directory, '7.1.0'), 0o700);
    writeFileSync(
      effectMetadataPath(directory),
      JSON.stringify({
        schemaVersion: 5,
        components: {
          typescript: {
            '7.1.0': { gitHead: nativeGitHead, provider: 'typescript-go' },
            [nativeVersion]: {
              gitHead: nativeGitHead,
              provider: 'typescript-go',
            },
          },
        },
      }),
    );
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      assert.equal(
        resolveEffectTsgoCompiler({
          from: pathToFileURL(join(directory, 'modern.config.ts')),
        }),
        effectCompilerPath(directory),
      );
      assert.equal(existsSync(join(directory, 'cli-started')), false);
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('preserves an invalid installed TypeScript package instead of choosing the alternate backend', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-invalid-backend-'),
  );
  try {
    writeEffectTsgoPackage(directory);
    writeFileSync(
      join(directory, 'node_modules/typescript/package.json'),
      '{ invalid',
    );
    writeTypeScriptPackage(
      join(directory, 'node_modules/@typescript/native'),
      '7.0.2',
    );
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      assert.throws(
        () =>
          resolveEffectTsgoCompiler({
            from: pathToFileURL(join(directory, 'modern.config.ts')),
          }),
        error => {
          assert.ok(error instanceof Error);
          assert.match(
            error.message,
            /Native TypeScript package resolution failed/u,
          );
          assert.ok(error.cause instanceof Error);
          assert.match(error.cause.message, /package config|JSON/iu);
          return true;
        },
      );
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a provider with no installed native backend without starting its CLI', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-no-backend-'),
  );
  try {
    writeEffectTsgoPackage(directory);
    writeTypeScriptPackage(join(directory, 'node_modules/typescript'), '5.9.3');
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      assert.throws(
        () =>
          resolveEffectTsgoCompiler({
            from: pathToFileURL(join(directory, 'modern.config.ts')),
          }),
        /Native TypeScript package resolution failed.*No native TypeScript backend/su,
      );
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('preserves an installed TypeScript export with a missing target instead of choosing the alternate', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-broken-export-'),
  );
  const compilerPath = effectCompilerPath(directory);
  const from = pathToFileURL(join(directory, 'modern.config.ts'));
  try {
    writeEffectTsgoPackage(directory);
    writeCompiler(compilerPath, 0o700);
    writeFileSync(
      join(directory, 'node_modules/typescript/package.json'),
      JSON.stringify({
        name: 'typescript',
        version: '7.0.2',
        exports: { './package.json': './missing.json' },
      }),
    );
    writeTypeScriptPackage(
      join(directory, 'node_modules/@typescript/native'),
      '7.0.2',
    );
    let originalError: unknown;
    try {
      createRequire(from).resolve('typescript/package.json');
    } catch (error) {
      originalError = error;
    }
    assert.ok(originalError instanceof Error);
    assert.ok('code' in originalError);
    assert.equal(originalError.code, 'MODULE_NOT_FOUND');
    assert.ok('path' in originalError);
    assert.equal(
      originalError.path,
      join(directory, 'node_modules/typescript'),
    );
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      assert.throws(
        () => resolveEffectTsgoCompiler({ from }),
        error => {
          assert.ok(error instanceof Error);
          assert.match(
            error.message,
            /Native TypeScript package resolution failed/u,
          );
          assert.ok(error.cause instanceof Error);
          assert.equal(error.cause.message, originalError.message);
          assert.ok('code' in error.cause);
          assert.equal(error.cause.code, 'MODULE_NOT_FOUND');
          return true;
        },
      );
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('selects the actual declared generator Effect artifact from an empty staging cwd', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-real-provider-'),
  );
  try {
    const generatorDirectory = join(
      import.meta.dirname,
      '../../../../toolkit/ultramodern-create',
    );
    const generatorManifestPath = join(generatorDirectory, 'package.json');
    const generatorManifest = JSON.parse(
      readFileSync(generatorManifestPath, 'utf-8'),
    );
    const generatorRequire = createRequire(generatorManifestPath);
    const effectManifestPath = generatorRequire.resolve(
      '@effect/tsgo/package.json',
    );
    const nativeManifestPath = generatorRequire.resolve(
      'typescript/package.json',
    );
    const effectManifest = JSON.parse(
      readFileSync(effectManifestPath, 'utf-8'),
    );
    const nativeManifest = JSON.parse(
      readFileSync(nativeManifestPath, 'utf-8'),
    );
    assert.ok(generatorManifest.dependencies['@effect/tsgo']);
    assert.ok(generatorManifest.dependencies['@typescript/native']);
    assert.equal(generatorManifest.dependencies.typescript, '7.0.2');
    assert.equal(nativeManifest.name, 'typescript');
    assert.match(nativeManifest.version, /^7\./u);
    const platformManifestPath = createRequire(effectManifestPath).resolve(
      `${effectPlatformName}/package.json`,
    );
    const upstream = JSON.parse(
      readFileSync(
        join(dirname(platformManifestPath), 'lib/upstream.json'),
        'utf8',
      ),
    );
    assert.equal(upstream.schemaVersion, 5);
    assert.equal(
      upstream.components.typescript[nativeManifest.version].gitHead,
      nativeManifest.gitHead,
    );
    assert.equal(
      upstream.components.typescript[nativeManifest.version].provider,
      'typescript-go',
    );
    const nativePlatformManifest = createRequire(nativeManifestPath).resolve(
      `${nativePlatformName}/package.json`,
    );
    const nativeCompiler = join(
      dirname(nativePlatformManifest),
      'lib',
      compilerBasename,
    );
    const expectedCompiler = join(
      dirname(platformManifestPath),
      'artifacts/typescript',
      nativeManifest.version,
      compilerBasename,
    );
    const digest = (filename: string) =>
      createHash('sha256').update(readFileSync(filename)).digest('hex');
    assert.notEqual(digest(nativeCompiler), digest(expectedCompiler));
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      withWorkingDirectory(directory, () => {
        const compiler = resolveEffectTsgoCompiler({
          from: pathToFileURL(
            join(generatorDirectory, 'module-federation.config.ts'),
          ),
        });
        assert.equal(digest(compiler), digest(expectedCompiler));
        assert.deepEqual(
          readFileSync(compiler),
          readFileSync(expectedCompiler),
        );
        accessSync(compiler, constants.X_OK);
        assert.equal(process.cwd(), realpathSync(directory));
      });
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('preserves an installed TypeScript directory with a missing manifest', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-missing-manifest-'),
  );
  try {
    writeEffectTsgoPackage(directory);
    rmSync(join(directory, 'node_modules/typescript/package.json'));
    writeTypeScriptPackage(
      join(directory, 'node_modules/@typescript/native'),
      '7.0.2',
    );
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      assert.throws(
        () =>
          resolveEffectTsgoCompiler({
            from: pathToFileURL(join(directory, 'modern.config.ts')),
          }),
        error => {
          assert.ok(error instanceof Error);
          assert.match(
            error.message,
            /Native TypeScript package resolution failed/u,
          );
          assert.ok(error.cause instanceof Error);
          assert.ok('code' in error.cause);
          assert.equal(error.cause.code, 'MODULE_NOT_FOUND');
          return true;
        },
      );
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reports stable installation guidance when Effect TS-Go is unavailable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'app-tools-effect-tsgo-'));

  try {
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      assert.throws(
        () =>
          resolveEffectTsgoCompiler({
            from: pathToFileURL(join(directory, 'modern.config.ts')),
          }),
        error => {
          assert.ok(error instanceof Error);
          assert.match(
            error.message,
            /Install "@effect\/tsgo" and a native TypeScript backend for this build config, or set EFFECT_TSGO_BIN/u,
          );
          assert.match(error.message, /Package CLI resolution failed/u);
          assert.ok(error.cause instanceof Error);
          assert.ok('code' in error.cause);
          assert.equal(error.cause.code, 'MODULE_NOT_FOUND');
          assert.ok(error.message.includes(error.cause.message));
          return true;
        },
      );
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('retains malformed Effect metadata and the requesting config origin without running the CLI', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-cli-failure-'),
  );
  const from = pathToFileURL(join(directory, 'module-federation.config.ts'));
  try {
    writeEffectTsgoPackage(directory);
    writeFileSync(effectMetadataPath(directory), '{ invalid');
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      assert.throws(
        () => resolveEffectTsgoCompiler({ from }),
        error => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Compiler backend lookup failed/u);
          assert.ok(error.message.includes(from.href));
          assert.ok(error.cause instanceof Error);
          assert.ok(error.cause instanceof SyntaxError);
          assert.equal(existsSync(join(directory, 'cli-started')), false);
          return true;
        },
      );
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('preserves a missing Effect artifact as a backend filesystem error', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-executable-failure-'),
  );
  const from = pathToFileURL(join(directory, 'module-federation.config.ts'));
  try {
    writeEffectTsgoPackage(directory);
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      assert.throws(
        () => resolveEffectTsgoCompiler({ from }),
        error => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Compiler backend lookup failed/u);
          assert.ok(error.cause instanceof Error);
          assert.ok('code' in error.cause);
          assert.equal(error.cause.code, 'ENOENT');
          assert.ok(error.message.includes(error.cause.message));
          return true;
        },
      );
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [name, mutation, expectedStage] of [
  [
    'native platform package name',
    (directory: string) => {
      const filename = join(
        directory,
        'node_modules',
        nativePlatformName,
        'package.json',
      );
      const manifest = JSON.parse(readFileSync(filename, 'utf8'));
      manifest.name = '@typescript/fake-platform';
      writeFileSync(filename, JSON.stringify(manifest));
    },
    'Native TypeScript package resolution',
  ],
  [
    'native platform version',
    (directory: string) => {
      writeNativePlatformPackage(
        join(directory, 'node_modules', nativePlatformName),
        '7.1.0',
      );
    },
    'Native TypeScript package resolution',
  ],
  [
    'native platform gitHead',
    (directory: string) => {
      const filename = join(
        directory,
        'node_modules',
        nativePlatformName,
        'package.json',
      );
      const manifest = JSON.parse(readFileSync(filename, 'utf8'));
      manifest.gitHead = 'f'.repeat(40);
      writeFileSync(filename, JSON.stringify(manifest));
    },
    'Native TypeScript package resolution',
  ],
  [
    'empty native artifact',
    (directory: string) => {
      writeFileSync(
        join(
          directory,
          'node_modules',
          nativePlatformName,
          'lib',
          compilerBasename,
        ),
        '',
      );
    },
    'Native TypeScript package resolution',
  ],
  [
    'Effect platform package name',
    (directory: string) => {
      const filename = join(
        directory,
        'node_modules',
        effectPlatformName,
        'package.json',
      );
      const manifest = JSON.parse(readFileSync(filename, 'utf8'));
      manifest.name = '@effect/fake-platform';
      writeFileSync(filename, JSON.stringify(manifest));
    },
    'Compiler backend lookup',
  ],
  [
    'Effect platform version',
    (directory: string) => {
      const filename = join(
        directory,
        'node_modules',
        effectPlatformName,
        'package.json',
      );
      const manifest = JSON.parse(readFileSync(filename, 'utf8'));
      manifest.version = '0.44.0';
      writeFileSync(filename, JSON.stringify(manifest));
    },
    'Compiler backend lookup',
  ],
  [
    'obsolete metadata schema',
    (directory: string) => {
      const metadata = JSON.parse(
        readFileSync(effectMetadataPath(directory), 'utf8'),
      );
      metadata.schemaVersion = 4;
      writeFileSync(effectMetadataPath(directory), JSON.stringify(metadata));
    },
    'Compiler backend lookup',
  ],
  [
    'replacement component gitHead',
    (directory: string) => {
      const metadata = JSON.parse(
        readFileSync(effectMetadataPath(directory), 'utf8'),
      );
      metadata.components.typescript[nativeVersion].gitHead = 'f'.repeat(40);
      writeFileSync(effectMetadataPath(directory), JSON.stringify(metadata));
    },
    'Compiler backend lookup',
  ],
  [
    'replacement component provider',
    (directory: string) => {
      const metadata = JSON.parse(
        readFileSync(effectMetadataPath(directory), 'utf8'),
      );
      metadata.components.typescript[nativeVersion].provider = 'typescript';
      writeFileSync(effectMetadataPath(directory), JSON.stringify(metadata));
    },
    'Compiler backend lookup',
  ],
  [
    'empty replacement artifact',
    (directory: string) => {
      writeFileSync(effectCompilerPath(directory), '');
    },
    'Compiler backend lookup',
  ],
  [
    'nonregular replacement artifact',
    (directory: string) => {
      rmSync(effectCompilerPath(directory));
      mkdirSync(effectCompilerPath(directory));
    },
    'Compiler backend lookup',
  ],
] as const) {
  test(`rejects ${name} without executing the provider CLI`, async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'app-tools-effect-tsgo-invalid-cohort-'),
    );
    try {
      writeEffectTsgoPackage(directory);
      writeCompiler(effectCompilerPath(directory), 0o700);
      mutation(directory);
      await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
        assert.throws(
          () =>
            resolveEffectTsgoCompiler({
              from: pathToFileURL(join(directory, 'modern.config.ts')),
            }),
          error => {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes(`${expectedStage} failed`));
            assert.ok(error.cause instanceof Error);
            return true;
          },
        );
        assert.equal(existsSync(join(directory, 'cli-started')), false);
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
