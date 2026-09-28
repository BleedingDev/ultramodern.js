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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function withSimulatedLinuxMusl<T>(action: () => T): Promise<T> {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const arch = Object.getOwnPropertyDescriptor(process, 'arch');
  const getReport = process.report.getReport;
  assert.ok(platform && arch);

  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    Object.defineProperty(process, 'arch', { value: 'x64' });
    // musl Node reports no glibc runtime, which is what Oxlint discovery checks.
    process.report.getReport = (...args) => {
      const report = getReport.apply(process.report, args) as {
        header: Record<string, unknown>;
      };
      delete report.header.glibcVersionRuntime;
      return report;
    };
    return await action();
  } finally {
    Object.defineProperty(process, 'platform', platform);
    Object.defineProperty(process, 'arch', arch);
    process.report.getReport = getReport;
  }
}

test('resolves the packaged TypeScript compiler on Linux musl with Oxlint installed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'app-tools-effect-tsgo-musl-'));

  try {
    const compilerPath = writeEffectTsgoPackage(directory, 'linux-x64');
    writeCompiler(compilerPath, 0o700);
    // Oxlint without a musl binding is what made `effect-tsgo get-exe-path`
    // fail with "Linux musl is not supported by the packaged Oxlint integration".
    writePackageJson(directory, 'oxlint', { version: '1.85.0' });
    writePackageJson(directory, 'oxlint-tsgolint', { version: '7.0.2003' });

    await withEnvironment('EFFECT_TSGO_BIN', undefined, () =>
      withSimulatedLinuxMusl(() => {
        assert.equal(
          (
            process.report.getReport() as {
              header: Record<string, unknown>;
            }
          ).header.glibcVersionRuntime,
          undefined,
        );
        assert.equal(
          realpathSync(
            resolveEffectTsgoCompiler({
              from: pathToFileURL(join(directory, 'modern.config.ts')),
            }),
          ),
          realpathSync(compilerPath),
        );
      }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a native TypeScript version without a packaged Effect compiler', async () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'app-tools-effect-tsgo-unpackaged-'),
  );

  try {
    const compilerPath = writeEffectTsgoPackage(directory);
    writeCompiler(compilerPath, 0o700);
    writePackageJson(
      directory,
      `@typescript/typescript-${process.platform}-${process.arch}`,
      { version: '7.9.9' },
    );

    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      assert.throws(
        () =>
          resolveEffectTsgoCompiler({
            from: pathToFileURL(join(directory, 'modern.config.ts')),
          }),
        /Unable to resolve the Effect TS-Go compiler/u,
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
        /Install "@effect\/tsgo" and a native TypeScript backend for this build config, or set EFFECT_TSGO_BIN/u,
      );
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
