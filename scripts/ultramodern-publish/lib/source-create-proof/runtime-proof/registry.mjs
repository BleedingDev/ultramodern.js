import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { assert } from '../assertions.mjs';
import { publishPackageBuffer } from '../../prepare-bleedingdev-packages/npm-buffer-publisher.mjs';
import {
  readVerifiedPackageArtifactBytes,
  verifyPackageArtifactBytes,
} from '../../prepare-bleedingdev-packages/release-artifacts.mjs';

const VERDACCIO_VERSION = '6.7.4';
const VERDACCIO_SPECIFIER = `verdaccio@${VERDACCIO_VERSION}`;
const VERDACCIO_INTEGRITY =
  'sha512-C59DdKYtc1vayM3HiRFVRCRJMd4Hq4QCQnjTMM6CVanJvMpaqHlZ+DHE31/L8ScXkzUl1oS0HulizpxmMXW1LA==';
const VERDACCIO_UPSTREAM = 'https://registry.npmjs.org/';
const registryHost = '127.0.0.1';

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      ...(options.env ?? {}),
    },
    stdio: options.stdio ?? 'pipe',
  });
  if (result.error) {
    throw new Error(
      `${command} ${args.join(' ')} failed to start: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
    throw new Error(
      [`${command} ${args.join(' ')} exited ${result.status}`, output.trim()]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return result.stdout?.trim() ?? '';
}

function createVerdaccioConfig({ storageDir, htpasswdPath, scope }) {
  return [
    `storage: ${JSON.stringify(storageDir)}`,
    'auth:',
    '  htpasswd:',
    `    file: ${JSON.stringify(htpasswdPath)}`,
    '    max_users: 1000',
    'uplinks:',
    '  npmjs:',
    `    url: ${JSON.stringify(VERDACCIO_UPSTREAM)}`,
    'packages:',
    `  ${JSON.stringify(`@${scope}/*`)}:`,
    '    access: $all',
    '    publish: $authenticated',
    '    unpublish: $authenticated',
    "  '**':",
    '    access: $all',
    '    proxy: npmjs',
    'log:',
    '  type: stdout',
    '  format: pretty',
    '  level: warn',
    '',
  ].join('\n');
}

function verdaccioDlxArgs(configPath, port) {
  return [
    'dlx',
    VERDACCIO_SPECIFIER,
    '--config',
    configPath,
    '--listen',
    `${registryHost}:${port}`,
  ];
}

function assertVerdaccioDistributionIntegrity(runImpl = runChecked) {
  const output = runImpl(
    'npm',
    [
      'view',
      VERDACCIO_SPECIFIER,
      'dist.integrity',
      '--json',
      '--registry',
      VERDACCIO_UPSTREAM,
    ],
    { stdio: 'pipe' },
  );
  let integrity;
  try {
    integrity = JSON.parse(output);
  } catch {
    integrity = output;
  }
  assert(
    integrity === VERDACCIO_INTEGRITY,
    `Verdaccio ${VERDACCIO_VERSION} integrity mismatch: expected ${VERDACCIO_INTEGRITY}, found ${integrity}`,
  );
}

function reservePort(host = registryHost) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForRegistry(registryUrl, fetchImpl = fetch) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(new URL('-/ping', registryUrl));
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(
    `Verdaccio did not become ready at ${registryUrl}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function createRegistryUser(registryUrl, fetchImpl = fetch) {
  const username = 'ultramodern-acceptance';
  const response = await fetchImpl(
    new URL(`-/user/org.couchdb.user:${username}`, registryUrl),
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        _id: `org.couchdb.user:${username}`,
        name: username,
        password: 'ultramodern-acceptance-only',
        roles: [],
        type: 'user',
      }),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Could not create the ephemeral Verdaccio publisher (HTTP ${response.status}): ${body}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Verdaccio publisher response was not valid JSON');
  }
  assert(
    typeof parsed.token === 'string' && parsed.token.length > 0,
    'Verdaccio publisher response did not include an authentication token',
  );
  return parsed.token;
}

function createRegistryEnv({ registryUrl, userConfigPath, cacheDir }) {
  return {
    npm_config_cache: cacheDir,
    npm_config_registry: registryUrl,
    npm_config_userconfig: userConfigPath,
    pnpm_config_registry: registryUrl,
  };
}

function writeRegistryUserConfig(filePath, registryUrl, token) {
  const url = new URL(registryUrl);
  const authKey = `${url.host}${url.pathname}`.replace(/\/?$/u, '/');
  fs.writeFileSync(
    filePath,
    [
      `registry=${registryUrl}`,
      `//${authKey}:_authToken=${token}`,
      'always-auth=true',
      '',
    ].join('\n'),
  );
}

function readRegistryDist(specifier, registry, runImpl = runChecked) {
  const output = runImpl(
    'npm',
    [
      'view',
      specifier,
      'dist',
      '--json',
      '--registry',
      registry.registryUrl,
      '--userconfig',
      registry.userConfigPath,
    ],
    { env: registry.env, stdio: 'pipe' },
  );
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(
      `Registry metadata for ${specifier} was not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function publishReleaseTarballs(
  release,
  registry,
  authToken,
  {
    publishPackageBufferImpl = publishPackageBuffer,
    readArtifactBytes = readVerifiedPackageArtifactBytes,
    readRegistryDistImpl = readRegistryDist,
    runImpl = runChecked,
  } = {},
) {
  const published = [];
  const packagesByTarget = new Map(
    release.packages.map(item => [item.targetName, item]),
  );
  for (const targetName of release.publishOrder) {
    const item = packagesByTarget.get(targetName);
    assert(item, `Release publish order references missing package ${targetName}`);
    const acceptedBytes = Buffer.from(
      readArtifactBytes(item, item.artifactPath),
    );
    await publishPackageBufferImpl(item, acceptedBytes, {
      acceptedTools: release.tools,
      authToken,
      provenance: false,
      registryUrl: registry.registryUrl,
      tag: release.release.tag,
    });
    verifyPackageArtifactBytes(item, acceptedBytes);
    const specifier = `${item.targetName}@${item.version}`;
    const dist = readRegistryDistImpl(specifier, registry, runImpl);
    assert(
      dist.integrity === item.integrity,
      `${specifier} registry integrity mismatch after exact tarball publication`,
    );
    assert(
      dist.shasum === item.shasum,
      `${specifier} registry shasum mismatch after exact tarball publication`,
    );
    published.push({
      sourceName: item.sourceName,
      targetName: item.targetName,
      version: item.version,
      integrity: dist.integrity,
      shasum: dist.shasum,
    });
  }
  return published;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

async function startEphemeralRegistry({
  release,
  rootDir,
  fetchImpl = fetch,
  runImpl = runChecked,
  spawnImpl = spawn,
  reservePortImpl = reservePort,
}) {
  assertVerdaccioDistributionIntegrity(runImpl);
  const port = await reservePortImpl(registryHost);
  const configPath = path.join(rootDir, 'verdaccio.yaml');
  const storageDir = path.join(rootDir, 'storage');
  const htpasswdPath = path.join(rootDir, 'htpasswd');
  const userConfigPath = path.join(rootDir, '.npmrc');
  const cacheDir = path.join(rootDir, 'npm-cache');
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(
    configPath,
    createVerdaccioConfig({
      storageDir,
      htpasswdPath,
      scope: release.targetScope,
    }),
  );

  const child = spawnImpl('pnpm', verdaccioDlxArgs(configPath, port), {
    cwd: rootDir,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', chunk => {
      output.push(String(chunk));
      if (output.join('').length > 65_536) {
        output.splice(0, output.length - 1);
      }
    });
  }
  const registryUrl = `http://${registryHost}:${port}/`;

  try {
    await Promise.race([
      waitForRegistry(registryUrl, fetchImpl),
      once(child, 'exit').then(([code, signal]) => {
        throw new Error(
          `Verdaccio exited before readiness (code ${code}, signal ${signal})\n${output.join('')}`,
        );
      }),
    ]);
    const token = await createRegistryUser(registryUrl, fetchImpl);
    writeRegistryUserConfig(userConfigPath, registryUrl, token);
    const registry = {
      registryUrl,
      userConfigPath,
      env: createRegistryEnv({ registryUrl, userConfigPath, cacheDir }),
      tool: {
        name: 'verdaccio',
        version: VERDACCIO_VERSION,
        specifier: VERDACCIO_SPECIFIER,
        integrity: VERDACCIO_INTEGRITY,
      },
      stop: () => stopChild(child),
    };
    registry.published = await publishReleaseTarballs(
      release,
      registry,
      token,
      { runImpl },
    );
    return registry;
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

export {
  VERDACCIO_INTEGRITY,
  VERDACCIO_SPECIFIER,
  VERDACCIO_UPSTREAM,
  VERDACCIO_VERSION,
  assertVerdaccioDistributionIntegrity,
  createRegistryEnv,
  createVerdaccioConfig,
  publishReleaseTarballs,
  readRegistryDist,
  reservePort,
  runChecked,
  startEphemeralRegistry,
  verdaccioDlxArgs,
};
