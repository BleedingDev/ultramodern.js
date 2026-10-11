import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTestToolchain } from './check-test-toolchain.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const runnerEvidencePrefix = 'CI_BENCHMARK_EVIDENCE ';

function requiredText(value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Cannot record CI benchmark evidence: invalid ${label}`);
  }
  return value;
}

// Runner-provided descriptions may contain line breaks or control characters.
// Keep each description bounded and printable without dumping any environment.
function description(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`Cannot record CI benchmark evidence: missing ${label}`);
  }
  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text || text.length > 512) {
    throw new Error(`Cannot record CI benchmark evidence: invalid ${label}`);
  }
  return text;
}

function commandText(command, args, cwd, run) {
  try {
    return String(
      run(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      }),
    ).trim();
  } catch {
    // Child-process errors can contain environment-derived stderr. Publish only
    // the failing command, never the raw error or captured output.
    throw new Error(
      `Cannot record CI benchmark evidence: ${command} ${args.join(' ')} failed`,
    );
  }
}

function requiredFile(relative, cwd, readFile) {
  try {
    return readFile(path.join(cwd, relative));
  } catch {
    throw new Error(`Cannot record CI benchmark evidence: missing ${relative}`);
  }
}

function linuxDistribution(readFile) {
  let contents;
  try {
    contents = String(readFile('/etc/os-release'));
  } catch {
    return undefined;
  }
  const selected = {};
  const names = new Map([
    ['ID', 'id'],
    ['VERSION_ID', 'versionId'],
    ['PRETTY_NAME', 'name'],
  ]);
  for (const line of contents.split('\n')) {
    const match = /^(ID|VERSION_ID|PRETTY_NAME)=(.*)$/u.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/u, '$2');
    selected[names.get(match[1])] = description(value, `OS ${match[1]}`);
  }
  return Object.keys(selected).length ? selected : undefined;
}

export function collectRunnerEvidence({
  cwd = repoRoot,
  env = process.env,
  nodeVersion = process.versions.node,
  pnpmVersion,
  host = os,
  run = execFileSync,
  readFile = readFileSync,
} = {}) {
  const checkedOutCommit = requiredText(
    commandText('git', ['rev-parse', '--verify', 'HEAD'], cwd, run),
    'checkout commit',
    /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u,
  );
  requiredText(pnpmVersion, 'pnpm version', /^\d+\.\d+\.\d+$/u);
  requiredText(nodeVersion, 'Node.js version', /^\d+\.\d+\.\d+$/u);
  const lockfile = requiredFile('pnpm-lock.yaml', cwd, readFile);
  const miseConfig = requiredFile('.mise.toml', cwd, readFile);
  const packageJson = requiredFile('package.json', cwd, readFile);
  let packageManager;
  try {
    packageManager = JSON.parse(String(packageJson)).packageManager;
  } catch {
    throw new Error(
      'Cannot record CI benchmark evidence: invalid package.json',
    );
  }
  let tools;
  try {
    tools = verifyTestToolchain({
      nodeVersion,
      pnpmVersion,
      miseConfig: String(miseConfig),
      packageManager,
    });
  } catch {
    throw new Error(
      'Cannot record CI benchmark evidence: Node.js and pnpm must match exact .mise.toml pins and packageManager',
    );
  }
  const cpus = host.cpus();
  if (!Array.isArray(cpus) || cpus.length === 0) {
    throw new Error(
      'Cannot record CI benchmark evidence: CPU metadata unavailable',
    );
  }
  const memoryBytes = host.totalmem();
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes <= 0) {
    throw new Error(
      'Cannot record CI benchmark evidence: RAM metadata unavailable',
    );
  }
  const platform = description(host.platform(), 'OS platform');
  const operatingSystem = {
    platform,
    type: description(host.type(), 'OS type'),
    release: description(host.release(), 'OS release'),
    architecture: description(host.arch(), 'OS architecture'),
  };
  if (platform === 'linux') {
    const distribution = linuxDistribution(readFile);
    if (distribution) operatingSystem.distribution = distribution;
  }
  const image = {};
  if (env.ImageOS !== undefined)
    image.os = description(env.ImageOS, 'runner image OS');
  if (env.ImageVersion !== undefined)
    image.version = description(env.ImageVersion, 'runner image version');
  return {
    schema: 'ultramodern.ci.runner-evidence',
    schemaVersion: 1,
    checkedOutCommit,
    github: {
      eventSha: requiredText(
        env.GITHUB_SHA,
        'GitHub event SHA',
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u,
      ),
      repository: requiredText(
        env.GITHUB_REPOSITORY,
        'GitHub repository',
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
      ),
      repositoryId: requiredText(
        env.GITHUB_REPOSITORY_ID,
        'GitHub repository ID',
        /^[1-9][0-9]*$/u,
      ),
      workflowRef: requiredText(
        env.GITHUB_WORKFLOW_REF,
        'GitHub workflow reference',
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:\.github|\.depot)\/workflows\/[A-Za-z0-9_.-]+\.ya?ml@refs\/[A-Za-z0-9_./-]+$/u,
      ),
    },
    tools,
    runner: {
      os: operatingSystem,
      cpu: {
        logicalCount: cpus.length,
        models: [
          ...new Set(cpus.map(cpu => description(cpu.model, 'CPU model'))),
        ].sort(),
      },
      memoryBytes,
      ...(Object.keys(image).length ? { image } : {}),
    },
    inputs: {
      lockfileSha256: createHash('sha256').update(lockfile).digest('hex'),
      miseSha256: createHash('sha256').update(miseConfig).digest('hex'),
    },
  };
}

export function emitRunnerEvidence(options = {}, log = console.log) {
  const evidence = collectRunnerEvidence(options);
  log(`${runnerEvidencePrefix}${JSON.stringify(evidence)}`);
  return evidence;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 3) {
      throw new Error(
        'Usage: node scripts/ci/record-runner-evidence.mjs <pnpm-version>',
      );
    }
    emitRunnerEvidence({ pnpmVersion: process.argv[2] });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
