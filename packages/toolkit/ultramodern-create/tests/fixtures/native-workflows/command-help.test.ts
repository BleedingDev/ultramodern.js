import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from '@rstest/core';
import {
  detectApiProtocolFlag,
  detectHorizontalRemoteFlag,
  detectPresetFlag,
  resolveVerticalCliInput,
} from '../../../src/cli/flags';
import { shellApp } from '../../../src/ultramodern-workspace/descriptors';
import {
  GENERATED_TOOLING_COMMANDS,
  generatedToolingCommandList,
  selectGeneratedToolingCommands,
} from '../../../src/ultramodern-workspace/tooling-command-catalog';
import {
  createWorkspaceAppPackageScripts,
  createWorkspaceRootPackageScripts,
} from '../../../src/ultramodern-workspace/workspace-script-plan';

const commands = JSON.parse(
  fs.readFileSync(new URL('./commands.json', import.meta.url), 'utf8'),
);

test('documented acceptance does not duplicate API and contract checks', () => {
  const scripts = createWorkspaceRootPackageScripts();
  assert.equal(scripts.check?.split('pnpm api:check:files').length, 2);
  assert.equal(scripts.check?.split('pnpm contract:check').length, 2);
  assert.equal(scripts.check?.includes('pnpm node:proof'), false);
  assert.equal(scripts['node:proof'], undefined);
  assert.equal(scripts['node:backend-federation:generate'], undefined);
  assert.equal(
    selectGeneratedToolingCommands({ hasBackendSurface: false }).some(
      command => command.requiresBackendSurface,
    ),
    false,
  );
  const app = createWorkspaceAppPackageScripts(shellApp);
  assert.equal(app.serve, 'ultramodern serve');
  assert.equal(
    app['cloudflare:preview'],
    'pnpm run cloudflare:build && wrangler dev --config .output/wrangler.json',
  );
});

test('documented vertical arguments pass the existing CLI parsers', () => {
  for (const key of [
    'addVertical',
    'addHeadless',
    'addUiOnly',
    'addHorizontal',
    'addRpc',
  ]) {
    const args = commands[key];
    const input = resolveVerticalCliInput(args);
    assert.equal(input.addVertical, true);
    assert.equal(input.name, args[0]);
  }
  assert.equal(detectPresetFlag(commands.addHeadless), 'api-only');
  assert.equal(detectPresetFlag(commands.addUiOnly), 'ui-only');
  assert.equal(detectHorizontalRemoteFlag(commands.addHorizontal), true);
  assert.equal(detectApiProtocolFlag(commands.addRpc), 'rpc');
});
