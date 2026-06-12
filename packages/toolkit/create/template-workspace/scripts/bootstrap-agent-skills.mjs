import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const lockPath = path.join(root, '.agents/skills-lock.json');
const checkOnly = process.argv.includes('--check');
const force = process.argv.includes('--force');
const postinstall = process.argv.includes('--postinstall');
const truthy = value => /^(1|true|yes|on)$/i.test(String(value ?? ''));
const falsy = value => /^(0|false|no|off)$/i.test(String(value ?? ''));
const skipRequested =
  truthy(process.env.ULTRAMODERN_SKIP_AGENT_SKILLS) ||
  falsy(process.env.ULTRAMODERN_AGENT_SKILLS);
const cloneTimeoutMs = Number.parseInt(
  process.env.ULTRAMODERN_AGENT_SKILLS_CLONE_TIMEOUT_MS ?? '60000',
  10,
);

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf-8'));

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf-8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout,
  });

const commandExists = command => {
  try {
    run(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const requireGit = () => {
  if (commandExists('git')) {
    return;
  }

  throw new Error(
    'Git is required to install agent skills. Install git yourself (for example "brew install git" or "sudo apt-get install git") and run pnpm skills:install again. This script never installs system packages on your behalf.',
  );
};

const isInsideGitWorkTree = () => {
  try {
    return run('git', ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
};

const initializeGitRepository = () => {
  if (isInsideGitWorkTree()) {
    return;
  }

  try {
    run('git', ['init', '-b', 'main'], { stdio: 'inherit' });
  } catch {
    run('git', ['init'], { stdio: 'inherit' });
    run('git', ['branch', '-M', 'main'], { stdio: 'inherit' });
  }
};

const installLefthook = () => {
  try {
    run('lefthook', ['install'], { stdio: 'inherit' });
  } catch (error) {
    console.warn(`Unable to install lefthook hooks: ${error.message}`);
  }
};

const removeTree = dir =>
  fs.rmSync(dir, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 100,
  });

const cloneSource = (source, targetDir) => {
  if (source.commit) {
    run('git', ['init', targetDir], { timeout: 30000 });
    run('git', ['remote', 'add', 'origin', source.repository], {
      cwd: targetDir,
      timeout: 30000,
    });
    run('git', ['fetch', '--depth', '1', '--quiet', 'origin', source.commit], {
      cwd: targetDir,
      timeout: cloneTimeoutMs,
    });
    run(
      'git',
      [
        '-c',
        'advice.detachedHead=false',
        'checkout',
        '--detach',
        '--quiet',
        'FETCH_HEAD',
      ],
      { cwd: targetDir, timeout: 30000 },
    );
    return;
  }

  const repo = source.repository.replace(/^https:\/\/github.com\//u, '');
  try {
    run(
      'gh',
      ['repo', 'clone', repo, targetDir, '--', '--depth', '1', '--quiet'],
      { timeout: cloneTimeoutMs },
    );
  } catch {
    run(
      'git',
      ['clone', '--depth', '1', '--quiet', source.repository, targetDir],
      { timeout: cloneTimeoutMs },
    );
  }
};

const resolveSkillDir = (sourceRoot, skillName) => {
  const candidates = [
    path.join(sourceRoot, skillName),
    path.join(sourceRoot, 'skills', skillName),
    path.join(sourceRoot, 'skills', 'engineering', skillName),
    path.join(sourceRoot, 'skills', 'productivity', skillName),
  ];
  return candidates.find(candidate =>
    fs.existsSync(path.join(candidate, 'SKILL.md')),
  );
};

if (!fs.existsSync(lockPath)) {
  console.error('Missing .agents/skills-lock.json');
  process.exit(1);
}

const lock = readJson(lockPath);
const installDir = path.join(root, lock.installDir ?? '.agents/skills');
const sources = lock.sources ?? [];
const requiredCloneSources = sources.filter(
  source => source.install === 'clone',
);
const optionalCloneSources = sources.filter(
  source => source.install === 'clone-if-authorized',
);
const cloneSourceSkillNames = new Set(
  [...requiredCloneSources, ...optionalCloneSources].flatMap(source =>
    (source.baseline ?? []).map(skill => skill.name),
  ),
);
const vendoredRequiredSkills = (lock.baseline ?? []).filter(
  skill => !cloneSourceSkillNames.has(skill.name),
);
const cloneOptIn = truthy(process.env.ULTRAMODERN_AGENT_SKILLS);

if (skipRequested) {
  const reason = 'agent skills bootstrap skipped by environment';
  if (checkOnly) {
    console.log(reason);
    process.exit(0);
  }
  console.log(reason);
  installLefthook();
  process.exit(0);
}

if (checkOnly) {
  const missingVendored = vendoredRequiredSkills
    .map(skill => skill.name)
    .filter(
      skillName => !fs.existsSync(path.join(installDir, skillName, 'SKILL.md')),
    );
  const missingCloneInstalled = [
    ...requiredCloneSources,
    ...optionalCloneSources,
  ].flatMap(source =>
    (source.baseline ?? [])
      .map(skill => skill.name)
      .filter(
        skillName =>
          !fs.existsSync(path.join(installDir, skillName, 'SKILL.md')),
      ),
  );

  if (missingVendored.length > 0) {
    console.error(
      `Required agent skills not installed: ${missingVendored.join(', ')}. Run pnpm skills:install.`,
    );
    process.exit(1);
  }

  if (missingCloneInstalled.length > 0) {
    console.warn(
      `Clone-installed agent skills not present: ${missingCloneInstalled.join(', ')}. Run pnpm skills:install to fetch them.`,
    );
  } else {
    console.log('All pinned agent skills are installed.');
  }
  process.exit(0);
}

if (postinstall && !cloneOptIn) {
  console.log(
    'Skipping agent skill repository clones during postinstall. Run pnpm skills:install (or set ULTRAMODERN_AGENT_SKILLS=1 before installing) to fetch them.',
  );
  installLefthook();
  process.exit(0);
}

fs.mkdirSync(installDir, { recursive: true });
requireGit();
initializeGitRepository();

for (const source of [...requiredCloneSources, ...optionalCloneSources]) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-skills-'));
  try {
    try {
      cloneSource(source, tempDir);
    } catch (error) {
      if (source.install === 'clone-if-authorized' || postinstall) {
        console.warn(`Skipping ${source.repository}; ${error.message}`);
        continue;
      }
      throw error;
    }
    for (const skill of source.baseline ?? []) {
      const sourceSkillDir = resolveSkillDir(tempDir, skill.name);
      if (!sourceSkillDir) {
        throw new Error(
          `Skill ${skill.name} not found in ${source.repository}`,
        );
      }
      const targetSkillDir = path.join(installDir, skill.name);
      if (fs.existsSync(targetSkillDir)) {
        if (!force) {
          console.log(`Skipping existing ${skill.name}`);
          continue;
        }
        removeTree(targetSkillDir);
      }
      fs.cpSync(sourceSkillDir, targetSkillDir, { recursive: true });
      console.log(`Installed ${skill.name}`);
    }
  } finally {
    removeTree(tempDir);
  }
}

installLefthook();
