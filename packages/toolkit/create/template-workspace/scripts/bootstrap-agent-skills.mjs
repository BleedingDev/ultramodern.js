import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const lockPath = path.join(root, '.agents/skills-lock.json');
const checkOnly = process.argv.includes('--check');
const force = process.argv.includes('--force');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
}

function cloneSource(source, targetDir) {
  const repo = source.repository.replace(/^https:\/\/github.com\//, '');
  try {
    run('gh', ['repo', 'clone', repo, targetDir, '--', '--depth', '1'], {
      stdio: 'inherit',
    });
    return;
  } catch {
    run('git', ['clone', '--depth', '1', source.repository, targetDir], {
      stdio: 'inherit',
    });
  }
}

function resolveSkillDir(sourceRoot, skillName) {
  const candidates = [
    path.join(sourceRoot, skillName),
    path.join(sourceRoot, 'skills', skillName),
    path.join(sourceRoot, 'skills', 'engineering', skillName),
    path.join(sourceRoot, 'skills', 'productivity', skillName),
  ];
  return candidates.find(candidate =>
    fs.existsSync(path.join(candidate, 'SKILL.md')),
  );
}

if (!fs.existsSync(lockPath)) {
  console.error('Missing .agents/skills-lock.json');
  process.exit(1);
}

const lock = readJson(lockPath);
const installDir = path.join(root, lock.installDir ?? '.agents/skills');
const privateSources = (lock.sources ?? []).filter(
  source => source.install === 'clone-if-authorized',
);

if (checkOnly) {
  const missing = privateSources.flatMap(source =>
    (source.baseline ?? [])
      .map(skill => skill.name)
      .filter(
        skillName =>
          !fs.existsSync(path.join(installDir, skillName, 'SKILL.md')),
      ),
  );
  if (missing.length > 0) {
    console.warn(
      `Private skills not installed: ${missing.join(', ')}. Run pnpm skills:install if you have access.`,
    );
  } else {
    console.log('Agent skills are installed.');
  }
  process.exit(0);
}

fs.mkdirSync(installDir, { recursive: true });

for (const source of privateSources) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-skills-'));
  try {
    cloneSource(source, tempDir);
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
        fs.rmSync(targetSkillDir, { recursive: true, force: true });
      }
      fs.cpSync(sourceSkillDir, targetSkillDir, { recursive: true });
      console.log(`Installed ${skill.name}`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
