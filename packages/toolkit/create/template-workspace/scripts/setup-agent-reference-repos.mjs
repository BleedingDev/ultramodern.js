import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const configPath = path.join(root, '.agents', 'agent-reference-repos.json');
const manifestPath = path.join(root, '.modernjs', 'agent-reference-repos.json');
const tempRoot = path.join(root, '.modernjs', 'agent-reference-repos-tmp');

const truthy = value => /^(1|true|yes|on)$/i.test(String(value ?? ''));
const falsy = value => /^(0|false|no|off)$/i.test(String(value ?? ''));

const skipRequested =
  truthy(process.env.ULTRAMODERN_SKIP_AGENT_REPOS) ||
  falsy(process.env.ULTRAMODERN_AGENT_REPOS);
const required = truthy(process.env.ULTRAMODERN_AGENT_REPOS_REQUIRED);
const refresh = truthy(process.env.ULTRAMODERN_AGENT_REPOS_REFRESH);

const log = message => console.log(`[agent-reference-repos] ${message}`);
const warn = message => console.warn(`[agent-reference-repos] ${message}`);

function fail(message) {
  if (required || checkOnly) {
    throw new Error(message);
  }
  warn(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    encoding: 'utf-8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 120000,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      `${command} ${commandArgs.join(' ')} failed${
        stderr ? `: ${stderr}` : ''
      }`,
    );
  }
  return result.stdout?.trim() ?? '';
}

function assertSafeRepoPath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).includes('..') ||
    !relativePath.startsWith('repos/')
  ) {
    throw new Error(`Unsafe reference repository path: ${relativePath}`);
  }
}

function hasGit() {
  const result = spawnSync('git', ['--version'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

function existingReference(targetPath, repo) {
  const markerPath = path.join(targetPath, '.ultramodern-reference-repo.json');
  if (!fs.existsSync(markerPath)) {
    return undefined;
  }
  try {
    const marker = readJson(markerPath);
    if (marker.url === repo.url && marker.ref === repo.ref) {
      return marker;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function materializeRepository(repo) {
  assertSafeRepoPath(repo.path);
  const targetPath = path.join(root, repo.path);
  const existing = existingReference(targetPath, repo);

  if (existing && !refresh) {
    log(`${repo.id} already present at ${repo.path} (${existing.commit})`);
    return { ...existing, status: 'present' };
  }

  if (fs.existsSync(targetPath)) {
    if (!refresh) {
      fail(`${repo.path} exists but is not a managed reference repo`);
      return undefined;
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
  }

  if (checkOnly) {
    fail(`${repo.path} is missing`);
    return undefined;
  }

  fs.mkdirSync(tempRoot, { recursive: true });
  const tempPath = fs.mkdtempSync(path.join(tempRoot, `${repo.id}-`));

  try {
    log(`cloning ${repo.name} from ${repo.url}#${repo.ref}`);
    run(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--single-branch',
        '--branch',
        repo.ref,
        '--filter=blob:none',
        repo.url,
        tempPath,
      ],
      { timeout: 300000 },
    );
    const commit = run('git', ['-C', tempPath, 'rev-parse', 'HEAD']);
    fs.rmSync(path.join(tempPath, '.git'), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.renameSync(tempPath, targetPath);

    const marker = {
      schemaVersion: 1,
      id: repo.id,
      name: repo.name,
      url: repo.url,
      ref: repo.ref,
      commit,
      path: repo.path,
      readOnly: repo.readOnly !== false,
      installedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(targetPath, '.ultramodern-reference-repo.json'),
      `${JSON.stringify(marker, null, 2)}\n`,
    );
    log(`${repo.id} installed at ${repo.path} (${commit})`);
    return { ...marker, status: 'installed' };
  } catch (error) {
    fs.rmSync(tempPath, { recursive: true, force: true });
    fail(`Could not install ${repo.id}: ${error.message}`);
    return undefined;
  }
}

function main() {
  if (!fs.existsSync(configPath)) {
    fail('Missing .agents/agent-reference-repos.json');
    return;
  }

  const config = readJson(configPath);
  const enabled = config.defaultEnabled !== false && !skipRequested;

  if (!enabled) {
    log('setup skipped; set ULTRAMODERN_SKIP_AGENT_REPOS=0 to enable it again');
    return;
  }

  if (!hasGit()) {
    fail('git is required to install agent reference repositories');
    return;
  }

  const installed = [];
  for (const repo of config.repositories ?? []) {
    const result = materializeRepository(repo);
    if (result) {
      installed.push(result);
    }
  }

  if (!checkOnly) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          installDir: config.installDir ?? 'repos',
          repositories: installed,
        },
        null,
        2,
      )}\n`,
    );
  }
}

try {
  main();
} catch (error) {
  console.error(`[agent-reference-repos] ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
