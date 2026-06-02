import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const lockPath = path.join(root, '.agents/skills-lock.json');
const checkOnly = process.argv.includes('--check');
const force = process.argv.includes('--force');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf-8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });

const commandExists = (command) => {
  try {
    run(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const runShell = (script) =>
  run('sh', ['-lc', script], {
    stdio: 'inherit',
  });

const installGit = () => {
  if (commandExists('git')) {
    return;
  }

  if (commandExists('brew')) {
    run('brew', ['install', 'git'], { stdio: 'inherit' });
  } else if (process.platform === 'linux' && commandExists('apt-get')) {
    const sudo = typeof process.getuid === 'function' && process.getuid() === 0 ? '' : 'sudo ';
    runShell(`${sudo}apt-get update && ${sudo}apt-get install -y git`);
  } else if (process.platform === 'linux' && commandExists('dnf')) {
    const sudo = typeof process.getuid === 'function' && process.getuid() === 0 ? '' : 'sudo ';
    runShell(`${sudo}dnf install -y git`);
  } else if (process.platform === 'linux' && commandExists('yum')) {
    const sudo = typeof process.getuid === 'function' && process.getuid() === 0 ? '' : 'sudo ';
    runShell(`${sudo}yum install -y git`);
  } else if (process.platform === 'linux' && commandExists('apk')) {
    runShell('apk add --no-cache git');
  }

  if (!commandExists('git')) {
    throw new Error(
      'Git is required for UltraModern setup. Install git and run pnpm skills:install again.',
    );
  }
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

const removeTree = (dir) =>
  fs.rmSync(dir, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 100,
  });

const cloneSource = (source, targetDir) => {
  const repo = source.repository.replace(/^https:\/\/github.com\//u, '');
  try {
    run('gh', ['repo', 'clone', repo, targetDir, '--', '--depth', '1'], {
      stdio: 'inherit',
    });
  } catch {
    run('git', ['clone', '--depth', '1', source.repository, targetDir], {
      stdio: 'inherit',
    });
  }
};

const resolveSkillDir = (sourceRoot, skillName) => {
  const candidates = [
    path.join(sourceRoot, skillName),
    path.join(sourceRoot, 'skills', skillName),
    path.join(sourceRoot, 'skills', 'engineering', skillName),
    path.join(sourceRoot, 'skills', 'productivity', skillName),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'SKILL.md')));
};

if (!fs.existsSync(lockPath)) {
  console.error('Missing .agents/skills-lock.json');
  process.exit(1);
}

const lock = readJson(lockPath);
const installDir = path.join(root, lock.installDir ?? '.agents/skills');
const sources = lock.sources ?? [];
const requiredCloneSources = sources.filter((source) => source.install === 'clone');
const optionalCloneSources = sources.filter(
  (source) => source.install === 'clone-if-authorized',
);
const requiredSkills = [
  ...(lock.baseline ?? []),
  ...requiredCloneSources.flatMap((source) => source.baseline ?? []),
].filter(
  (skill, index, skills) =>
    skills.findIndex((candidate) => candidate.name === skill.name) === index,
);

if (checkOnly) {
  const missingRequired = requiredSkills
    .map((skill) => skill.name)
    .filter((skillName) => !fs.existsSync(path.join(installDir, skillName, 'SKILL.md')));
  const missingOptional = optionalCloneSources.flatMap((source) =>
    (source.baseline ?? [])
      .map((skill) => skill.name)
      .filter((skillName) => !fs.existsSync(path.join(installDir, skillName, 'SKILL.md'))),
  );

  if (missingRequired.length > 0) {
    console.error(
      `Required agent skills not installed: ${missingRequired.join(', ')}. Run pnpm skills:install.`,
    );
    process.exit(1);
  }

  if (missingOptional.length > 0) {
    console.warn(
      `Private skills not installed: ${missingOptional.join(', ')}. Run pnpm skills:install if you have access.`,
    );
  } else {
    console.log('Required and private agent skills are installed.');
    process.exit(0);
  }
  console.log('Required agent skills are installed.');
  process.exit(0);
}

fs.mkdirSync(installDir, { recursive: true });
installGit();

for (const source of [...requiredCloneSources, ...optionalCloneSources]) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-skills-'));
  try {
    try {
      cloneSource(source, tempDir);
    } catch (error) {
      if (source.install === 'clone-if-authorized') {
        console.warn(
          `Skipping ${source.repository}; current developer may not have access.`,
        );
        continue;
      }
      throw error;
    }
    for (const skill of source.baseline ?? []) {
      const sourceSkillDir = resolveSkillDir(tempDir, skill.name);
      if (!sourceSkillDir) {
        throw new Error(`Skill ${skill.name} not found in ${source.repository}`);
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

initializeGitRepository();
installLefthook();
