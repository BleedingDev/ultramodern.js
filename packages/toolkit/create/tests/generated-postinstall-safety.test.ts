import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';

/**
 * Supply-chain guardrails for generated workspaces: a plain `pnpm install`
 * (postinstall) must never clone GitHub repositories or install system
 * packages with sudo. Repo cloning is an explicit opt-in (`pnpm
 * skills:install`, `pnpm agents:refs:install`, or ULTRAMODERN_AGENT_SKILLS=1).
 */

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
      strategy: 'install',
      modernPackageVersion: '3.2.0-ultramodern.108',
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
  options: { topLevel?: string },
) {
  const fakeBinDir = path.join(tempRoot, 'fake-bin');
  const gitLog = path.join(tempRoot, 'git.log');
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
process.exit(0);
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

  return { fakeBinDir, gitLog, lefthookLog };
}

test('generated postinstall never clones repositories or installs system packages', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();

  try {
    const rootPackage = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf-8'),
    );
    assert.equal(
      rootPackage.scripts.postinstall,
      "oxfmt . '!repos/**' && node ./scripts/bootstrap-agent-skills.mjs --postinstall",
      'postinstall must not chain the reference-repo installer',
    );
    // The explicit opt-in entry points must remain available.
    assert.equal(
      rootPackage.scripts['skills:install'],
      'node ./scripts/bootstrap-agent-skills.mjs',
    );
    assert.equal(
      rootPackage.scripts['agents:refs:install'],
      'node ./scripts/setup-agent-reference-repos.mjs',
    );

    const bootstrapScript = fs.readFileSync(
      path.join(workspaceDir, 'scripts/bootstrap-agent-skills.mjs'),
      'utf-8',
    );
    assert.ok(
      !bootstrapScript.includes("run('brew'") &&
        !bootstrapScript.includes('runShell('),
      'bootstrap script must not invoke system package managers',
    );
    assert.match(
      bootstrapScript,
      /never installs system packages/,
      'bootstrap script must fail with the actionable no-sudo message when git is missing',
    );

    const oxfmtConfig = fs.readFileSync(
      path.join(workspaceDir, 'oxfmt.config.ts'),
      'utf-8',
    );
    const oxlintConfig = fs.readFileSync(
      path.join(workspaceDir, 'oxlint.config.ts'),
      'utf-8',
    );
    for (const generatedOutputPattern of [
      "'.output'",
      "'**/modern-tanstack/**'",
      "'**/routeTree.gen.*'",
    ]) {
      assert.ok(oxfmtConfig.includes(generatedOutputPattern));
      assert.ok(oxlintConfig.includes(generatedOutputPattern));
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bootstrap-agent-skills --postinstall skips clones and exits cleanly offline', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();

  try {
    const env = { ...process.env };
    delete env.ULTRAMODERN_AGENT_SKILLS;
    delete env.ULTRAMODERN_SKIP_AGENT_SKILLS;

    const result = spawnSync(
      process.execPath,
      ['scripts/bootstrap-agent-skills.mjs', '--postinstall'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Skipping agent skill repository clones during postinstall/,
    );
    // The clone-installed mf skill must not have been fetched.
    assert.equal(
      fs.existsSync(path.join(workspaceDir, '.agents/skills/mf')),
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
      { topLevel: tempRoot },
    );
    const env = {
      ...process.env,
      PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };
    delete env.ULTRAMODERN_AGENT_SKILLS;
    delete env.ULTRAMODERN_SKIP_AGENT_SKILLS;

    const result = spawnSync(
      process.execPath,
      ['scripts/bootstrap-agent-skills.mjs', '--postinstall'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /nested inside another Git worktree/);
    assert.match(fs.readFileSync(gitLog, 'utf-8'), /rev-parse --show-toplevel/);
    assert.doesNotMatch(fs.readFileSync(gitLog, 'utf-8'), /^init\b/m);
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
      { topLevel: undefined },
    );
    const env = {
      ...process.env,
      PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };
    delete env.ULTRAMODERN_AGENT_SKILLS;
    delete env.ULTRAMODERN_SKIP_AGENT_SKILLS;

    const result = spawnSync(
      process.execPath,
      ['scripts/bootstrap-agent-skills.mjs', '--postinstall'],
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

test('skills:check passes with vendored skills and advises about clone-installed ones', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/bootstrap-agent-skills.mjs', '--check'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
      },
    );

    // Vendored skills ship with the scaffold, so the gate passes offline;
    // missing clone-installed skills surface as an advisory, not a failure.
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Advisory: clone-installed agent skills are not present: .*mf.*run pnpm skills:install/,
    );
    assert.doesNotMatch(result.stderr, /clone-installed agent skills/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
