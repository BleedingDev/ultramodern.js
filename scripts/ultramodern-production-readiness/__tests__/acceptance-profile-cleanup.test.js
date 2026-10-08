const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const acceptanceProfilePath = path.resolve(
  __dirname,
  '../published-create-proof/acceptance-profile.mjs',
);
const releaseAgePolicyPath = path.resolve(
  __dirname,
  '../../ultramodern-publish/release-age-exceptions-2026-08-10.json',
);

const createPackage = Object.freeze({
  packageJson: Object.freeze({
    ultramodern: Object.freeze({ frameworkVersion: '3.5.0-test.1' }),
  }),
  sourceName: '@modern-js/ultramodern-create',
  targetName: '@bleedingdev/modern-js-ultramodern-create',
  version: '3.5.0-test.1',
});

const release = Object.freeze({
  aliases: Object.freeze({
    '@modern-js/ultramodern-create':
      '@bleedingdev/modern-js-ultramodern-create',
  }),
  createPackage,
  dependencyGraph: Object.freeze({
    '@bleedingdev/modern-js-ultramodern-create': Object.freeze([]),
  }),
  packages: Object.freeze([createPackage]),
  publishOrder: Object.freeze(['@bleedingdev/modern-js-ultramodern-create']),
  release: Object.freeze({ version: '3.5.0-test.1' }),
});

const options = Object.freeze({
  createPackage: undefined,
  deployCloudflare: false,
  projectName: 'acceptance-cleanup-test',
  selectedProfile: Object.freeze({ id: 'erp-10' }),
  verticals: Object.freeze(
    Array.from({ length: 10 }, (_, index) => `vertical-${index + 1}`),
  ),
});

function waitForOutput(stream, marker) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${marker}; output: ${output}`));
    }, 10_000);
    const onData = chunk => {
      output += chunk;
      if (output.includes(marker)) {
        clearTimeout(timeout);
        stream.off('data', onData);
        resolve(output);
      }
    };
    stream.on('data', onData);
    stream.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function waitForEmptyDirectory(directory) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (fs.readdirSync(directory).length === 0) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(fs.readdirSync(directory), []);
}

test('removes its temporary workspace when runtime discovery fails', async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-acceptance-cleanup-test-'),
  );
  const previousTempDir = process.env.TMPDIR;

  try {
    process.env.TMPDIR = temporaryRoot;
    const { runAcceptanceProfile } = await import(
      pathToFileURL(acceptanceProfilePath)
    );

    await assert.rejects(
      runAcceptanceProfile({
        mode: 'source',
        release,
        registryUrl: 'https://registry.example.test/',
        releaseAgePolicyPath,
        options,
        outPath: path.join(temporaryRoot, 'receipt.json'),
        runIdentity: 'test:acceptance-cleanup',
        runImpl() {
          throw new Error('runtime discovery failed');
        },
      }),
      /runtime discovery failed/,
    );

    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
  } finally {
    if (previousTempDir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = previousTempDir;
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('retains a caller-owned workspace and its outputs on failure', async () => {
  const callerRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-acceptance-caller-owned-'),
  );
  const workDir = path.join(callerRoot, 'work');
  const deployedEntry = path.join(
    workDir,
    options.projectName,
    'apps',
    'shell',
    '.output',
    'index.js',
  );
  const deployedBytes = Buffer.from('export const retained = true;\n');
  fs.mkdirSync(workDir);
  const identity = fs.statSync(workDir);
  try {
    const { runAcceptanceProfile } = await import(
      pathToFileURL(acceptanceProfilePath)
    );
    await assert.rejects(
      runAcceptanceProfile({
        mode: 'source',
        release,
        registryUrl: 'https://registry.example.test/',
        options,
        outPath: path.join(callerRoot, 'receipt.json'),
        runIdentity: 'test:acceptance-caller-owned-failure',
        releaseAgePolicyPath,
        workDir,
        runImpl() {
          fs.mkdirSync(path.dirname(deployedEntry), { recursive: true });
          fs.writeFileSync(deployedEntry, deployedBytes);
          throw new Error('focused acceptance failed');
        },
      }),
      /focused acceptance failed/,
    );
    const retained = fs.statSync(workDir);
    assert.equal(retained.dev, identity.dev);
    assert.equal(retained.ino, identity.ino);
    assert.deepEqual(fs.readFileSync(deployedEntry), deployedBytes);
    assert.equal(fs.existsSync(path.join(callerRoot, 'receipt.json')), false);
  } finally {
    fs.rmSync(callerRoot, { recursive: true, force: true });
  }
});

test('removes its temporary workspace when the process receives SIGTERM', {
  skip: process.platform === 'win32',
}, async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-acceptance-signal-test-'),
  );
  const childSource = `
      import { runAcceptanceProfile } from ${JSON.stringify(
        pathToFileURL(acceptanceProfilePath).href,
      )};

      const release = ${JSON.stringify(release)};
      const options = ${JSON.stringify(options)};
      await runAcceptanceProfile({
        mode: 'source',
        release,
        registryUrl: 'https://registry.example.test/',
        releaseAgePolicyPath: ${JSON.stringify(releaseAgePolicyPath)},
        options,
        outPath: ${JSON.stringify(path.join(temporaryRoot, 'receipt.json'))},
        runIdentity: 'test:acceptance-signal-cleanup',
        runImpl() {
          console.log('ACCEPTANCE_WORKSPACE_READY');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        },
      });
    `;
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', childSource],
    {
      env: { ...process.env, TMPDIR: temporaryRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  try {
    await waitForOutput(child.stdout, 'ACCEPTANCE_WORKSPACE_READY');
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const [, signal] = await exited;

    assert.equal(signal, 'SIGTERM');
    await waitForEmptyDirectory(temporaryRoot);
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
