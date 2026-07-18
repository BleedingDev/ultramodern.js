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
import type { Rspack } from '@rsbuild/core';
import {
  getBuildConfigEnvironment,
  resolveEffectTsgoCompiler,
  withBuildConfigEnvironment,
} from '../../src/config/public';

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

function createTestCompiler(options?: { omit?: LifecycleHookName }) {
  const handlers = Object.fromEntries(
    LIFECYCLE_HOOK_NAMES.map(name => [name, [] as Array<() => void>]),
  ) as Record<LifecycleHookName, Array<() => void>>;
  const hooks = Object.fromEntries(
    LIFECYCLE_HOOK_NAMES.filter(name => name !== options?.omit).map(name => [
      name,
      {
        tap: (
          _options: { name: string; stage: number },
          handler: () => void,
        ) => {
          handlers[name].push(handler);
        },
      },
    ]),
  );
  const compiler = {
    hooks,
    watchMode: false,
  } as unknown as Rspack.Compiler;

  return {
    compiler,
    handlers,
    call(name: LifecycleHookName) {
      if (name === 'run') {
        compiler.watchMode = false;
      } else if (name === 'watchRun') {
        compiler.watchMode = true;
      } else if (name === 'watchClose') {
        compiler.watchMode = false;
      }

      for (const handler of handlers[name]) {
        handler();
      }
    },
  };
}

function getLeasePlugin(config: TestRspackConfig): Rspack.RspackPluginInstance {
  const plugin = config.plugins?.at(-1);
  assert.ok(plugin && typeof plugin === 'object' && 'apply' in plugin);
  return plugin as Rspack.RspackPluginInstance;
}

test('reads framework-owned build configuration environment', async () => {
  await withEnvironment('ULTRAMODERN_CONFIG_API_TEST', 'configured', () => {
    assert.equal(
      getBuildConfigEnvironment('ULTRAMODERN_CONFIG_API_TEST'),
      'configured',
    );
  });
});

test('reference-counts overlapping leases for the same value', async () => {
  const name = 'ULTRAMODERN_CONFIG_SAME_VALUE_LEASE_TEST';

  await withEnvironment(name, 'original', async () => {
    const firstConfig = await withBuildConfigEnvironment(
      name,
      'leased',
      (config: TestRspackConfig) => config,
    )({ plugins: [] });
    const secondConfig = await withBuildConfigEnvironment(
      name,
      'leased',
      (config: TestRspackConfig) => config,
    )({ plugins: [] });

    assert.equal(process.env[name], 'leased');

    const firstCompiler = createTestCompiler();
    const secondCompiler = createTestCompiler();
    getLeasePlugin(firstConfig).apply(firstCompiler.compiler);
    getLeasePlugin(secondConfig).apply(secondCompiler.compiler);

    firstCompiler.call('run');
    firstCompiler.call('afterDone');
    assert.equal(process.env[name], 'leased');

    secondCompiler.call('run');
    secondCompiler.call('failed');
    assert.equal(process.env[name], 'original');
  });
});

test('rejects overlapping leases for conflicting values', async () => {
  const name = 'ULTRAMODERN_CONFIG_CONFLICTING_LEASE_TEST';

  await withEnvironment(name, 'original', async () => {
    const ownerConfig = await withBuildConfigEnvironment(
      name,
      'owner',
      (config: TestRspackConfig) => config,
    )({ plugins: [] });
    let conflictingSetupCalled = false;

    await assert.rejects(
      withBuildConfigEnvironment(
        name,
        'conflict',
        (config: TestRspackConfig) => {
          conflictingSetupCalled = true;
          return config;
        },
      )({ plugins: [] }),
      /already has an active lease for a different value/u,
    );
    assert.equal(conflictingSetupCalled, false);
    assert.equal(process.env[name], 'owner');

    const compiler = createTestCompiler();
    getLeasePlugin(ownerConfig).apply(compiler.compiler);
    compiler.call('failed');
    assert.equal(process.env[name], 'original');
  });
});

test('keeps a one-shot lease through done and restores after afterDone', async () => {
  const name = 'ULTRAMODERN_CONFIG_AFTER_DONE_LEASE_TEST';

  await withEnvironment(name, 'original', async () => {
    const config = await withBuildConfigEnvironment(
      name,
      'leased',
      (rspackConfig: TestRspackConfig) => rspackConfig,
    )({ plugins: [] });
    const compiler = createTestCompiler();

    getLeasePlugin(config).apply(compiler.compiler);
    compiler.call('run');
    compiler.call('done');
    assert.equal(process.env[name], 'leased');

    compiler.call('afterDone');
    assert.equal(process.env[name], 'original');
  });
});

test('restores a failed one-shot lease', async () => {
  const name = 'ULTRAMODERN_CONFIG_FAILED_LEASE_TEST';

  await withEnvironment(name, 'original', async () => {
    const config = await withBuildConfigEnvironment(
      name,
      'leased',
      (rspackConfig: TestRspackConfig) => rspackConfig,
    )({ plugins: [] });
    const compiler = createTestCompiler();

    getLeasePlugin(config).apply(compiler.compiler);
    compiler.call('run');
    compiler.call('failed');
    assert.equal(process.env[name], 'original');
  });
});

test('retains a watch lease across rebuild completion and failure', async () => {
  const name = 'ULTRAMODERN_CONFIG_WATCH_LEASE_TEST';

  await withEnvironment(name, 'original', async () => {
    const config = await withBuildConfigEnvironment(
      name,
      'leased',
      (rspackConfig: TestRspackConfig) => rspackConfig,
    )({ plugins: [] });
    const compiler = createTestCompiler();

    getLeasePlugin(config).apply(compiler.compiler);
    compiler.call('watchRun');
    compiler.call('done');
    compiler.call('afterDone');
    compiler.call('failed');
    assert.equal(process.env[name], 'leased');

    compiler.call('watchClose');
    assert.equal(process.env[name], 'original');
  });
});

test('restores a watch lease during compiler shutdown', async () => {
  const name = 'ULTRAMODERN_CONFIG_SHUTDOWN_LEASE_TEST';

  await withEnvironment(name, 'original', async () => {
    const config = await withBuildConfigEnvironment(
      name,
      'leased',
      (rspackConfig: TestRspackConfig) => rspackConfig,
    )({ plugins: [] });
    const compiler = createTestCompiler();

    getLeasePlugin(config).apply(compiler.compiler);
    compiler.call('watchRun');
    compiler.call('shutdown');
    assert.equal(process.env[name], 'original');
  });
});

test('restores the lease when setup throws or rejects', async () => {
  const name = 'ULTRAMODERN_CONFIG_THROWN_SETUP_TEST';

  await withEnvironment(name, 'original', async () => {
    const thrownError = new Error('synchronous setup failure');
    await assert.rejects(
      withBuildConfigEnvironment(
        name,
        'leased',
        (_config: TestRspackConfig) => {
          throw thrownError;
        },
      )({ plugins: [] }),
      error => error === thrownError,
    );
    assert.equal(process.env[name], 'original');

    const rejectedError = new Error('asynchronous setup failure');
    await assert.rejects(
      withBuildConfigEnvironment(
        name,
        'leased',
        async (_config: TestRspackConfig) => {
          throw rejectedError;
        },
      )({ plugins: [] }),
      error => error === rejectedError,
    );
    assert.equal(process.env[name], 'original');
  });
});

test('fails closed when a required terminal hook is unavailable', async () => {
  const name = 'ULTRAMODERN_CONFIG_MISSING_HOOK_TEST';

  await withEnvironment(name, 'original', async () => {
    const config = await withBuildConfigEnvironment(
      name,
      'leased',
      (rspackConfig: TestRspackConfig) => rspackConfig,
    )({ plugins: [] });
    const compiler = createTestCompiler({ omit: 'shutdown' });

    assert.throws(
      () => getLeasePlugin(config).apply(compiler.compiler),
      /does not expose the "shutdown" lifecycle hook/u,
    );
    assert.equal(process.env[name], 'original');
  });
});

test('fails closed and restores the original value after ownership drift', async () => {
  const name = 'ULTRAMODERN_CONFIG_OWNERSHIP_DRIFT_TEST';

  await withEnvironment(name, 'original', async () => {
    const config = await withBuildConfigEnvironment(
      name,
      'leased',
      (rspackConfig: TestRspackConfig) => rspackConfig,
    )({ plugins: [] });
    const compiler = createTestCompiler();
    getLeasePlugin(config).apply(compiler.compiler);

    process.env[name] = 'unowned';
    assert.throws(
      () => compiler.call('failed'),
      /lost ownership before restoration/u,
    );
    assert.equal(process.env[name], 'original');
  });
});

test('prefers an explicit Effect TS-Go compiler path', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'app-tools-effect-tsgo-bin-'));
  const compilerPath = join(directory, 'effect-tsgo');

  try {
    writeCompiler(compilerPath, 0o700);
    await withEnvironment('EFFECT_TSGO_BIN', `  ${compilerPath}  `, () => {
      assert.equal(
        resolveEffectTsgoCompiler({ from: import.meta.url }),
        compilerPath,
      );
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('materializes a private executable without mutating the package binary', async () => {
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

        assert.notEqual(firstResolution, compilerPath);
        assert.equal(secondResolution, firstResolution);
        assert.equal(
          readFileSync(firstResolution, 'utf-8'),
          readFileSync(compilerPath, 'utf-8'),
        );
        accessSync(firstResolution, constants.X_OK);
        assert.throws(() => accessSync(compilerPath, constants.X_OK));
        assert.equal(
          execFileSync(firstResolution, { encoding: 'utf-8' }).trim(),
          'fixture compiler',
        );
      }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reuses one executable for identical Effect TS-Go package binaries', async () => {
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

        assert.equal(secondResolution, firstResolution);
        accessSync(firstResolution, constants.X_OK);
      }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
