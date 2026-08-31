import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const configPath = path.join(root, '.agents', 'agent-reference-repos.json');
const manifestPath = path.join(root, '.modernjs', 'agent-reference-repos.json');

const truthy = value => /^(1|true|yes|on)$/i.test(String(value ?? ''));
const falsy = value => /^(0|false|no|off)$/i.test(String(value ?? ''));

const skipRequested =
  truthy(process.env.ULTRAMODERN_SKIP_AGENT_REPOS) ||
  falsy(process.env.ULTRAMODERN_AGENT_REPOS);
const required = truthy(process.env.ULTRAMODERN_AGENT_REPOS_REQUIRED);
const refresh = truthy(process.env.ULTRAMODERN_AGENT_REPOS_REFRESH);

const gitIdentityEnv = {
  GIT_AUTHOR_NAME:
    process.env.GIT_AUTHOR_NAME || 'UltraModern Agent Reference Setup',
  GIT_AUTHOR_EMAIL:
    process.env.GIT_AUTHOR_EMAIL || 'ultramodern-agent-refs@local',
  GIT_COMMITTER_NAME:
    process.env.GIT_COMMITTER_NAME || 'UltraModern Agent Reference Setup',
  GIT_COMMITTER_EMAIL:
    process.env.GIT_COMMITTER_EMAIL || 'ultramodern-agent-refs@local',
};

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
    env: {
      ...process.env,
      ...gitIdentityEnv,
      ...(options.env ?? {}),
    },
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

function hasGitSubtree() {
  const result = spawnSync('git', ['subtree', '-h'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return (
    (result.status === 0 || result.status === 129) &&
    result.stdout.includes('usage: git subtree')
  );
}

function isGitWorkTree() {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0 && result.stdout.trim() === 'true';
}

function hasCommits() {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

function porcelainStatus() {
  return run('git', ['status', '--porcelain'], { timeout: 30000 });
}

function commitInstallerChanges(message) {
  run('git', ['commit', '-m', message], {
    timeout: 120000,
  });
}

function ensureGitRepository() {
  if (!isGitWorkTree()) {
    if (checkOnly) {
      fail('workspace is not a git repository');
      return false;
    }
    log('initializing git repository for agent reference subtrees');
    run('git', ['init'], { timeout: 30000 });
  }

  if (!hasCommits()) {
    if (checkOnly) {
      fail('workspace has no initial git commit');
      return false;
    }
    log('creating initial workspace commit before adding reference subtrees');
    run('git', ['add', '-A'], { timeout: 30000 });
    commitInstallerChanges('Initialize UltraModern workspace');
    return true;
  }

  const status = porcelainStatus();
  if (status) {
    fail(
      'workspace has uncommitted changes; commit or stash them before installing reference subtrees',
    );
    return false;
  }

  return true;
}

function remoteCommit(repo) {
  let output = run('git', ['ls-remote', repo.url, `refs/heads/${repo.ref}`], {
    timeout: 120000,
  });
  if (!output) {
    output = run('git', ['ls-remote', repo.url, repo.ref], {
      timeout: 120000,
    });
  }
  const [commit] = output.split(/\s+/);
  if (!/^[a-f0-9]{40}$/i.test(commit ?? '')) {
    throw new Error(`Could not resolve ${repo.url}#${repo.ref}`);
  }
  return commit;
}

function subtreeCommitExists(repo) {
  const result = spawnSync(
    'git',
    [
      'log',
      '--grep',
      `git-subtree-dir: ${repo.path}`,
      '--format=%H',
      '-n',
      '1',
    ],
    {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return result.status === 0 && result.stdout.trim().length > 0;
}

function installedManifestEntry(repo) {
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }
  try {
    const manifest = readJson(manifestPath);
    return manifest.repositories?.find(entry => entry.id === repo.id);
  } catch {
    return undefined;
  }
}

function assertSubtreePresent(repo) {
  assertSafeRepoPath(repo.path);
  const targetPath = path.join(root, repo.path);
  if (!fs.existsSync(targetPath)) {
    fail(`${repo.path} is missing`);
    return undefined;
  }
  if (!subtreeCommitExists(repo)) {
    fail(`${repo.path} is present but has no git-subtree commit evidence`);
    return undefined;
  }
  return (
    installedManifestEntry(repo) ?? {
      id: repo.id,
      name: repo.name,
      url: repo.url,
      ref: repo.ref,
      path: repo.path,
      readOnly: repo.readOnly !== false,
      status: 'present',
      strategy: 'git-subtree-squash',
    }
  );
}

function addSubtree(repo) {
  assertSafeRepoPath(repo.path);
  const targetPath = path.join(root, repo.path);
  const existing = fs.existsSync(targetPath);

  if (existing && !refresh) {
    return assertSubtreePresent(repo);
  }

  if (existing && refresh) {
    fail(
      `${repo.path} already exists; refresh for subtree references is intentionally manual`,
    );
    return undefined;
  }

  if (checkOnly) {
    fail(`${repo.path} is missing`);
    return undefined;
  }

  const commit = remoteCommit(repo);
  log(`adding ${repo.name} as git subtree at ${repo.path} (${commit})`);
  run('git', ['fetch', '--depth', '1', repo.url, repo.ref], {
    timeout: 300000,
  });
  run(
    'git',
    [
      'subtree',
      'add',
      '--prefix',
      repo.path,
      'FETCH_HEAD',
      '--squash',
      '-m',
      `Add ${repo.name} agent reference repo`,
    ],
    { timeout: 600000 },
  );

  return {
    schemaVersion: 1,
    id: repo.id,
    name: repo.name,
    url: repo.url,
    ref: repo.ref,
    commit,
    path: repo.path,
    readOnly: repo.readOnly !== false,
    strategy: 'git-subtree-squash',
    status: 'installed',
    installedAt: new Date().toISOString(),
  };
}

function writeManifest(entries) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        strategy: 'git-subtree-squash',
        installDir: 'repos',
        repositories: entries,
      },
      null,
      2,
    )}\n`,
  );
}

function commitManifestIfChanged() {
  const status = run('git', ['status', '--porcelain', '--', manifestPath], {
    timeout: 30000,
  });
  if (!status) {
    return;
  }
  run('git', ['add', manifestPath], { timeout: 30000 });
  commitInstallerChanges('Record agent reference repo manifest');
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
  if (!hasGitSubtree()) {
    fail('git subtree is required to install agent reference repositories');
    return;
  }
  if (!ensureGitRepository()) {
    return;
  }

  const entries = [];
  for (const repo of config.repositories ?? []) {
    const result = checkOnly ? assertSubtreePresent(repo) : addSubtree(repo);
    if (result) {
      entries.push(result);
    }
  }

  if (!checkOnly) {
    writeManifest(entries);
    commitManifestIfChanged();
  }
}

try {
  main();
} catch (error) {
  if (required || checkOnly) {
    console.error(`[agent-reference-repos] ${error.message}`);
    process.exitCode = 1;
  } else {
    warn(error.message);
  }
}
