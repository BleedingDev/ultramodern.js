import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

test('shell-only commands reference emitted capabilities and adding a vertical enables deployment proofs', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-profile-coherence-'),
  );
  const workspaceDir = path.join(tempRoot, 'profile-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'profile-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });

    const shellOnlyPackage = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf-8'),
    ) as { scripts?: Record<string, string> };
    assert.equal(fs.existsSync(path.join(workspaceDir, 'zerops.yaml')), false);
    assert.equal(
      fs.existsSync(
        path.join(workspaceDir, 'scripts/materialize-zerops-runtime.mjs'),
      ),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'scripts/proof-workerd-ssr.mts')),
      false,
    );
    assert.equal(shellOnlyPackage.scripts?.['zerops:materialize'], undefined);
    assert.equal(shellOnlyPackage.scripts?.['cloudflare:ssr-proof'], undefined);
    assert.doesNotMatch(
      shellOnlyPackage.scripts?.['cloudflare:build'] ?? '',
      /cloudflare:ssr-proof/u,
    );

    for (const [scriptName, command] of Object.entries(
      shellOnlyPackage.scripts ?? {},
    )) {
      for (const match of command.matchAll(/node \.\/(scripts\/[^\s'"&]+)/gu)) {
        assert.equal(
          fs.existsSync(path.join(workspaceDir, match[1])),
          true,
          `${scriptName} references missing ${match[1]}`,
        );
      }
    }

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const deliveryUnitPackage = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf-8'),
    ) as { scripts?: Record<string, string> };
    assert.equal(fs.existsSync(path.join(workspaceDir, 'zerops.yaml')), true);
    assert.equal(
      fs.existsSync(
        path.join(workspaceDir, 'scripts/materialize-zerops-runtime.mjs'),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'scripts/proof-workerd-ssr.mts')),
      true,
    );
    assert.equal(
      deliveryUnitPackage.scripts?.['zerops:materialize'],
      'node ./scripts/materialize-zerops-runtime.mjs',
    );
    assert.equal(
      deliveryUnitPackage.scripts?.['cloudflare:ssr-proof'],
      'node ./scripts/proof-workerd-ssr.mts',
    );
    assert.match(
      deliveryUnitPackage.scripts?.['cloudflare:build'] ?? '',
      /&& pnpm cloudflare:ssr-proof$/u,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('workspace validation accepts explicitly disabled agent instruction files', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-no-agent-instructions-'),
  );
  const workspaceDir = path.join(tempRoot, 'no-agent-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'no-agent-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      generateAgentFiles: false,
      packageSource: { strategy: 'workspace' },
    });

    assert.equal(fs.existsSync(path.join(workspaceDir, 'AGENTS.md')), false);
    assert.equal(fs.existsSync(path.join(workspaceDir, 'CLAUDE.md')), false);
    const result = spawnSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mts'],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          ULTRAMODERN_CREATE_BIN: path.resolve(__dirname, '../bin/run.js'),
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
