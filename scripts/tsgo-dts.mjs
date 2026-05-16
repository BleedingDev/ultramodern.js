import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function run(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(
      output || `${command} ${args.join(' ')} exited ${result.status}`,
    );
  }
  return result.stdout;
}

function readResolvedConfig(cwd, tsconfigPath) {
  const output = run('tsgo', ['--showConfig', '-p', tsconfigPath], {
    cwd,
  });
  return JSON.parse(output);
}

function normalizeCompilerOptions(options) {
  const compilerOptions = {
    ...options,
    declaration: true,
    declarationMap: false,
    emitDeclarationOnly: true,
    noCheck: true,
    noEmit: false,
    noEmitOnError: false,
    outDir: './dist/types',
  };

  delete compilerOptions.baseUrl;

  if (
    compilerOptions.moduleResolution === 'node' ||
    compilerOptions.moduleResolution === 'node10'
  ) {
    delete compilerOptions.moduleResolution;
  }

  return compilerOptions;
}

export function generateTsgoDeclarations({
  cwd = process.cwd(),
  tsconfig = 'tsconfig.json',
} = {}) {
  const root = resolve(cwd);
  const tsconfigPath = resolve(root, tsconfig);
  const srcDir = join(root, 'src');

  if (!existsSync(tsconfigPath) || !existsSync(srcDir)) {
    return;
  }

  const resolvedConfig = readResolvedConfig(root, tsconfigPath);
  const tempConfigPath = join(
    root,
    `.tsgo-dts.${process.pid}.${Date.now()}.json`,
  );

  const config = {
    compilerOptions: normalizeCompilerOptions(
      resolvedConfig.compilerOptions ?? {},
    ),
    files: resolvedConfig.files,
    include: resolvedConfig.files
      ? undefined
      : (resolvedConfig.include ?? ['src']),
    exclude: resolvedConfig.exclude,
  };

  try {
    writeFileSync(tempConfigPath, JSON.stringify(config, null, 2));
    run('tsgo', ['-p', tempConfigPath], {
      cwd: root,
      stdio: 'pipe',
    });
  } finally {
    rmSync(tempConfigPath, { force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateTsgoDeclarations({
    cwd: process.argv[2] ? resolve(process.argv[2]) : process.cwd(),
    tsconfig: process.argv[3] ?? 'tsconfig.json',
  });
}
