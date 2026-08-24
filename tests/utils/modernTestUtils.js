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
// Readers (spawned modern builds) can legitimately run for several minutes;
// only steamroll them when the owning process is gone or clearly abandoned.
const kWorkspaceDistReaderStaleAge = 30 * 60 * 1000;
const kWorkspaceRwLockRoot = path.join(
  os.tmpdir(),
  `modernjs-workspace-rwlock-${crypto
    .createHash('sha1')
    .update(kRepoRoot)
    .digest('hex')}`,
);
const kWorkspaceDistWriterLockDir = path.join(
  kWorkspaceRwLockRoot,
  'writer.lock',
);
const kWorkspaceDistReadersDir = path.join(kWorkspaceRwLockRoot, 'readers');

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

// --- workspace dist reader/writer coordination -----------------------------
//
// Root-cause guard for the first-run-after-prepare-build flake: workspace
// package rebuilds triggered by `ensureWorkspacePackagesBuilt` wipe and
// rewrite `packages/*/dist` trees (rslib cleans dist first). A `modern build`
// spawned by ANOTHER rstest worker resolves workspace deps (e.g.
// `@modern-js/utils/dist/esm-node/index.mjs` from app-tools'
// ts-paths-loader.mjs loader thread) through those same dist trees and dies
// with ERR_MODULE_NOT_FOUND if it races a wipe window. The per-package build
// locks above only serialize rebuilds against each other, not against
// spawned fixture builds.
//
// The locks below implement a cross-process reader/writer protocol in
// os.tmpdir() (scoped per repo root):
//   - every spawned modern command holds a READ lock while it may resolve
//     workspace dist files (builds, dev servers, and preview servers: until
//     exit),
//   - a workspace package rebuild takes the WRITE lock: it blocks new readers
//     and waits for in-flight readers to drain before wiping any dist tree.
// Writers are preferred (new readers wait once writer.lock exists), so
// rebuilds cannot be starved.

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return error?.code === 'EPERM';
  }
}

async function listActiveWorkspaceDistReaders() {
  let entries;
  try {
    entries = await fs.promises.readdir(kWorkspaceDistReadersDir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const activeReaders = [];
  for (const entry of entries) {
    const readerPath = path.join(kWorkspaceDistReadersDir, entry);
    const readerPid = Number(entry.split('-')[0]);
    let stat;
    try {
      stat = await fs.promises.stat(readerPath);
    } catch {
      continue;
    }

    const isStale =
      (Number.isInteger(readerPid) &&
        readerPid > 0 &&
        !isPidAlive(readerPid)) ||
      Date.now() - stat.mtimeMs > kWorkspaceDistReaderStaleAge;
    if (isStale) {
      await fs.promises.rm(readerPath, { force: true });
      continue;
    }

    activeReaders.push(entry);
  }

  return activeReaders;
}

async function isWorkspaceDistWriterActive() {
  try {
    const stat = await fs.promises.stat(kWorkspaceDistWriterLockDir);
    if (Date.now() - stat.mtimeMs > kWorkspacePackageLockStaleAge) {
      await fs.promises.rm(kWorkspaceDistWriterLockDir, {
        recursive: true,
        force: true,
      });
      return false;
    }
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    // Be conservative on unexpected stat failures: treat as writer active.
    return true;
  }
}

async function acquireWorkspaceDistReadLock() {
  await fs.promises.mkdir(kWorkspaceDistReadersDir, { recursive: true });
  const readerPath = path.join(
    kWorkspaceDistReadersDir,
    `${process.pid}-${crypto.randomUUID()}.json`,
  );

  while (true) {
    if (await isWorkspaceDistWriterActive()) {
      await new Promise(resolve =>
        setTimeout(resolve, kWorkspacePackageLockPollInterval),
      );
      continue;
    }

    await fs.promises.writeFile(
      readerPath,
      JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      }),
    );

    // Close the register/acquire race: if a writer appeared while we were
    // registering, back off so it can drain the readers it already observed.
    if (!(await isWorkspaceDistWriterActive())) {
      break;
    }
    await fs.promises.rm(readerPath, { force: true });
    await new Promise(resolve =>
      setTimeout(resolve, kWorkspacePackageLockPollInterval),
    );
  }

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    await fs.promises.rm(readerPath, { force: true });
  };
}

async function acquireWorkspaceDistWriteLock() {
  await fs.promises.mkdir(kWorkspaceRwLockRoot, { recursive: true });

  while (true) {
    try {
      await fs.promises.mkdir(kWorkspaceDistWriterLockDir);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      try {
        const stat = await fs.promises.stat(kWorkspaceDistWriterLockDir);
        if (Date.now() - stat.mtimeMs > kWorkspacePackageLockStaleAge) {
          await fs.promises.rm(kWorkspaceDistWriterLockDir, {
            recursive: true,
            force: true,
          });
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

  await fs.promises.writeFile(
    path.join(kWorkspaceDistWriterLockDir, 'owner.json'),
    JSON.stringify({
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    }),
  );

  // New readers are blocked by writer.lock; wait for in-flight spawned
  // builds to finish before letting the caller wipe any dist tree.
  while ((await listActiveWorkspaceDistReaders()).length > 0) {
    await new Promise(resolve =>
      setTimeout(resolve, kWorkspacePackageLockPollInterval),
    );
  }

  return async () => {
    await fs.promises.rm(kWorkspaceDistWriterLockDir, {
      recursive: true,
      force: true,
    });
  };
}

async function waitForTcpServer(port, timeoutMs = 10_000) {
  const numericPort = Number(port);
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({
          host: '127.0.0.1',
          port: numericPort,
        });

        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('error', reject);
        socket.setTimeout(500, () => {
          socket.destroy(
            new Error(`Timed out connecting to 127.0.0.1:${numericPort}`),
          );
        });
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  const error = new Error(
    `Dev server did not accept TCP connections on 127.0.0.1:${numericPort} within ${timeoutMs}ms`,
  );
  error.cause = lastError;
  throw error;
}

function resolveReadyPort(configuredPort, output) {
  const numericPort = Number(configuredPort);
  if (Number.isInteger(numericPort) && numericPort > 0) {
    return numericPort;
  }

  const localUrl = output.match(
    /> Local:\s+(?:\x1b\[[0-9;]*m)*https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i,
  );
  const detectedPort = Number(localUrl?.[1]);
  if (Number.isInteger(detectedPort) && detectedPort > 0) {
    return detectedPort;
  }

  throw new Error('Dev server reported readiness without a usable local port');
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

        // The rebuild wipes `dist` before re-emitting it. Take the workspace
        // dist write lock so no spawned modern build (in this or any other
        // rstest worker) resolves through the half-written tree.
        const releaseDistWriteLock = await acquireWorkspaceDistWriteLock();
        try {
          await runProcess('pnpm', ['--dir', packageDir, 'run', 'build'], {
            cwd: kRepoRoot,
          });
        } finally {
          await releaseDistWriteLock();
        }
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

// Build-completeness probe: refuse to spawn a modern command against a dist
// tree that is missing required entries (e.g. a half-restored nx cache or an
// interrupted rebuild). Failing here produces an actionable error instead of
// an opaque ERR_MODULE_NOT_FOUND from a loader thread inside the child.
function assertWorkspacePackagesBuildComplete(packageNames = []) {
  const missingEntries = [];

  for (const packageName of packageNames) {
    const { packageDir, packageJson } =
      resolveWorkspacePackageInfo(packageName);
    const requiredEntries = new Set([
      resolvePackageDistEntry(packageDir, packageJson),
      ...resolveRequiredPackageDistEntries(packageDir, packageJson),
    ]);

    for (const entry of requiredEntries) {
      if (!fs.existsSync(entry)) {
        missingEntries.push(`${packageName}: ${entry}`);
      }
    }
  }

  if (missingEntries.length > 0) {
    throw new Error(
      'Workspace dist tree is incomplete; refusing to spawn a modern command ' +
        'against a half-written tree.\n' +
        `Missing files:\n  ${missingEntries.join('\n  ')}\n` +
        'Rebuild the packages above with `pnpm --filter <pkg> build` ' +
        '(or re-run `pnpm run prepare-build`) and retry.',
    );
  }
}

function runModernCommand(argv, options = {}) {
  const { cwd, rejectOnCompileError = true } = options;
  const cmd = argv[0];
  const env = {
    ...process.env,
    ...options.env,
  };
  let releaseWorkspaceDistReadLock;

  const commandPromise = new Promise((resolve, reject) => {
    const launch = async () => {
      await ensureWorkspacePackagesBuilt(options.ensureWorkspacePackages);
      assertWorkspacePackagesBuildComplete(options.ensureWorkspacePackages);
      // Hold the dist read lock for the lifetime of the child so concurrent
      // workspace package rebuilds cannot wipe dist trees out from under it.
      releaseWorkspaceDistReadLock = await acquireWorkspaceDistReadLock();

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

  return commandPromise.finally(() => releaseWorkspaceDistReadLock?.());
}

function runModernCommandDev(argv, stdOut, options = {}) {
  const { cwd, rejectOnCompileError = true } = options;
  const env = {
    ...process.env,
    ...options.env,
  };
  let releaseWorkspaceDistReadLock;

  const releaseDistReadLock = async () => {
    const release = releaseWorkspaceDistReadLock;
    releaseWorkspaceDistReadLock = undefined;
    await release?.();
  };

  const commandPromise = new Promise((resolve, reject) => {
    const launch = async () => {
      await ensureWorkspacePackagesBuilt(options.ensureWorkspacePackages);
      assertWorkspacePackagesBuildComplete(options.ensureWorkspacePackages);
      // A ready dev/serve process can still lazily resolve workspace packages
      // during compilation, route discovery, and request handling. Keep its
      // read lock until the child exits so a concurrent fixture cannot wipe a
      // package dist tree while the live server is still using it.
      releaseWorkspaceDistReadLock = await acquireWorkspaceDistReadLock();

      const instance = spawn(process.execPath, [kModernAppTools, ...argv], {
        cwd,
        env,
      });
      let didResolve = false;
      let readinessStarted = false;
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
          !readinessStarted &&
          bootupMarkers[options.modernServe ? 'serve' : 'dev'].test(message)
        ) {
          readinessStarted = true;
          let readyPort;
          try {
            readyPort = resolveReadyPort(env.PORT, stdoutOutput);
          } catch (error) {
            didResolve = true;
            error.stdout = stdoutOutput;
            error.stderr = stderrOutput;
            reject(error);
            return;
          }
          void waitForTcpServer(readyPort)
            .then(() => {
              if (!didResolve) {
                didResolve = true;
                resolve(stdOut ? message : instance);
              }
            })
            .catch(error => {
              if (!didResolve) {
                didResolve = true;
                error.stdout = stdoutOutput;
                error.stderr = stderrOutput;
                reject(error);
              }
            });
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
        void releaseDistReadLock();
        reject(error);
      });

      instance.on('close', code => {
        void releaseDistReadLock();
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

  return commandPromise.catch(async error => {
    await releaseDistReadLock();
    throw error;
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

/**
 * Copy a fixture app into a unique temporary sibling directory so test files
 * that would otherwise share one project directory each run against their own
 * copy. Concurrent build/dev in a single directory corrupts artifacts: the
 * build empties `dist` under the running server.
 *
 * node_modules is NOT symlinked as a whole: a whole-dir link would make all
 * copies share `node_modules/.modern-js` (generated code), re-creating the
 * conflict. Every entry is linked individually instead, and `.cache` /
 * `.modern-js` are left out so each copy gets its own.
 */
async function createIsolatedTestApp(sourceAppDir, options = {}) {
  const fse = require('fs-extra');
  const { prefix = `.isolated-${path.basename(sourceAppDir)}-`, exclude = [] } =
    options;

  const appDir = await fse.mkdtemp(
    path.join(path.dirname(sourceAppDir), prefix),
  );
  const topLevelExcludes = [
    'node_modules',
    'dist',
    'dist-deploy',
    'dist-ssg',
    '.output',
    'tests',
    'test',
    ...exclude,
  ];
  await fse.copy(sourceAppDir, appDir, {
    filter: src => {
      const relative = path.relative(sourceAppDir, src);
      if (!relative) {
        return true;
      }
      const [firstSegment] = relative.split(path.sep);
      return !topLevelExcludes.includes(firstSegment);
    },
  });

  const sourceNodeModules = path.join(sourceAppDir, 'node_modules');
  const appNodeModules = path.join(appDir, 'node_modules');
  await fse.ensureDir(appNodeModules);
  if (await fse.pathExists(sourceNodeModules)) {
    for (const entry of await fse.readdir(sourceNodeModules)) {
      if (entry === '.cache' || entry === '.modern-js') {
        continue;
      }
      const target = path.join(sourceNodeModules, entry);
      // stat (not lstat): pnpm's top-level entries are themselves symlinks,
      // and the link type must describe what they finally point to.
      let isDirectory = true;
      try {
        isDirectory = (await fse.stat(target)).isDirectory();
      } catch {
        continue; // dangling link in the source tree
      }
      await fse.ensureSymlink(
        target,
        path.join(appNodeModules, entry),
        isDirectory ? 'junction' : 'file',
      );
    }
  }

  return {
    appDir,
    // Callers must kill any process using appDir before cleanup; removal is
    // retried because Windows keeps directories busy while children exit.
    async cleanup() {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fse.remove(appDir);
          return;
        } catch {
          await sleep(500);
        }
      }
      await fse.remove(appDir).catch(() => {});
    },
  };
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
  acquireWorkspaceDistWriteLock,
  createIsolatedTestApp,
};
