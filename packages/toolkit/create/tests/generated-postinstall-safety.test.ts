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

test('skills:check passes with vendored skills and warns about clone-installed ones', () => {
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
    // missing clone-installed skills surface as a warning, not a failure.
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stderr,
      /Clone-installed agent skills not present: .*mf.*Run pnpm skills:install/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
