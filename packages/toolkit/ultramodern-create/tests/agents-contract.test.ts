import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { PNPM_VERSION } from '../src/ultramodern-workspace/versions';

test('generated AGENTS.md stays minimal and uses shared references', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-agents-contract-'),
  );
  const workspaceDir = path.join(tempRoot, 'workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'agents-contract-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });

    const agentsPath = path.join(workspaceDir, 'AGENTS.md');
    const agents = fs.readFileSync(agentsPath, 'utf-8');
    const wordCount = agents.match(/\S+/gu)?.length ?? 0;

    assert.ok(
      wordCount <= 150,
      `generated AGENTS.md must stay within 150 words, received ${wordCount}`,
    );
    assert.match(agents, /UltraModern\.js SuperApp/u);
    assert.ok(agents.includes(`Node \`>=26\` and pnpm \`${PNPM_VERSION}\``));
    assert.match(agents, /`pnpm check`/u);
    assert.match(agents, /`pnpm build`/u);
    assert.match(agents, /\[README\.md\]\(\.\/README\.md\)/u);
    assert.match(agents, /\.codex\/skills/u);
    assert.doesNotMatch(
      agents,
      /Required Skill Baseline|Private Skills|Agent Reference Repositories|Skill Provenance|Generated CI|stop hooks|MODERN_PUBLIC_SITE_URL|ULTRAMODERN_ASSET_PREFIX|presetUltramodern|migration tooling|codemods/u,
    );

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'verticals/catalog/AGENTS.md')),
      false,
      'verticals must reuse root references instead of duplicating AGENTS.md',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
