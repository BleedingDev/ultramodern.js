import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwdTokens = new Set(['$PWD', '$' + '{PWD}', '%cd%', '%CD%']);

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

export function resolveTsgoInvocation({
  env = process.env,
  platform = process.platform,
} = {}) {
  const command = env.TSGO_BIN || (platform === 'win32' ? 'tsgo.cmd' : 'tsgo');
  return {
    command,
    shell: platform === 'win32' && /\.(?:bat|cmd)$/iu.test(command),
  };
}

function runTsgo(args, options) {
  const invocation = resolveTsgoInvocation();
  return run(invocation.command, args, {
    ...options,
    shell: invocation.shell,
  });
}

function readResolvedConfig(cwd, tsconfigPath) {
  const output = runTsgo(['--showConfig', '-p', tsconfigPath], {
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
  requireProject = false,
} = {}) {
  const root = resolve(cwd);
  const tsconfigPath = resolve(root, tsconfig);
  const srcDir = join(root, 'src');

  if (!existsSync(tsconfigPath) || !existsSync(srcDir)) {
    if (requireProject) {
      throw new Error(
        `Cannot generate TS-Go declarations for ${root}: expected ${tsconfigPath} and ${srcDir} to exist.`,
      );
    }
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
    runTsgo(['-p', tempConfigPath], {
      cwd: root,
      stdio: 'pipe',
    });
  } finally {
    rmSync(tempConfigPath, { force: true });
  }
}

export function isMainModule({
  argv = process.argv,
  moduleUrl = import.meta.url,
  resolvePath = resolve,
  urlToPath = fileURLToPath,
} = {}) {
  return argv[1] !== undefined && resolvePath(argv[1]) === urlToPath(moduleUrl);
}

export function resolveCliCwdArg({
  arg,
  env = process.env,
  cwd = process.cwd(),
  resolvePath = resolve,
} = {}) {
  if (!arg) {
    return resolvePath(cwd);
  }
  if (cwdTokens.has(arg)) {
    return resolvePath(env.INIT_CWD || env.PWD || cwd);
  }
  return resolvePath(arg);
}

if (isMainModule()) {
  const cwdArg = process.argv[2];
  generateTsgoDeclarations({
    cwd: resolveCliCwdArg({ arg: cwdArg }),
    tsconfig: process.argv[3] ?? 'tsconfig.json',
    requireProject: Boolean(cwdArg),
  });
}
