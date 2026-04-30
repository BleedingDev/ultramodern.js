const crypto = require('node:crypto');
const path = require('path');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const spawn = require('cross-spawn');
const treeKill = require('tree-kill');
const { launchOptions } = require('./launchOptions');

const kRepoRoot = path.join(__dirname, '../..');
const kTestsRoot = path.join(__dirname, '..');
const kModernAppTools = path.join(
  __dirname,
  '../node_modules/@modern-js/app-tools/bin/modern.js',
);
const kWorkspacePackageBuilds = new Map();
const kWorkspaceSearchRoots = [
  path.join(kRepoRoot, 'packages'),
  path.join(kRepoRoot, 'tests'),
];
const kWorkspacePackageLockPollInterval = 200;
const kWorkspacePackageLockStaleAge = 10 * 60 * 1000;

function resolveWorkspacePackageBuildLockDir(packageDir) {
  const digest = crypto
    .createHash('sha1')
    .update(path.resolve(packageDir))
    .digest('hex');

  return path.join(os.tmpdir(), `modernjs-workspace-package-${digest}.lock`);
}

async function acquireWorkspacePackageBuildLock(packageDir) {
  const lockDir = resolveWorkspacePackageBuildLockDir(packageDir);

  while (true) {
    try {
      await fs.promises.mkdir(lockDir);
      await fs.promises.writeFile(
        path.join(lockDir, 'owner.json'),
        JSON.stringify({
          pid: process.pid,
          packageDir: path.resolve(packageDir),
          acquiredAt: new Date().toISOString(),
        }),
      );

      return async () => {
        await fs.promises.rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      try {
        const stat = await fs.promises.stat(lockDir);
        if (Date.now() - stat.mtimeMs > kWorkspacePackageLockStaleAge) {
          await fs.promises.rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }

      await new Promise(resolve =>
        setTimeout(resolve, kWorkspacePackageLockPollInterval),
      );
    }
  }
}

function getNewestModifiedAt(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  let newestModifiedAt = stat.mtimeMs;
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'dist' || entry.name === 'node_modules') {
      continue;
    }

    const entryPath = path.join(targetPath, entry.name);
    newestModifiedAt = Math.max(
      newestModifiedAt,
      getNewestModifiedAt(entryPath),
    );
  }

  return newestModifiedAt;
}

function resolveWorkspacePackageInfo(packageName) {
  try {
    const resolvedEntryPath = require.resolve(packageName, {
      paths: [kTestsRoot],
    });
    let packageDir = fs.realpathSync(path.dirname(resolvedEntryPath));
    let packageJsonPath = path.join(packageDir, 'package.json');

    while (!fs.existsSync(packageJsonPath)) {
      const parentDir = path.dirname(packageDir);
      if (parentDir === packageDir) {
        throw new Error(`Failed to locate package.json for ${packageName}`);
      }
      packageDir = parentDir;
      packageJsonPath = path.join(packageDir, 'package.json');
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    return {
      packageDir,
      packageJson,
    };
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }

  for (const searchRoot of kWorkspaceSearchRoots) {
    const found = findWorkspacePackageInfo(packageName, searchRoot);
    if (found) {
      return found;
    }
  }

  throw new Error(`Failed to resolve workspace package ${packageName}`);
}

function findWorkspacePackageInfo(packageName, currentDir) {
  if (!fs.existsSync(currentDir)) {
    return null;
  }

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name.startsWith('.')
    ) {
      continue;
    }

    const entryPath = path.join(currentDir, entry.name);
    const packageJsonPath = path.join(entryPath, 'package.json');

    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.name === packageName) {
        return {
          packageDir: entryPath,
          packageJson,
        };
      }
    }

    const nested = findWorkspacePackageInfo(packageName, entryPath);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function resolvePackageDistEntry(packageDir, packageJson) {
  if (packageJson.main) {
    return path.join(packageDir, packageJson.main);
  }

  const rootExport = packageJson.exports?.['.'];
  if (typeof rootExport === 'string') {
    return path.join(packageDir, rootExport);
  }
  if (rootExport?.node?.require) {
    return path.join(packageDir, rootExport.node.require);
  }
  if (rootExport?.default) {
    return path.join(packageDir, rootExport.default);
  }

  return path.join(packageDir, 'dist/cjs/index.js');
}

function collectExportDistEntries(packageDir, exportValue, entries) {
  if (typeof exportValue === 'string') {
    if (exportValue.startsWith('./dist/') && !exportValue.includes('/types/')) {
      entries.push(path.join(packageDir, exportValue));
    }
    return;
  }

  if (!exportValue || typeof exportValue !== 'object') {
    return;
  }

  for (const [condition, conditionValue] of Object.entries(exportValue)) {
    if (condition === 'types') {
      continue;
    }
    collectExportDistEntries(packageDir, conditionValue, entries);
  }
}

function resolveRequiredPackageDistEntries(packageDir, packageJson) {
  const entries = [];
  collectExportDistEntries(packageDir, packageJson.exports, entries);

  return [...new Set(entries)];
}

function shouldRefreshWorkspacePackageBuild(packageDir, packageJson) {
  if (!packageDir.includes(`${path.sep}packages${path.sep}`)) {
    return false;
  }

  const distEntry = resolvePackageDistEntry(packageDir, packageJson);
  if (!fs.existsSync(distEntry)) {
    return true;
  }

  const requiredDistEntries = resolveRequiredPackageDistEntries(
    packageDir,
    packageJson,
  );
  if (requiredDistEntries.some(entry => !fs.existsSync(entry))) {
    return true;
  }

  const watchedEntries = [
    'src',
    'bin',
    'package.json',
    'tsconfig.json',
    'rslib.config.ts',
    'rslib.config.js',
  ];

  const newestSourceModifiedAt = watchedEntries.reduce((latest, entry) => {
    return Math.max(latest, getNewestModifiedAt(path.join(packageDir, entry)));
  }, 0);

  return fs.statSync(distEntry).mtimeMs < newestSourceModifiedAt;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const instance = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    instance.stdout.on('data', chunk => {
      stdout += chunk;
      if (options.stdout) {
        process.stdout.write(chunk);
      }
    });

    instance.stderr.on('data', chunk => {
      stderr += chunk;
      if (options.stderr) {
        process.stderr.write(chunk);
      }
    });

    instance.on('error', error => {
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    instance.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      const message = detail
        ? `${command} ${args.join(' ')} failed with code ${code}.\n${detail}`
        : `${command} ${args.join(' ')} failed with code ${code}.`;
      const error = new Error(message);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function ensureWorkspacePackageBuilt(packageName) {
  if (!kWorkspacePackageBuilds.has(packageName)) {
    const buildPromise = (async () => {
      const { packageDir, packageJson } =
        resolveWorkspacePackageInfo(packageName);
      const releaseBuildLock =
        await acquireWorkspacePackageBuildLock(packageDir);

      try {
        if (!shouldRefreshWorkspacePackageBuild(packageDir, packageJson)) {
          return;
        }

        await runProcess('pnpm', ['--dir', packageDir, 'run', 'build'], {
          cwd: kRepoRoot,
        });
      } finally {
        await releaseBuildLock();
      }
    })();

    kWorkspacePackageBuilds.set(packageName, buildPromise);
  }

  return kWorkspacePackageBuilds.get(packageName);
}

async function ensureWorkspacePackagesBuilt(packageNames = []) {
  for (const packageName of packageNames) {
    await ensureWorkspacePackageBuilt(packageName);
  }
}

function runModernCommand(argv, options = {}) {
  const { cwd, rejectOnCompileError = true } = options;
  const cmd = argv[0];
  const env = {
    ...process.env,
    ...options.env,
  };

  return new Promise((resolve, reject) => {
    const launch = async () => {
      await ensureWorkspacePackagesBuilt(options.ensureWorkspacePackages);

      const instance = spawn(process.execPath, [kModernAppTools, ...argv], {
        ...options.spawnOptions,
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      if (typeof options.instance === 'function') {
        options.instance(instance);
      }

      let stderrOutput = '';
      instance.stderr.on('data', chunk => {
        stderrOutput += chunk;
      });

      let stdoutOutput = '';
      instance.stdout.on('data', async chunk => {
        let { marker } = options;
        if (cmd === 'deploy') {
          marker = /end deploy!/i;
        }
        stdoutOutput += chunk;
        const message = chunk.toString();

        const compileErrorMarker = /Compile error/i;

        if (
          cmd === 'build' &&
          rejectOnCompileError &&
          compileErrorMarker.test(message)
        ) {
          reject(new Error(message));
        }

        if (marker?.test(stdoutOutput)) {
          resolve({
            code: 0,
            stdout: stdoutOutput,
          });
          await killApp(instance);
        }
      });

      instance.on('close', code => {
        resolve({
          code,
          stdout: stdoutOutput,
          stderr: stderrOutput,
        });
      });

      instance.on('error', err => {
        err.stdout = stdoutOutput;
        err.stderr = stderrOutput;
        reject(err);
      });
    };

    launch().catch(reject);
  });
}

function runModernCommandDev(argv, stdOut, options = {}) {
  const { cwd, rejectOnCompileError = true } = options;
  const env = {
    ...process.env,
    ...options.env,
  };

  return new Promise((resolve, reject) => {
    const launch = async () => {
      await ensureWorkspacePackagesBuilt(options.ensureWorkspacePackages);

      const instance = spawn(process.execPath, [kModernAppTools, ...argv], {
        cwd,
        env,
      });

      let didResolve = false;
      let stdoutOutput = '';
      let stderrOutput = '';

      function handleStdout(data) {
        const message = data.toString();
        stdoutOutput += message;
        const bootupMarkers = {
          dev: /> Local:/i,
          serve: /> Local:/i,
        };
        const compileErrorMarker = /Compile error/i;

        if (rejectOnCompileError && compileErrorMarker.test(message)) {
          if (!didResolve) {
            didResolve = true;
            reject(new Error(message));
          }
        }

        if (
          bootupMarkers[options.modernServe ? 'serve' : 'dev'].test(message)
        ) {
          if (!didResolve) {
            didResolve = true;
            resolve(stdOut ? message : instance);
          }
        }

        if (typeof options.onStdout === 'function') {
          options.onStdout(message);
        }

        if (stdOut !== false && options.stdout !== false) {
          process.stdout.write(message);
        }
      }

      instance.stdout.on('data', handleStdout);
      instance.stderr.on('data', data => {
        const message = data.toString();
        stderrOutput += message;

        if (typeof options.onStderr === 'function') {
          options.onStderr(message);
        }

        const compileErrorMarker = /Compile error/i;
        if (rejectOnCompileError && compileErrorMarker.test(message)) {
          if (!didResolve) {
            didResolve = true;
            const error = new Error(message);
            error.stdout = stdoutOutput;
            error.stderr = stderrOutput;
            reject(error);
          }
        }

        if (options.stderr !== false) {
          process.stderr.write(message);
        }
      });

      instance.on('error', error => {
        error.stdout = stdoutOutput;
        error.stderr = stderrOutput;
        reject(error);
      });

      instance.on('close', code => {
        instance.stdout.removeListener('data', handleStdout);
        if (!didResolve) {
          const phase = options.modernServe ? 'serve' : 'dev';
          const output = [stdoutOutput.trim(), stderrOutput.trim()]
            .filter(Boolean)
            .join('\n');
          const detail = output ? `\n${output}` : '';
          const exitCode = code === null ? 'unknown' : String(code);
          const error = new Error(
            `modern ${phase} exited before readiness marker with code ${exitCode}.${detail}`,
          );
          error.stdout = stdoutOutput;
          error.stderr = stderrOutput;
          didResolve = true;
          reject(error);
        }
      });
    };

    launch().catch(reject);
  });
}

function runContinuousTask(argv, stdOut, options = {}) {
  const env = {
    ...process.env,
    ...options.env,
  };
  const command = options.command || process.execPath;
  const waitMessage = options.waitMessage;

  return new Promise((resolve, reject) => {
    const instance = spawn(command, argv, {
      cwd: options.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let didResolve = false;
    let stdoutOutput = '';
    let stderrOutput = '';

    const tryResolve = message => {
      if (didResolve || !waitMessage) {
        return;
      }

      if (waitMessage.test(message)) {
        didResolve = true;
        resolve(stdOut ? message : instance);
      }
    };

    instance.stdout.on('data', data => {
      const message = data.toString();
      stdoutOutput += message;
      tryResolve(stdoutOutput);

      if (stdOut !== false && options.stdout !== false) {
        process.stdout.write(message);
      }
    });

    instance.stderr.on('data', data => {
      const message = data.toString();
      stderrOutput += message;
      tryResolve(stderrOutput);

      if (options.stderr !== false) {
        process.stderr.write(message);
      }
    });

    instance.on('error', error => {
      error.stdout = stdoutOutput;
      error.stderr = stderrOutput;
      reject(error);
    });

    instance.on('close', code => {
      if (!didResolve) {
        const output = [stdoutOutput.trim(), stderrOutput.trim()]
          .filter(Boolean)
          .join('\n');
        const detail = output ? `\n${output}` : '';
        const exitCode = code === null ? 'unknown' : String(code);
        const error = new Error(
          `Process exited before readiness marker with code ${exitCode}.${detail}`,
        );
        error.stdout = stdoutOutput;
        error.stderr = stderrOutput;
        didResolve = true;
        reject(error);
      }
    });
  });
}

function modernBuild(dir, args = [], opts = {}) {
  return runModernCommand(['build', ...args], {
    cwd: dir,
    stdout: true,
    stderr: true,
    ...opts,
    env: {
      NODE_ENV: 'production',
      ...(opts.env || {}),
    },
  });
}

function modernDeploy(dir, mode = '', opts = {}) {
  return runModernCommand(['deploy', `--dir=${dir}`, `--mode=${mode}`], {
    ...opts,
    stdout: true,
    cwd: dir,
    env: {
      NODE_ENV: 'production',
      BUILD_PATH: '',
    },
    cmd: 'deploy',
  });
}

function launchApp(dir, port, opts = {}, env = {}) {
  return runModernCommandDev(['dev'], undefined, {
    ...opts,
    cwd: dir,
    env: {
      PORT: port,
      NODE_ENV: 'development',
      ...env,
      ...(opts.env || {}),
    },
  });
}

function modernServe(dir, port, opts = {}) {
  return runModernCommandDev(['serve'], undefined, {
    ...opts,
    cwd: dir,
    env: {
      PORT: port,
      NODE_ENV: 'production',
      ...(opts.env || {}),
    },
    modernServe: true,
  });
}

async function killApp(instance) {
  await new Promise((resolve, reject) => {
    if (!instance) {
      return resolve();
    }

    const startedAt = Date.now();

    treeKill(instance.pid, err => {
      if (err) {
        if (
          process.platform === 'win32' &&
          typeof err.message === 'string' &&
          (err.message.includes(`Access is denied`) ||
            err.message.includes(`no running instance of the task`) ||
            err.message.includes(`not found`) ||
            err.message.includes(`operation attempted is not supported`))
        ) {
          // Windows can report transient taskkill errors after the app exits.
          //
          // Command failed: taskkill /pid 6924 /T /F
          // ERROR: The process with PID 6924 (child process of PID 6736) could not be terminated.
          // Reason: There is no running instance of the task.
          return resolve();
        }
        return reject(err);
      }
      return resolve();
    });
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Failed to resolve an available TCP port'));
        });
        return;
      }

      const { port } = address;
      server.close(err => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function getPort() {
  return reservePort();
}

function sleep(t) {
  return new Promise(resolve => setTimeout(resolve, t));
}

module.exports = {
  runModernCommand,
  runModernCommandDev,
  modernBuild,
  modernDeploy,
  modernServe,
  launchApp,
  killApp,
  getPort,
  sleep,
  runContinuousTask,
  launchOptions,
  ensureWorkspacePackagesBuilt,
};
