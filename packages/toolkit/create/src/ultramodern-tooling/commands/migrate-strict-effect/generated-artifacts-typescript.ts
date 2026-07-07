import fs from 'node:fs';
import path from 'node:path';
import { createAppEnvDts } from '../../../ultramodern-workspace/app-files';
import {
  createAppMfTypesTsConfig,
  createAppTsConfig,
  createSharedPackageTsConfig,
  createTsConfigBase,
} from '../../../ultramodern-workspace/package-json';
import {
  type UltramodernToolingConfig,
  workspaceAppsFromToolingConfig,
} from '../../config';
import { type MigrationIo, writeJsonIfChanged, writeTextIfChanged } from './io';

function ensureGeneratedIgnoreRules(io: MigrationIo) {
  const gitignorePath = path.join(io.workspaceRoot, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf-8')
    : '';
  const lines =
    existing.trimEnd().length === 0 ? [] : existing.trimEnd().split(/\r?\n/u);
  let changed = false;

  for (const rule of [
    '.mf/',
    '**/.mf/',
    'dist-cloudflare/',
    '.output/',
    '**/.output/',
    '.modern-js/',
    '**/.modern-js/',
  ]) {
    if (!lines.includes(rule)) {
      lines.push(rule);
      changed = true;
    }
  }

  if (!changed) {
    return false;
  }

  return io.write(gitignorePath, `${lines.join('\n')}\n`);
}

export function updateGeneratedTypeScriptSurfaces(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  const apps = workspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');

  changed =
    writeJsonIfChanged(
      io,
      path.join(io.workspaceRoot, 'tsconfig.base.json'),
      createTsConfigBase(),
    ) || changed;
  changed = ensureGeneratedIgnoreRules(io) || changed;

  for (const sharedPackage of [
    'packages/shared-contracts',
    'packages/shared-design-tokens',
  ]) {
    changed =
      writeJsonIfChanged(
        io,
        path.join(io.workspaceRoot, sharedPackage, 'tsconfig.json'),
        createSharedPackageTsConfig(sharedPackage),
      ) || changed;
  }

  for (const app of apps) {
    changed =
      writeJsonIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'tsconfig.json'),
        createAppTsConfig(app, remotes),
      ) || changed;
    changed =
      writeJsonIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'tsconfig.mf-types.json'),
        createAppMfTypesTsConfig(app),
      ) || changed;
    changed =
      writeTextIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'src/modern-app-env.d.ts'),
        createAppEnvDts(app, remotes),
      ) || changed;
  }

  return changed;
}
