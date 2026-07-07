import fs from 'node:fs';
import path from 'node:path';
import { createAppEnvDts } from '../../../ultramodern-workspace/app-files';
import { createBackendFederationContractFile } from '../../../ultramodern-workspace/backend-federation';
import {
  createAppModernConfig,
  createUltramodernBuildArtifactJson,
  createUltramodernBuildModule,
  createUltramodernBuildReexportModule,
} from '../../../ultramodern-workspace/module-federation';
import {
  createAppMfTypesTsConfig,
  createAppTsConfig,
  createSharedPackageTsConfig,
  createTsConfigBase,
} from '../../../ultramodern-workspace/package-json';
import { createZeropsRuntimeMaterializationScript } from '../../../ultramodern-workspace/workspace-scripts';
import { createZeropsYaml } from '../../../ultramodern-workspace/zerops';
import {
  type UltramodernToolingConfig,
  workspaceAppsFromToolingConfig,
} from '../../config';
import { type MigrationIo, writeJsonIfChanged, writeTextIfChanged } from './io';

export function removeGeneratedFileIfExists(
  io: MigrationIo,
  relativePath: string,
) {
  return io.remove(path.join(io.workspaceRoot, relativePath));
}

export function removeStaleBackendFederationArtifacts(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  for (const relativePath of [
    'scripts/generate-node-backend-federation.mts',
    'scripts/proof-node-backend-federation.mts',
    'scripts/verify-cloudflare-output.mts',
  ]) {
    changed = removeGeneratedFileIfExists(io, relativePath) || changed;
  }

  for (const app of workspaceAppsFromToolingConfig(config)) {
    changed =
      removeGeneratedFileIfExists(
        io,
        path.join(app.directory, 'api/backend-federation.ts'),
      ) || changed;
  }

  return changed;
}

export function updateGeneratedZeropsArtifacts(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  const apps = workspaceAppsFromToolingConfig(config);
  let changed = writeTextIfChanged(
    io,
    path.join(io.workspaceRoot, 'zerops.yaml'),
    `${createZeropsYaml(config.workspace.packageScope, apps)}\n`,
  );
  changed =
    writeTextIfChanged(
      io,
      path.join(io.workspaceRoot, 'scripts/materialize-zerops-runtime.mjs'),
      createZeropsRuntimeMaterializationScript(),
    ) || changed;
  return changed;
}

export function updateGeneratedBuildIdentityModules(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  for (const app of workspaceAppsFromToolingConfig(config)) {
    changed =
      writeTextIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'src/ultramodern-build.ts'),
        createUltramodernBuildReexportModule(),
      ) || changed;
    changed =
      writeTextIfChanged(
        io,
        path.join(
          io.workspaceRoot,
          app.directory,
          'shared/ultramodern-build.ts',
        ),
        createUltramodernBuildModule(),
      ) || changed;
    changed =
      writeTextIfChanged(
        io,
        path.join(
          io.workspaceRoot,
          app.directory,
          'shared/ultramodern-build.json',
        ),
        createUltramodernBuildArtifactJson(config.workspace.packageScope, app),
      ) || changed;
  }
  return changed;
}

export function updateGeneratedBackendFederationContractFiles(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  for (const app of workspaceAppsFromToolingConfig(config)) {
    if (!app.api) {
      continue;
    }
    changed =
      writeTextIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'api/backend-federation.ts'),
        createBackendFederationContractFile(app),
      ) || changed;
  }
  return changed;
}

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

export function updateGeneratedModernConfigs(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  const apps = workspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');

  for (const app of apps) {
    changed =
      writeTextIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'modern.config.ts'),
        createAppModernConfig(config.workspace.packageScope, app, remotes),
      ) || changed;
  }

  return changed;
}

export function ensureGeneratedOxfmtIgnorePatterns(io: MigrationIo) {
  const configPath = path.join(io.workspaceRoot, 'oxfmt.config.ts');
  if (!fs.existsSync(configPath)) {
    return false;
  }

  const source = fs.readFileSync(configPath, 'utf-8');
  const requiredPatterns = [
    '.modernjs',
    '.output',
    '**/modern-tanstack/**',
    '**/routeTree.gen.*',
  ];

  const warnUnparseable = () => {
    const message =
      `Could not update oxfmt.config.ts ignorePatterns automatically; ` +
      `add these entries manually: ${requiredPatterns.join(', ')}.`;
    if (io.dryRun) {
      io.log(message);
    } else {
      process.stderr.write(`[ultramodern] ${message}\n`);
    }
  };

  const anchor = source.indexOf('ignorePatterns:');
  if (anchor === -1) {
    warnUnparseable();
    return false;
  }

  const openBracket = source.indexOf('[', anchor);
  if (openBracket === -1) {
    warnUnparseable();
    return false;
  }

  // Bracket-match to find the matching closing ], skipping brackets inside
  // string literals (e.g. a glob like '**/[locale]/**').
  let depth = 0;
  let closeBracket = -1;
  let stringQuote: string | undefined;
  for (let index = openBracket; index < source.length; index += 1) {
    const char = source[index];
    if (stringQuote) {
      if (char === '\\') {
        index += 1;
      } else if (char === stringQuote) {
        stringQuote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      stringQuote = char;
    } else if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        closeBracket = index;
        break;
      }
    }
  }

  if (closeBracket === -1) {
    warnUnparseable();
    return false;
  }

  const body = source.slice(openBracket + 1, closeBracket);
  // Reject dynamic/spread ignorePattern arrays we cannot safely edit.
  if (body.includes('...')) {
    warnUnparseable();
    return false;
  }

  const literalPattern = /(['"`])((?:\\.|(?!\1).)*)\1/g;
  const existing = new Set<string>();
  for (const match of body.matchAll(literalPattern)) {
    existing.add(match[2]);
  }

  const missing = requiredPatterns.filter(pattern => !existing.has(pattern));
  if (missing.length === 0) {
    return false;
  }

  // Derive indentation and quote style from the last existing literal line.
  const bodyLines = body.split('\n');
  let indent = '  ';
  let quote = "'";
  for (let index = bodyLines.length - 1; index >= 0; index -= 1) {
    const literal = bodyLines[index].match(/^(\s*)(['"`])/u);
    if (literal) {
      indent = literal[1];
      quote = literal[2];
      break;
    }
  }

  const head = source.slice(0, closeBracket);
  const rest = source.slice(closeBracket);
  const tailMatch = head.match(/(\r?\n[ \t]*)$/u);
  const tail = tailMatch ? tailMatch[1] : '\n';
  let bodyContent = tailMatch ? head.slice(0, head.length - tail.length) : head;
  if (!/[[,]\s*$/u.test(bodyContent)) {
    bodyContent = `${bodyContent},`;
  }

  const insertionLines = missing
    .map(pattern => `${indent}${quote}${pattern}${quote},`)
    .join('\n');
  const nextSource = `${bodyContent}\n${insertionLines}${tail}${rest}`;

  return io.write(configPath, nextSource);
}
