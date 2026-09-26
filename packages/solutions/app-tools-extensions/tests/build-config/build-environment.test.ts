import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

function writeEffectTsgoPackage(directory: string, compilerPath: string): void {
  const packageDirectory = join(directory, 'node_modules/@effect/tsgo');
  mkdirSync(join(packageDirectory, 'bin'), { recursive: true });
  writeFileSync(
    join(packageDirectory, 'package.json'),
    JSON.stringify({
      name: '@effect/tsgo',
      bin: { 'effect-tsgo': './bin/effect-tsgo.js' },
    }),
  );
  writeFileSync(
    join(packageDirectory, 'bin/effect-tsgo.js'),
    `if (process.argv[2] !== 'get-exe-path') process.exit(1);\nconsole.log(${JSON.stringify(compilerPath)});\n`,
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
  const compilerPath = join(directory, 'native/effect-tsgo');
  const temporaryRoot = join(directory, 'tmp');

  try {
    mkdirSync(temporaryRoot);
    writeCompiler(compilerPath, 0o600);
    writeEffectTsgoPackage(directory, compilerPath);
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
  const firstCompiler = join(firstPackage, 'native/effect-tsgo');
  const secondCompiler = join(secondPackage, 'native/effect-tsgo');

  try {
    mkdirSync(temporaryRoot);
    writeCompiler(firstCompiler, 0o600);
    writeCompiler(secondCompiler, 0o600);
    writeEffectTsgoPackage(firstPackage, firstCompiler);
    writeEffectTsgoPackage(secondPackage, secondCompiler);

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
  const originCompilerPath = join(originDirectory, 'bin/origin-tsgo');
  const cwdCompilerPath = join(workingDirectory, 'bin/cwd-tsgo');

  try {
    writeEffectTsgoPackage(originDirectory, originCompilerPath);
    writeEffectTsgoPackage(workingDirectory, cwdCompilerPath);
    writeCompiler(originCompilerPath, 0o700);
    writeCompiler(cwdCompilerPath, 0o700);
    await withEnvironment('EFFECT_TSGO_BIN', undefined, () => {
      withWorkingDirectory(workingDirectory, () => {
        assert.equal(
          resolveEffectTsgoCompiler({
            from: pathToFileURL(join(originDirectory, 'modern.config.ts')),
          }),
          originCompilerPath,
        );
      });
    });
  } finally {
    rmSync(originDirectory, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
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
