import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';

/**
 * Supply-chain guardrails for generated workspaces: a plain `pnpm install`
 * (postinstall) must never install system packages with sudo or install
 * reference repositories. Codex skills are default-on, repo-owned, and may
 * skip clone-backed skills only as an advisory offline fallback.
 */

const createBinPath = path.resolve(__dirname, '../bin/run.js');

function scaffoldWorkspace(): { tempRoot: string; workspaceDir: string } {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-postinstall-safety-'),
  );
  const workspaceDir = path.join(tempRoot, 'safety-workspace');
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: 'safety-workspace',
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: {
      strategy: 'workspace',
    },
  });
  return { tempRoot, workspaceDir };
}

function writeExecutable(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
}

function writeCommandShim(
  fakeBinDir: string,
  command: string,
  scriptContent: string,
) {
  const scriptPath = path.join(fakeBinDir, `${command}.js`);
  fs.writeFileSync(scriptPath, scriptContent);
  writeExecutable(
    path.join(fakeBinDir, command),
    `#!/usr/bin/env node\nrequire(${JSON.stringify(scriptPath)});\n`,
  );
  fs.writeFileSync(
    path.join(fakeBinDir, `${command}.cmd`),
    `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
  );
}

function createFakeGitAndLefthookBin(
  tempRoot: string,
  options: { failNetwork?: boolean; topLevel?: string },
) {
  const fakeBinDir = path.join(tempRoot, 'fake-bin');
  const gitLog = path.join(tempRoot, 'git.log');
  const ghLog = path.join(tempRoot, 'gh.log');
  const lefthookLog = path.join(tempRoot, 'lefthook.log');
  fs.mkdirSync(fakeBinDir);

  writeCommandShim(
    fakeBinDir,
    'git',
    `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(gitLog)}, \`\${args.join(' ')}\\n\`);
if (args[0] === '--version') {
  console.log('git version 2.44.0');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  const topLevel = ${options.topLevel === undefined ? 'undefined' : JSON.stringify(options.topLevel)};
  if (topLevel === undefined) {
    process.exit(1);
  }
  console.log(topLevel);
  process.exit(0);
}
if (args[0] === 'init') {
  fs.mkdirSync(path.join(process.cwd(), '.git'), { recursive: true });
  process.exit(0);
}
if (args[0] === 'branch') {
  process.exit(0);
}
if (${JSON.stringify(options.failNetwork === true)} && (args[0] === 'clone' || args[0] === 'fetch')) {
  process.exit(1);
}
process.exit(0);
`,
  );
  writeCommandShim(
    fakeBinDir,
    'gh',
    `
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(ghLog)}, \`\${process.argv.slice(2).join(' ')}\\n\`);
process.exit(1);
`,
  );
  writeCommandShim(
    fakeBinDir,
    'lefthook',
    `
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(lefthookLog)}, \`\${process.cwd()} \${process.argv.slice(2).join(' ')}\\n\`);
process.exit(0);
`,
  );

  return { fakeBinDir, ghLog, gitLog, lefthookLog };
}

function withFakeToolEnv(fakeBinDir: string) {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path');
  const activePathKey = pathKey ?? 'PATH';
  env[activePathKey] =
    `${fakeBinDir}${path.delimiter}${env[activePathKey] ?? ''}`;
  env.PATH = env[activePathKey];
  if (process.platform === 'win32') {
    env.Path = env[activePathKey];
    env.PATHEXT = `.CMD;.EXE;.BAT;.COM;${env.PATHEXT ?? ''}`;
  }
  const commandExtension = process.platform === 'win32' ? '.cmd' : '';
  env.ULTRAMODERN_GIT_BIN = path.join(fakeBinDir, `git${commandExtension}`);
  env.ULTRAMODERN_GH_BIN = path.join(fakeBinDir, `gh${commandExtension}`);
  env.ULTRAMODERN_LEFTHOOK_BIN = path.join(
    fakeBinDir,
    `lefthook${commandExtension}`,
  );
  env.ULTRAMODERN_CREATE_BIN = createBinPath;
  return env;
}

function withCreateBinEnv() {
  return {
    ...process.env,
    ULTRAMODERN_CREATE_BIN: createBinPath,
  };
}

test('bootstrap-agent-skills --postinstall installs vendored Codex skills and keeps user skills offline', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();

  try {
    fs.rmSync(path.join(workspaceDir, '.codex/skills/rsbuild-best-practices'), {
      force: true,
      recursive: true,
    });
    fs.mkdirSync(path.join(workspaceDir, '.codex/skills/local-user-skill'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspaceDir, '.codex/skills/local-user-skill/SKILL.md'),
      '# Local user skill\n',
      'utf-8',
    );
    const { fakeBinDir } = createFakeGitAndLefthookBin(tempRoot, {
      failNetwork: true,
      topLevel: undefined,
    });
    const env = withFakeToolEnv(fakeBinDir);
    delete env.ULTRAMODERN_CODEX_SKILLS;
    delete env.ULTRAMODERN_SKIP_CODEX_SKILLS;

    const result = spawnSync(
      process.execPath,
      ['scripts/bootstrap-agent-skills.mts', '--postinstall'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stderr,
      /Advisory: unable to install Codex skills from https:\/\/github.com\/module-federation\/agent-skills/,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          workspaceDir,
          '.codex/skills/rsbuild-best-practices/SKILL.md',
        ),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(workspaceDir, '.codex/skills/local-user-skill/SKILL.md'),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, '.codex/skills/mf')),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bootstrap-agent-skills --postinstall skips Lefthook in nested Git worktrees', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();

  try {
    const { fakeBinDir, gitLog, lefthookLog } = createFakeGitAndLefthookBin(
      tempRoot,
      { failNetwork: true, topLevel: tempRoot },
    );
    const env = withFakeToolEnv(fakeBinDir);
    delete env.ULTRAMODERN_CODEX_SKILLS;
    delete env.ULTRAMODERN_SKIP_CODEX_SKILLS;

    const result = spawnSync(
      process.execPath,
      ['scripts/bootstrap-agent-skills.mts', '--postinstall'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /nested inside another Git worktree/);
    assert.match(fs.readFileSync(gitLog, 'utf-8'), /rev-parse --show-toplevel/);
    assert.doesNotMatch(fs.readFileSync(gitLog, 'utf-8'), /^init -b main$/m);
    assert.equal(fs.existsSync(lefthookLog), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bootstrap-agent-skills --postinstall installs Lefthook for standalone generated repos', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();

  try {
    const { fakeBinDir, gitLog, lefthookLog } = createFakeGitAndLefthookBin(
      tempRoot,
      { failNetwork: true, topLevel: undefined },
    );
    const env = withFakeToolEnv(fakeBinDir);
    delete env.ULTRAMODERN_CODEX_SKILLS;
    delete env.ULTRAMODERN_SKIP_CODEX_SKILLS;

    const result = spawnSync(
      process.execPath,
      ['scripts/bootstrap-agent-skills.mts', '--postinstall'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(gitLog, 'utf-8'), /^init -b main$/m);
    assert.match(fs.readFileSync(lefthookLog, 'utf-8').trimEnd(), / install$/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bootstrap-agent-skills --postinstall supports documented Codex skill opt-outs', () => {
  for (const envPatch of [
    { ULTRAMODERN_SKIP_CODEX_SKILLS: '1' },
    { ULTRAMODERN_CODEX_SKILLS: '0' },
  ]) {
    const { tempRoot, workspaceDir } = scaffoldWorkspace();

    try {
      fs.rmSync(
        path.join(workspaceDir, '.codex/skills/rsbuild-best-practices'),
        {
          force: true,
          recursive: true,
        },
      );
      const { fakeBinDir } = createFakeGitAndLefthookBin(tempRoot, {
        topLevel: tempRoot,
      });
      const env = { ...withFakeToolEnv(fakeBinDir), ...envPatch };

      const result = spawnSync(
        process.execPath,
        ['scripts/bootstrap-agent-skills.mts', '--postinstall'],
        {
          cwd: workspaceDir,
          encoding: 'utf-8',
          env,
        },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        /Codex skills bootstrap skipped by environment/,
      );
      assert.equal(
        fs.existsSync(
          path.join(
            workspaceDir,
            '.codex/skills/rsbuild-best-practices/SKILL.md',
          ),
        ),
        false,
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test('skills:check advises about missing clone-backed Codex skills', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/bootstrap-agent-skills.mts', '--check'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env: withCreateBinEnv(),
      },
    );

    // Clone-backed skill bodies may be missing after offline postinstall.
    // Missing local bodies are advisory so CI can stay offline.
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Advisory: pinned Codex skills are not installed: .*mf.*run pnpm skills:install/,
    );
    assert.match(
      result.stdout,
      /Installed Codex skills: .*rsbuild-best-practices/,
    );
    assert.doesNotMatch(result.stderr, /clone-installed agent skills/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bootstrap-agent-skills resolves the agents-standard .agents/ lockfile layout', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();

  try {
    fs.mkdirSync(path.join(workspaceDir, '.agents'), { recursive: true });
    fs.renameSync(
      path.join(workspaceDir, '.codex/skills-lock.json'),
      path.join(workspaceDir, '.agents/skills-lock.json'),
    );

    const result = spawnSync(
      process.execPath,
      ['scripts/bootstrap-agent-skills.mts', '--check'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env: withCreateBinEnv(),
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /Missing skills-lock\.json/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('agent reference setup honors the configured Git hooks', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();

  try {
    const configPath = path.join(
      workspaceDir,
      '.agents/agent-reference-repos.json',
    );
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.repositories = [];
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const isolatedGitConfig = path.join(tempRoot, 'gitconfig');
    fs.writeFileSync(isolatedGitConfig, '');
    const gitEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: isolatedGitConfig,
      GIT_CONFIG_NOSYSTEM: '1',
    };

    let result = spawnSync('git', ['init', '-b', 'main'], {
      cwd: workspaceDir,
      encoding: 'utf-8',
      env: gitEnv,
    });
    assert.equal(result.status, 0, result.stderr);

    const hooksDir = path.join(workspaceDir, '.test-hooks');
    const hookMarker = path.join(tempRoot, 'pre-commit-ran');
    fs.mkdirSync(hooksDir);
    writeExecutable(
      path.join(hooksDir, 'pre-commit'),
      `#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(
        hookMarker,
      )}, 'ran\\n');\n`,
    );

    result = spawnSync(
      'git',
      ['config', '--local', 'core.hooksPath', '.test-hooks'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env: gitEnv,
      },
    );
    assert.equal(result.status, 0, result.stderr);

    result = spawnSync(
      process.execPath,
      ['scripts/setup-agent-reference-repos.mts'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env: {
          ...gitEnv,
          ULTRAMODERN_AGENT_REPOS_REQUIRED: '1',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(hookMarker, 'utf-8'), /^ran$/m);
    assert.equal(
      fs.existsSync(
        path.join(workspaceDir, '.modernjs/agent-reference-repos.json'),
      ),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
