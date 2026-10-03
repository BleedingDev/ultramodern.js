import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
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

const PACKAGED_TYPESCRIPT_VERSION = '7.0.2';

function writePackageJson(
  directory: string,
  packageName: string,
  packageJson: Record<string, unknown>,
): string {
  const packageDirectory = join(directory, 'node_modules', packageName);
  mkdirSync(packageDirectory, { recursive: true });
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
      schemaVersion: 5,
      components: {
        typescript: {
          [PACKAGED_TYPESCRIPT_VERSION]: { gitHead: 'fixture' },
        },
      },
    }),
  );
  writePackageJson(directory, 'typescript', { version: '7.0.2' });
  writePackageJson(directory, `@typescript/typescript-${platformTarget}`, {
    version: PACKAGED_TYPESCRIPT_VERSION,
  });
  return join(
    platformDirectory,
    'artifacts/typescript',
    PACKAGED_TYPESCRIPT_VERSION,
    platformTarget.startsWith('win32-') ? 'tsc.exe' : 'tsc',
  );
  writeTypeScriptPackage(join(directory, 'node_modules/typescript'), '7.0.2');
}

function writeTypeScriptPackage(directory: string, version: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: 'typescript',
      version,
      exports: { './package.json': './package.json' },
    }),
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
  const temporaryRoot = join(directory, 'tmp');

  try {
    mkdirSync(temporaryRoot);
    const compilerPath = writeEffectTsgoPackage(directory);
    writeCompiler(compilerPath, 0o600);
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

  try {
    mkdirSync(temporaryRoot);
    const firstCompiler = writeEffectTsgoPackage(firstPackage);
    const secondCompiler = writeEffectTsgoPackage(secondPackage);
    writeCompiler(firstCompiler, 0o600);
    writeCompiler(secondCompiler, 0o600);

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

  try {
    const originCompilerPath = writeEffectTsgoPackage(originDirectory);
    const cwdCompilerPath = writeEffectTsgoPackage(workingDirectory);
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

test('runs discovery from the original selected native backend without changing the app cwd', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-backend-'),
  );
  const appDirectory = join(directory, 'app');
  const stagingDirectory = join(directory, 'empty-stage');
  const nativeDirectory = join(directory, 'selected-native');
  const compilerPath = join(directory, 'compiler');
  const cwdRecord = join(directory, 'discovery-cwd');
  try {
    mkdirSync(stagingDirectory);
    writeEffectTsgoPackage(appDirectory, compilerPath);
    writeTypeScriptPackage(
      join(appDirectory, 'node_modules/typescript'),
      '5.9.3',
    );
    writeTypeScriptPackage(nativeDirectory, '7.0.2');
    mkdirSync(join(appDirectory, 'node_modules/@typescript'), {
      recursive: true,
    });
    symlinkSync(
      nativeDirectory,
      join(appDirectory, 'node_modules/@typescript/native'),
      'dir',
    );
    writeCompiler(compilerPath, 0o700);
    writeFileSync(
      join(appDirectory, 'node_modules/@effect/tsgo/bin/effect-tsgo.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(cwdRecord)}, process.cwd());\nconsole.log(${JSON.stringify(compilerPath)});\n`,
    );
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
        assert.equal(
          realpathSync(readFileSync(cwdRecord, 'utf-8')),
          realpathSync(nativeDirectory),
        );
        assert.equal(process.cwd(), realpathSync(stagingDirectory));
      });
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
    writeEffectTsgoPackage(directory, join(directory, 'compiler'));
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

test('rejects a provider with no installed native backend before starting its CLI', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-no-backend-'),
  );
  try {
    writeEffectTsgoPackage(directory, join(directory, 'compiler'));
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
  const compilerPath = join(directory, 'compiler');
  const from = pathToFileURL(join(directory, 'modern.config.ts'));
  try {
    writeEffectTsgoPackage(directory, compilerPath);
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

test('executes the actual declared generator Effect provider from an empty staging cwd', async () => {
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
      '@typescript/native/package.json',
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
    const cliPath = join(
      dirname(effectManifestPath),
      effectManifest.bin['effect-tsgo'],
    );
    const expectedCompiler = execFileSync(
      process.execPath,
      [cliPath, 'get-exe-path'],
      {
        cwd: dirname(nativeManifestPath),
        encoding: 'utf-8',
      },
    ).trim();
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      withWorkingDirectory(directory, () => {
        const compiler = resolveEffectTsgoCompiler({
          from: pathToFileURL(
            join(generatorDirectory, 'module-federation.config.ts'),
          ),
        });
        assert.equal(realpathSync(compiler), realpathSync(expectedCompiler));
        assert.equal(
          execFileSync(compiler, ['--version'], { encoding: 'utf-8' }).trim(),
          `Version ${nativeManifest.version}+effect-tsgo.${effectManifest.version}`,
        );
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
    writeEffectTsgoPackage(directory, join(directory, 'compiler'));
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

test('retains the actual failed Effect CLI process and requesting config origin', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-cli-failure-'),
  );
  const from = pathToFileURL(join(directory, 'module-federation.config.ts'));
  try {
    writeEffectTsgoPackage(directory, join(directory, 'native/unused'));
    writeFileSync(
      join(directory, 'node_modules/@effect/tsgo/bin/effect-tsgo.js'),
      "process.stderr.write('Effect backend unavailable\\n'); process.exit(17);\n",
    );
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      assert.throws(
        () => resolveEffectTsgoCompiler({ from }),
        error => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Compiler backend lookup failed/u);
          assert.ok(error.message.includes(from.href));
          assert.match(error.message, /Effect backend unavailable/u);
          assert.ok(error.cause instanceof Error);
          assert.ok('status' in error.cause);
          assert.equal(error.cause.status, 17);
          return true;
        },
      );
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('distinguishes a resolved missing executable from provider package resolution', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-executable-failure-'),
  );
  const from = pathToFileURL(join(directory, 'module-federation.config.ts'));
  try {
    writeEffectTsgoPackage(directory, join(directory, 'native/missing'));
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      assert.throws(
        () => resolveEffectTsgoCompiler({ from }),
        error => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Compiler executable validation failed/u);
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
