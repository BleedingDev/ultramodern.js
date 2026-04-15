const path = require('path');
const net = require('node:net');
const spawn = require('cross-spawn');
const treeKill = require('tree-kill');
const { launchOptions } = require('./launchOptions');

const kModernAppTools = path.join(
  __dirname,
  '../node_modules/@modern-js/app-tools/bin/modern.js',
);

function runModernCommand(argv, options = {}) {
  const { cwd, rejectOnCompileError = true } = options;
  const cmd = argv[0];
  const env = {
    ...process.env,
    ...options.env,
  };

  return new Promise((resolve, reject) => {
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
    if (options.stderr) {
      instance.stderr.on('data', chunk => {
        stderrOutput += chunk;
      });
    }

    let stdoutOutput = '';
    // if (options.stdout) {
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

      if (marker?.test(message)) {
        resolve({
          code: 0,
          stdout: stdoutOutput,
        });
        await killApp(instance);
      }
    });
    // }

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
  });
}

function runModernCommandDev(argv, stdOut, options = {}) {
  const { cwd, rejectOnCompileError = true } = options;
  const env = {
    ...process.env,
    ...options.env,
  };

  return new Promise((resolve, reject) => {
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

      if (bootupMarkers[options.modernServe ? 'serve' : 'dev'].test(message)) {
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
    },
  });
}

function modernServe(dir, port, opts = {}) {
  return runModernCommandDev(['serve'], undefined, {
    cwd: dir,
    env: {
      PORT: port,
      NODE_ENV: 'production',
    },
    modernServe: true,
    ...opts,
  });
}

async function killApp(instance) {
  await new Promise((resolve, reject) => {
    if (!instance) {
      resolve();
    }

    treeKill(instance.pid, err => {
      if (err) {
        if (
          process.platform === 'win32' &&
          typeof err.message === 'string' &&
          (err.message.includes(`no running instance of the task`) ||
            err.message.includes(`not found`))
        ) {
          // Windows throws an error if the process is already dead
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
  launchOptions,
};
