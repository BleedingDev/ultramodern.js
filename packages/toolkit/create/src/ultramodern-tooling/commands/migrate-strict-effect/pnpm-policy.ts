import fs from 'node:fs';
import path from 'node:path';
import {
  DRIZZLE_ORM_VERSION,
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  MODULE_FEDERATION_VERSION,
} from '../../../ultramodern-workspace/versions';
import type { MigrationIo } from './io';
import {
  drizzleOrmDeclarationPatchPath,
  drizzleOrmDeclarationPatchSourcePath,
  effectDeclarationPatchPath,
  effectDeclarationPatchSourcePath,
  moduleFederationBridgeReactPatchPath,
  moduleFederationBridgeReactPatchSourcePath,
  moduleFederationModernJsPatchPath,
  moduleFederationModernJsPatchSourcePath,
  strictEffectPackageVersionPolicyExclusions,
} from './policy-constants';

function replaceYamlLine(source: string, pattern: RegExp, replacement: string) {
  const updated = source.replace(pattern, replacement);
  return {
    source: updated,
    changed: updated !== source,
  };
}

function ensureYamlListItem(source: string, key: string, item: string) {
  const itemLine = `  - '${item}'`;
  const headerPattern = new RegExp(`^${key}:\\n(?:(?:  - .+\\n)*)`, 'mu');
  const header = source.match(headerPattern);
  if (header) {
    if (header[0].split('\n').includes(itemLine)) {
      return { source, changed: false };
    }

    return {
      source: source.replace(headerPattern, `${header[0]}${itemLine}\n`),
      changed: true,
    };
  }

  const block = `${key}:\n${itemLine}\n`;
  const afterTrustPolicyIgnore = source.replace(
    /^(trustPolicyIgnoreAfter: .+\n)/mu,
    `$1${block}`,
  );
  if (afterTrustPolicyIgnore !== source) {
    return { source: afterTrustPolicyIgnore, changed: true };
  }

  return {
    source: `${source.trimEnd()}\n${block}`,
    changed: true,
  };
}

function yamlEntryPattern(entryKey: string, scalar = false): RegExp {
  const bareKey = entryKey.replace(/^['"]|['"]$/gu, '');
  if (scalar) {
    const esc = bareKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`^ {2}(?:'${esc}'|"${esc}"|${esc}): .+$`, 'gmu');
  }

  const packageName = bareKey.includes('@')
    ? bareKey.slice(0, bareKey.lastIndexOf('@'))
    : bareKey;
  const esc = packageName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(
    `^ {2}(?:'${esc}@[^']+'|"${esc}@[^"]+"|${esc}@[^:'"\\s]+): .+$`,
    'gmu',
  );
}

function upsertYamlEntry(
  source: string,
  key: string,
  entryLine: string,
  pattern: RegExp,
) {
  const linePattern = new RegExp(pattern.source, 'u');
  const lines = source.split('\n');
  let seen = false;
  let changed = false;
  const out: string[] = [];

  for (const line of lines) {
    if (linePattern.test(line)) {
      if (seen) {
        // Drop duplicate matching entries; the first match is canonical.
        changed = true;
        continue;
      }
      seen = true;
      if (line !== entryLine) {
        changed = true;
      }
      out.push(entryLine);
    } else {
      out.push(line);
    }
  }

  if (seen) {
    return { source: out.join('\n'), changed };
  }

  const headerPattern = new RegExp(`^${key}:\\n(?:(?:  .+\\n)*)`, 'mu');
  const header = source.match(headerPattern);
  if (header) {
    if (header[0].split('\n').includes(entryLine)) {
      return { source, changed: false };
    }

    return {
      source: source.replace(headerPattern, `${header[0]}${entryLine}\n`),
      changed: true,
    };
  }

  return {
    source: `${source.trimEnd()}\n${key}:\n${entryLine}\n`,
    changed: true,
  };
}

function ensureYamlMapEntry(
  source: string,
  key: string,
  entryKey: string,
  value: string,
) {
  return upsertYamlEntry(
    source,
    key,
    `  '${entryKey}': ${value}`,
    yamlEntryPattern(entryKey),
  );
}

function ensureYamlScalarMapEntry(
  source: string,
  key: string,
  entryKey: string,
  value: string,
) {
  return upsertYamlEntry(
    source,
    key,
    `  ${entryKey}: ${value}`,
    yamlEntryPattern(entryKey, true),
  );
}

function removeYamlMapEntry(source: string, entryKey: string) {
  const linePattern = new RegExp(yamlEntryPattern(entryKey).source, 'u');
  const lines = source.split('\n');
  let changed = false;
  const out: string[] = [];

  for (const line of lines) {
    if (linePattern.test(line)) {
      changed = true;
      continue;
    }
    out.push(line);
  }

  return changed ? { source: out.join('\n'), changed } : { source, changed };
}

function ensureGeneratedPatchFile(
  io: MigrationIo,
  relativePatchPath: string,
  sourcePatchPath: string,
) {
  const targetPath = path.join(io.workspaceRoot, relativePatchPath);
  const patch = fs.readFileSync(sourcePatchPath, 'utf-8');
  return io.write(targetPath, patch);
}

function removeGeneratedPatchFileIfUnchanged(
  io: MigrationIo,
  relativePatchPath: string,
  sourcePatchPath: string,
) {
  const targetPath = path.join(io.workspaceRoot, relativePatchPath);
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const patch = fs.readFileSync(sourcePatchPath, 'utf-8');
  if (fs.readFileSync(targetPath, 'utf-8') !== patch) {
    return false;
  }

  return io.remove(targetPath);
}

export function workspaceUsesDependency(
  workspaceRoot: string,
  packageName: string,
) {
  const packageJsonPaths = [path.join(workspaceRoot, 'package.json')];

  for (const workspaceDir of ['apps', 'verticals', 'packages']) {
    const absoluteWorkspaceDir = path.join(workspaceRoot, workspaceDir);
    if (!fs.existsSync(absoluteWorkspaceDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(absoluteWorkspaceDir, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = path.join(
        absoluteWorkspaceDir,
        entry.name,
        'package.json',
      );
      if (fs.existsSync(packageJsonPath)) {
        packageJsonPaths.push(packageJsonPath);
      }
    }
  }

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const dependencies = packageJson[field];
      if (!dependencies || typeof dependencies !== 'object') {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(dependencies, packageName)) {
        return true;
      }

      for (const specifier of Object.values(dependencies)) {
        if (
          typeof specifier === 'string' &&
          specifier.startsWith(`npm:${packageName}@`)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

export function ensureGeneratedDeclarationPatches(
  io: MigrationIo,
  options: { includeDrizzleOrmPatch: boolean },
) {
  let changed = false;
  changed =
    ensureGeneratedPatchFile(
      io,
      moduleFederationModernJsPatchPath,
      moduleFederationModernJsPatchSourcePath,
    ) || changed;
  changed =
    ensureGeneratedPatchFile(
      io,
      moduleFederationBridgeReactPatchPath,
      moduleFederationBridgeReactPatchSourcePath,
    ) || changed;
  changed =
    ensureGeneratedPatchFile(
      io,
      effectDeclarationPatchPath,
      effectDeclarationPatchSourcePath,
    ) || changed;
  if (options.includeDrizzleOrmPatch) {
    changed =
      ensureGeneratedPatchFile(
        io,
        drizzleOrmDeclarationPatchPath,
        drizzleOrmDeclarationPatchSourcePath,
      ) || changed;
  } else {
    changed =
      removeGeneratedPatchFileIfUnchanged(
        io,
        drizzleOrmDeclarationPatchPath,
        drizzleOrmDeclarationPatchSourcePath,
      ) || changed;
  }
  return changed;
}

export function updateGeneratedPnpmWorkspacePolicy(io: MigrationIo) {
  const workspaceFile = path.join(io.workspaceRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspaceFile)) {
    return false;
  }

  let source = fs.readFileSync(workspaceFile, 'utf-8');
  let changed = false;
  const usesDrizzleOrm = workspaceUsesDependency(
    io.workspaceRoot,
    'drizzle-orm',
  );

  const replacements: Array<[RegExp, string]> = [
    [
      /^ {4}'@effect\/vitest>effect': .+$/mu,
      `    '@effect/vitest>effect': '${EFFECT_VERSION}'`,
    ],
  ];

  for (const [pattern, replacement] of replacements) {
    const result = replaceYamlLine(source, pattern, replacement);
    source = result.source;
    changed = result.changed || changed;
  }

  for (const [entryKey, version] of [
    [`'@effect/opentelemetry'`, EFFECT_VERSION],
    [`'@effect/vitest'`, EFFECT_VITEST_VERSION],
    ['effect', EFFECT_VERSION],
  ]) {
    const result = ensureYamlScalarMapEntry(
      source,
      'overrides',
      entryKey,
      version,
    );
    source = result.source;
    changed = result.changed || changed;
  }

  const parcelWatcherBuildPolicy = ensureYamlScalarMapEntry(
    source,
    'allowBuilds',
    "'@parcel/watcher'",
    'true',
  );
  source = parcelWatcherBuildPolicy.source;
  changed = parcelWatcherBuildPolicy.changed || changed;

  for (const item of strictEffectPackageVersionPolicyExclusions) {
    const packageName = item.slice(0, item.lastIndexOf('@'));
    const escapedPackageName = packageName.replace(
      /[.*+?^${}()|[\]\\]/gu,
      '\\$&',
    );
    const currentVersion = replaceYamlLine(
      source,
      new RegExp(`^ {2}- '${escapedPackageName}@[^']+'$`, 'gmu'),
      `  - '${item}'`,
    );
    source = currentVersion.source;
    changed = currentVersion.changed || changed;

    for (const policyKey of [
      'minimumReleaseAgeExclude',
      'trustPolicyExclude',
    ]) {
      const policyExclude = ensureYamlListItem(source, policyKey, item);
      source = policyExclude.source;
      changed = policyExclude.changed || changed;
    }
  }

  const effectPatch = ensureYamlMapEntry(
    source,
    'patchedDependencies',
    `effect@${EFFECT_VERSION}`,
    effectDeclarationPatchPath,
  );
  source = effectPatch.source;
  changed = effectPatch.changed || changed;

  const moduleFederationModernJsPatch = ensureYamlMapEntry(
    source,
    'patchedDependencies',
    `@module-federation/modern-js-v3@${MODULE_FEDERATION_VERSION}`,
    moduleFederationModernJsPatchPath,
  );
  source = moduleFederationModernJsPatch.source;
  changed = moduleFederationModernJsPatch.changed || changed;

  const moduleFederationBridgeReactPatch = ensureYamlMapEntry(
    source,
    'patchedDependencies',
    `@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}`,
    moduleFederationBridgeReactPatchPath,
  );
  source = moduleFederationBridgeReactPatch.source;
  changed = moduleFederationBridgeReactPatch.changed || changed;

  const drizzleOrmPatch = usesDrizzleOrm
    ? ensureYamlMapEntry(
        source,
        'patchedDependencies',
        `drizzle-orm@${DRIZZLE_ORM_VERSION}`,
        drizzleOrmDeclarationPatchPath,
      )
    : removeYamlMapEntry(source, `drizzle-orm@${DRIZZLE_ORM_VERSION}`);
  source = drizzleOrmPatch.source;
  changed = drizzleOrmPatch.changed || changed;

  if (changed) {
    io.write(workspaceFile, source);
  }

  return changed;
}
