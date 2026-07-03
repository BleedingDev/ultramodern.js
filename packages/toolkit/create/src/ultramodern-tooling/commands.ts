import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCreatePackageRoot } from '../create-package-root';
import {
  BLEEDINGDEV_PACKAGE_NAME_PREFIX,
  BLEEDINGDEV_PACKAGE_SCOPE,
  modernPackageSpecifier,
  type ResolvedUltramodernPackageSource,
  ULTRAMODERN_SINGLE_APP_MODERN_PACKAGES,
  ULTRAMODERN_WORKSPACE_MODERN_PACKAGES,
  WORKSPACE_PACKAGE_VERSION,
} from '../ultramodern-package-source';
import { createAppEnvDts } from '../ultramodern-workspace/app-files';
import { createBackendFederationContractFile } from '../ultramodern-workspace/backend-federation';
import { validateModuleFederationTypes } from '../ultramodern-workspace/mf-validation';
import {
  createAppModernConfig,
  createUltramodernBuildModule,
  createUltramodernBuildReexportModule,
} from '../ultramodern-workspace/module-federation';
import {
  createAppMfTypesTsConfig,
  createAppTsConfig,
  createSharedPackageTsConfig,
  createTsConfigBase,
} from '../ultramodern-workspace/package-json';
import {
  GENERATED_TOOLING_COMMANDS,
  generatedToolingCommandList,
  generatedToolingCommands,
} from '../ultramodern-workspace/tooling-command-catalog';
import type { WorkspaceApp } from '../ultramodern-workspace/types';
import {
  DRIZZLE_ORM_VERSION,
  EFFECT_TSGO_VERSION,
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  MODULE_FEDERATION_VERSION,
  OXFMT_VERSION,
  OXLINT_VERSION,
  TYPESCRIPT_NATIVE_PREVIEW_VERSION,
  WRANGLER_VERSION,
  ZEPHYR_AGENT_VERSION,
  ZEPHYR_RSPACK_PLUGIN_VERSION,
} from '../ultramodern-workspace/versions';
import {
  createWorkspaceAppPackageScripts,
  createWorkspaceRootPackageScripts,
} from '../ultramodern-workspace/workspace-script-plan';
import {
  createWorkspaceValidationScript,
  createZeropsRuntimeMaterializationScript,
  writeGeneratedToolWrapperScripts,
} from '../ultramodern-workspace/workspace-scripts';
import { createZeropsYaml } from '../ultramodern-workspace/zerops';
import {
  readUltramodernConfig,
  type UltramodernToolingConfig,
  workspaceAppsFromToolingConfig,
} from './config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const createPackageRoot = resolveCreatePackageRoot(__dirname);

type CommandContext = {
  workspaceRoot: string;
  invocationCwd: string;
};

function printHelp() {
  const commands = [
    ...generatedToolingCommandList().map(command => `  ${command}`),
    '  skills install',
    '  skills check',
  ].join('\n');

  process.stdout.write(`Usage:
  modern-js-create ultramodern <command> [args]

Commands:
${commands}
`);
}

function spawnNodeScript(
  relativeScriptPath: string,
  args: string[],
  context: CommandContext,
  options: { cwd?: string } = {},
) {
  const scriptPath = path.join(createPackageRoot, relativeScriptPath);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd ?? context.workspaceRoot,
    env: {
      ...process.env,
      ULTRAMODERN_WORKSPACE_ROOT: context.workspaceRoot,
    },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function runTemplateBackedToolingCommand(
  command: string,
  args: string[],
  context: CommandContext,
) {
  const toolingCommand = generatedToolingCommands.find(
    candidate => candidate.command === command,
  );
  if (!toolingCommand?.templatePath) {
    return undefined;
  }

  return spawnNodeScript(toolingCommand.templatePath, args, context, {
    cwd:
      toolingCommand.cwd === 'invocation'
        ? context.invocationCwd
        : context.workspaceRoot,
  });
}

function runRenderedModule(source: string, context: CommandContext) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-tool-'));
  const tempFile = path.join(tempDir, 'command.mjs');

  try {
    fs.writeFileSync(tempFile, source, 'utf-8');
    const result = spawnSync(process.execPath, [tempFile], {
      cwd: context.workspaceRoot,
      stdio: 'inherit',
    });
    if (result.error) {
      throw result.error;
    }
    return result.status ?? 1;
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

function runValidate(context: CommandContext) {
  const config = readUltramodernConfig(context.workspaceRoot);
  const apps = workspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');
  const source = createWorkspaceValidationScript(
    config.workspace.packageScope,
    config.features.tailwind,
    remotes,
  );

  return runRenderedModule(source, context);
}

function runMfTypes(args: string[], context: CommandContext) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Usage:
  modern-js-create ultramodern mf-types [app-dir...]

Checks real Module Federation config files and DTS archives for exposed apps.
`);
    return 0;
  }

  validateModuleFederationTypes({
    workspaceRoot: context.workspaceRoot,
    appDirs: args.length > 0 ? args : undefined,
  });
  return 0;
}

const modernPackageNames = new Set<string>([
  ...ULTRAMODERN_SINGLE_APP_MODERN_PACKAGES,
  ...ULTRAMODERN_WORKSPACE_MODERN_PACKAGES,
]);

function readJsonFile(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJsonFile(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function readOption(args: string[], name: string) {
  const prefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  if (inline) {
    const value = inline.slice(prefix.length);
    if (!value) {
      throw new Error(`${name} needs a value.`);
    }
    return value;
  }

  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} needs a value.`);
  }
  return value;
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

function listWorkspacePackageFiles(workspaceRoot: string) {
  const packageFiles = ['package.json'];

  for (const directory of ['apps', 'verticals', 'packages']) {
    const absoluteDirectory = path.join(workspaceRoot, directory);
    if (!fs.existsSync(absoluteDirectory)) {
      continue;
    }

    for (const entry of fs.readdirSync(absoluteDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageFile = path.join(directory, entry.name, 'package.json');
      if (fs.existsSync(path.join(workspaceRoot, packageFile))) {
        packageFiles.push(packageFile);
      }
    }
  }

  return packageFiles;
}

function updateModernDependencies(
  packageJson: Record<string, any>,
  packageSource: ResolvedUltramodernPackageSource,
) {
  let changed = false;
  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const dependencies = packageJson[section];
    if (
      !dependencies ||
      typeof dependencies !== 'object' ||
      Array.isArray(dependencies)
    ) {
      continue;
    }

    for (const packageName of Object.keys(dependencies)) {
      if (!modernPackageNames.has(packageName)) {
        continue;
      }

      const nextSpecifier = modernPackageSpecifier(packageName, packageSource);
      if (dependencies[packageName] !== nextSpecifier) {
        dependencies[packageName] = nextSpecifier;
        changed = true;
      }
    }
  }

  return changed;
}

const generatedToolingDependencyPins = new Map<string, string>([
  ['@effect/tsgo', EFFECT_TSGO_VERSION],
  ['@typescript/native-preview', TYPESCRIPT_NATIVE_PREVIEW_VERSION],
  ['oxfmt', OXFMT_VERSION],
  ['oxlint', OXLINT_VERSION],
  ['wrangler', WRANGLER_VERSION],
  ['zephyr-agent', ZEPHYR_AGENT_VERSION],
  ['zephyr-rspack-plugin', ZEPHYR_RSPACK_PLUGIN_VERSION],
]);

const strictEffectPackageVersionPolicyExclusions = [
  `effect@${EFFECT_VERSION}`,
  `@effect/opentelemetry@${EFFECT_VERSION}`,
];
const moduleFederationModernJsPatchPath = `patches/@module-federation__modern-js-v3@${MODULE_FEDERATION_VERSION}.patch`;
const moduleFederationModernJsPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  moduleFederationModernJsPatchPath,
);
const moduleFederationBridgeReactPatchPath = `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`;
const moduleFederationBridgeReactPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  moduleFederationBridgeReactPatchPath,
);
const effectDeclarationPatchPath = 'patches/effect-schema-error-type-id.patch';
const effectDeclarationPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  effectDeclarationPatchPath,
);
const drizzleOrmDeclarationPatchPath =
  'patches/drizzle-orm-ts7-strict-declarations.patch';
const drizzleOrmDeclarationPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  drizzleOrmDeclarationPatchPath,
);

function updateGeneratedToolingDependencies(packageJson: Record<string, any>) {
  let changed = false;
  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const dependencies = packageJson[section];
    if (
      !dependencies ||
      typeof dependencies !== 'object' ||
      Array.isArray(dependencies)
    ) {
      continue;
    }

    for (const [packageName, version] of generatedToolingDependencyPins) {
      if (
        Object.prototype.hasOwnProperty.call(dependencies, packageName) &&
        dependencies[packageName] !== version
      ) {
        dependencies[packageName] = version;
        changed = true;
      }
    }
  }

  return changed;
}

const cloudflareModernDeployCommand =
  'ULTRAMODERN_ZEPHYR=false MODERNJS_DEPLOY=cloudflare modern deploy';
const cloudflareModernDeploySkipBuildCommand = `${cloudflareModernDeployCommand} --skip-build`;
const cloudflareWranglerDeployCommand =
  'wrangler deploy --config .output/wrangler.json';
const cloudflareWranglerDeployInvalidSkipBuildCommand = `${cloudflareWranglerDeployCommand} --skip-build`;

function removeStaleBackendFederationCommandSegments(command: string) {
  return command.replace(
    /\s+&&\s+node\s+\S*scripts\/generate-node-backend-federation\.m[ct]s(?:\s+--app\s+\S+)?(?:\s+--target\s+\S+)?(?=\s+&&|$)/gu,
    '',
  );
}

function updateGeneratedPackageScripts(
  packageJson: Record<string, any>,
  options: {
    relativePackageFile?: string;
    apps?: WorkspaceApp[];
  } = {},
) {
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return false;
  }

  let changed = false;
  const apps = options.apps ?? [];
  const app = apps.find(
    candidate =>
      `${candidate.directory}/package.json` === options.relativePackageFile,
  );

  const expectedScripts =
    options.relativePackageFile === 'package.json'
      ? createWorkspaceRootPackageScripts(
          apps.filter(candidate => candidate.kind !== 'shell'),
        )
      : app
        ? createWorkspaceAppPackageScripts(app)
        : undefined;

  if (expectedScripts) {
    for (const [name, value] of Object.entries(expectedScripts)) {
      if (scripts[name] !== value) {
        scripts[name] = value;
        changed = true;
      }
    }
  }

  const build = scripts.build;
  if (typeof build === 'string') {
    const nextBuild = removeStaleBackendFederationCommandSegments(build);
    if (nextBuild !== build) {
      scripts.build = nextBuild;
      changed = true;
    }
  }

  const cloudflareBuild = scripts['cloudflare:build'];
  if (typeof cloudflareBuild === 'string') {
    let nextCloudflareBuild =
      removeStaleBackendFederationCommandSegments(cloudflareBuild);
    if (
      nextCloudflareBuild.includes(cloudflareModernDeployCommand) &&
      !nextCloudflareBuild.includes(cloudflareModernDeploySkipBuildCommand)
    ) {
      nextCloudflareBuild = nextCloudflareBuild.replace(
        cloudflareModernDeployCommand,
        cloudflareModernDeploySkipBuildCommand,
      );
    }

    nextCloudflareBuild = nextCloudflareBuild.replace(
      / && node \S*scripts\/generate-public-surface-assets\.m[ct]s --app [^&]+ --target dist(?= && ULTRAMODERN_ZEPHYR=false MODERNJS_DEPLOY=cloudflare modern deploy --skip-build)/u,
      '',
    );
    nextCloudflareBuild = nextCloudflareBuild.replace(
      / && node \S*scripts\/verify-cloudflare-output\.m[ct]s(?: --app [^&]+)?/u,
      '',
    );
    if (nextCloudflareBuild !== cloudflareBuild) {
      scripts['cloudflare:build'] = nextCloudflareBuild;
      changed = true;
    }
  }

  const cloudflareDeploy = scripts['cloudflare:deploy'];
  if (
    typeof cloudflareDeploy === 'string' &&
    cloudflareDeploy.includes(cloudflareWranglerDeployInvalidSkipBuildCommand)
  ) {
    scripts['cloudflare:deploy'] = cloudflareDeploy.replace(
      cloudflareWranglerDeployInvalidSkipBuildCommand,
      cloudflareWranglerDeployCommand,
    );
    changed = true;
  }

  return changed;
}

function normalizeStrictEffectApiMetadata(value: Record<string, any>) {
  let changed = false;
  const backendFederation = value.backendFederation;
  if (
    backendFederation &&
    typeof backendFederation === 'object' &&
    !Array.isArray(backendFederation) &&
    Object.hasOwn(backendFederation, 'entry')
  ) {
    delete backendFederation.entry;
    changed = true;
  }

  const api = value.api;
  if (!api || typeof api !== 'object' || Array.isArray(api)) {
    return changed;
  }

  if (api.backendFederation !== undefined) {
    delete api.backendFederation;
    changed = true;
  }

  const oldEffect = api.effect;
  if (oldEffect && typeof oldEffect === 'object' && !Array.isArray(oldEffect)) {
    if (api.stem === undefined && typeof oldEffect.stem === 'string') {
      api.stem = oldEffect.stem;
      changed = true;
    }
    if (api.prefix === undefined && typeof oldEffect.prefix === 'string') {
      api.prefix = oldEffect.prefix;
      changed = true;
    }
    if (api.consumedBy === undefined && Array.isArray(oldEffect.consumedBy)) {
      api.consumedBy = oldEffect.consumedBy;
      changed = true;
    }
    delete api.effect;
    changed = true;
  }

  if (api.runtime !== undefined && api.runtime !== 'effect') {
    api.runtime = 'effect';
    changed = true;
  }

  if (api.bff && typeof api.bff === 'object' && !Array.isArray(api.bff)) {
    if (api.bff.strictEffectApproach !== true) {
      api.bff.strictEffectApproach = true;
      changed = true;
    }
  }

  if (typeof value.path === 'string') {
    const directServerEntry = `${value.path}/api/index.ts`;
    if (
      typeof api.serverEntry === 'string' &&
      /\/api\/effect\/index\.[cm]?[jt]sx?$/u.test(api.serverEntry)
    ) {
      api.serverEntry = directServerEntry;
      changed = true;
    }

    if (
      api.contract &&
      typeof api.contract === 'object' &&
      !Array.isArray(api.contract)
    ) {
      if (api.contract.export === './shared/effect/api') {
        api.contract.export = './api';
        changed = true;
      }
      if (
        typeof api.contract.path === 'string' &&
        /\/shared\/effect\/api\.[cm]?[jt]sx?$/u.test(api.contract.path)
      ) {
        api.contract.path = `${value.path}/shared/api.ts`;
        changed = true;
      }
    }

    if (
      api.client &&
      typeof api.client === 'object' &&
      !Array.isArray(api.client)
    ) {
      if (api.client.export === './effect/client') {
        api.client.export = './api/client';
        changed = true;
      }
      if (
        typeof api.client.path === 'string' &&
        /\/src\/effect\/[^/]+-client\.[cm]?ts$/u.test(api.client.path)
      ) {
        const basename = path.basename(api.client.path);
        api.client.path = `${value.path}/src/api/${basename}`;
        changed = true;
      }
    }

    if (api.serverEntry === undefined && api.runtime === 'effect') {
      api.serverEntry = directServerEntry;
      changed = true;
    }
  }

  return changed;
}

function removeGeneratedFileIfExists(
  workspaceRoot: string,
  relativePath: string,
) {
  const filePath = path.join(workspaceRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.rmSync(filePath);
  return true;
}

function removeStaleBackendFederationArtifacts(
  workspaceRoot: string,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  for (const relativePath of [
    'scripts/generate-node-backend-federation.mts',
    'scripts/proof-node-backend-federation.mts',
    'scripts/verify-cloudflare-output.mts',
  ]) {
    changed =
      removeGeneratedFileIfExists(workspaceRoot, relativePath) || changed;
  }

  for (const app of workspaceAppsFromToolingConfig(config)) {
    changed =
      removeGeneratedFileIfExists(
        workspaceRoot,
        path.join(app.directory, 'api/backend-federation.ts'),
      ) || changed;
  }

  return changed;
}

function updateGeneratedZeropsArtifacts(
  workspaceRoot: string,
  config: UltramodernToolingConfig,
) {
  const apps = workspaceAppsFromToolingConfig(config);
  let changed = writeTextIfChanged(
    path.join(workspaceRoot, 'zerops.yaml'),
    `${createZeropsYaml(config.workspace.packageScope, apps)}\n`,
  );
  changed =
    writeTextIfChanged(
      path.join(workspaceRoot, 'scripts/materialize-zerops-runtime.mjs'),
      createZeropsRuntimeMaterializationScript(),
    ) || changed;
  return changed;
}

function updateGeneratedBuildIdentityModules(
  workspaceRoot: string,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  for (const app of workspaceAppsFromToolingConfig(config)) {
    changed =
      writeTextIfChanged(
        path.join(workspaceRoot, app.directory, 'src/ultramodern-build.ts'),
        createUltramodernBuildReexportModule(),
      ) || changed;
    changed =
      writeTextIfChanged(
        path.join(workspaceRoot, app.directory, 'shared/ultramodern-build.ts'),
        createUltramodernBuildModule(config.workspace.packageScope, app),
      ) || changed;
  }
  return changed;
}

function updateGeneratedBackendFederationContractFiles(
  workspaceRoot: string,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  for (const app of workspaceAppsFromToolingConfig(config)) {
    if (!app.api) {
      continue;
    }
    changed =
      writeTextIfChanged(
        path.join(workspaceRoot, app.directory, 'api/backend-federation.ts'),
        createBackendFederationContractFile(app),
      ) || changed;
  }
  return changed;
}

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

function ensureYamlMapEntry(
  source: string,
  key: string,
  entryKey: string,
  value: string,
) {
  const entryLine = `  '${entryKey}': ${value}`;
  const packageName = entryKey.includes('@')
    ? entryKey.slice(0, entryKey.lastIndexOf('@'))
    : entryKey;
  const escapedPackageName = packageName.replace(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&',
  );
  const currentEntryPattern = new RegExp(
    `^ {2}'${escapedPackageName}@[^']+': .+$`,
    'mu',
  );
  const currentEntry = source.match(currentEntryPattern);
  if (currentEntry) {
    if (currentEntry[0] === entryLine) {
      return { source, changed: false };
    }

    return {
      source: source.replace(currentEntryPattern, entryLine),
      changed: true,
    };
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

function ensureYamlScalarMapEntry(
  source: string,
  key: string,
  entryKey: string,
  value: string,
) {
  const entryLine = `  ${entryKey}: ${value}`;
  const escapedEntryKey = entryKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const currentEntryPattern = new RegExp(`^ {2}${escapedEntryKey}: .+$`, 'mu');
  const currentEntry = source.match(currentEntryPattern);
  if (currentEntry) {
    if (currentEntry[0] === entryLine) {
      return { source, changed: false };
    }

    return {
      source: source.replace(currentEntryPattern, entryLine),
      changed: true,
    };
  }

  const headerPattern = new RegExp(`^${key}:\\n(?:(?:  .+\\n)*)`, 'mu');
  const header = source.match(headerPattern);
  if (header) {
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

function removeYamlMapEntry(source: string, entryKey: string) {
  const packageName = entryKey.includes('@')
    ? entryKey.slice(0, entryKey.lastIndexOf('@'))
    : entryKey;
  const escapedPackageName = packageName.replace(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&',
  );
  const currentEntryPattern = new RegExp(
    `^ {2}'${escapedPackageName}@[^']+': .+\\n?`,
    'mu',
  );

  if (!currentEntryPattern.test(source)) {
    return { source, changed: false };
  }

  return {
    source: source.replace(currentEntryPattern, ''),
    changed: true,
  };
}

function ensureGeneratedPatchFile(
  workspaceRoot: string,
  relativePatchPath: string,
  sourcePatchPath: string,
) {
  const targetPath = path.join(workspaceRoot, relativePatchPath);
  const patch = fs.readFileSync(sourcePatchPath, 'utf-8');
  if (
    fs.existsSync(targetPath) &&
    fs.readFileSync(targetPath, 'utf-8') === patch
  ) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, patch, 'utf-8');
  return true;
}

function removeGeneratedPatchFileIfUnchanged(
  workspaceRoot: string,
  relativePatchPath: string,
  sourcePatchPath: string,
) {
  const targetPath = path.join(workspaceRoot, relativePatchPath);
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const patch = fs.readFileSync(sourcePatchPath, 'utf-8');
  if (fs.readFileSync(targetPath, 'utf-8') !== patch) {
    return false;
  }

  fs.rmSync(targetPath);
  return true;
}

function workspaceUsesDependency(workspaceRoot: string, packageName: string) {
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

function ensureGeneratedDeclarationPatches(
  workspaceRoot: string,
  options: { includeDrizzleOrmPatch: boolean },
) {
  let changed = false;
  changed =
    ensureGeneratedPatchFile(
      workspaceRoot,
      moduleFederationModernJsPatchPath,
      moduleFederationModernJsPatchSourcePath,
    ) || changed;
  changed =
    ensureGeneratedPatchFile(
      workspaceRoot,
      moduleFederationBridgeReactPatchPath,
      moduleFederationBridgeReactPatchSourcePath,
    ) || changed;
  changed =
    ensureGeneratedPatchFile(
      workspaceRoot,
      effectDeclarationPatchPath,
      effectDeclarationPatchSourcePath,
    ) || changed;
  if (options.includeDrizzleOrmPatch) {
    changed =
      ensureGeneratedPatchFile(
        workspaceRoot,
        drizzleOrmDeclarationPatchPath,
        drizzleOrmDeclarationPatchSourcePath,
      ) || changed;
  } else {
    changed =
      removeGeneratedPatchFileIfUnchanged(
        workspaceRoot,
        drizzleOrmDeclarationPatchPath,
        drizzleOrmDeclarationPatchSourcePath,
      ) || changed;
  }
  return changed;
}

function updateGeneratedPnpmWorkspacePolicy(workspaceRoot: string) {
  const workspaceFile = path.join(workspaceRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspaceFile)) {
    return false;
  }

  let source = fs.readFileSync(workspaceFile, 'utf-8');
  let changed = false;
  const usesDrizzleOrm = workspaceUsesDependency(workspaceRoot, 'drizzle-orm');

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
    fs.writeFileSync(workspaceFile, source, 'utf-8');
  }

  return changed;
}

function updateUltramodernConfig(
  workspaceRoot: string,
  packageSource: ResolvedUltramodernPackageSource,
) {
  const configPath = path.join(workspaceRoot, '.modernjs/ultramodern.json');
  const config = readJsonFile(configPath);
  config.packageSource = {
    strategy: packageSource.strategy,
    modernPackageVersion: packageSource.modernPackageVersion,
    ...(packageSource.registry ? { registry: packageSource.registry } : {}),
    ...(packageSource.aliasScope
      ? { aliasScope: packageSource.aliasScope }
      : {}),
    ...(packageSource.aliasPackageNamePrefix
      ? { aliasPackageNamePrefix: packageSource.aliasPackageNamePrefix }
      : {}),
  };

  for (const app of config.topology?.apps ?? []) {
    if (app && typeof app === 'object' && !Array.isArray(app)) {
      normalizeStrictEffectApiMetadata(app);
    }
  }

  writeJsonFile(configPath, config);
}

function writeJsonIfChanged(filePath: string, value: unknown) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf-8') === next) {
    return false;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next, 'utf-8');
  return true;
}

function writeTextIfChanged(filePath: string, value: string) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf-8') === value) {
    return false;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf-8');
  return true;
}

function ensureGeneratedIgnoreRules(workspaceRoot: string) {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf-8')
    : '';
  const lines =
    existing.trimEnd().length === 0 ? [] : existing.trimEnd().split(/\r?\n/u);
  let changed = false;

  for (const rule of ['.mf/', '**/.mf/', 'dist-cloudflare/']) {
    if (!lines.includes(rule)) {
      lines.push(rule);
      changed = true;
    }
  }

  if (!changed) {
    return false;
  }

  const next = `${lines.join('\n')}\n`;
  fs.writeFileSync(gitignorePath, next, 'utf-8');
  return true;
}

function updateGeneratedTypeScriptSurfaces(
  workspaceRoot: string,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  const apps = workspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');

  changed =
    writeJsonIfChanged(
      path.join(workspaceRoot, 'tsconfig.base.json'),
      createTsConfigBase(),
    ) || changed;
  changed = ensureGeneratedIgnoreRules(workspaceRoot) || changed;

  for (const sharedPackage of [
    'packages/shared-contracts',
    'packages/shared-design-tokens',
  ]) {
    changed =
      writeJsonIfChanged(
        path.join(workspaceRoot, sharedPackage, 'tsconfig.json'),
        createSharedPackageTsConfig(sharedPackage),
      ) || changed;
  }

  for (const app of apps) {
    changed =
      writeJsonIfChanged(
        path.join(workspaceRoot, app.directory, 'tsconfig.json'),
        createAppTsConfig(app, remotes),
      ) || changed;
    changed =
      writeJsonIfChanged(
        path.join(workspaceRoot, app.directory, 'tsconfig.mf-types.json'),
        createAppMfTypesTsConfig(app),
      ) || changed;
    changed =
      writeTextIfChanged(
        path.join(workspaceRoot, app.directory, 'src/modern-app-env.d.ts'),
        createAppEnvDts(app, remotes),
      ) || changed;
  }

  return changed;
}

function updateGeneratedModernConfigs(
  workspaceRoot: string,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  const apps = workspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');

  for (const app of apps) {
    changed =
      writeTextIfChanged(
        path.join(workspaceRoot, app.directory, 'modern.config.ts'),
        createAppModernConfig(config.workspace.packageScope, app, remotes),
      ) || changed;
  }

  return changed;
}

function updateReferenceTopology(workspaceRoot: string) {
  const topologyPath = path.join(
    workspaceRoot,
    'topology/reference-topology.json',
  );
  if (!fs.existsSync(topologyPath)) {
    return false;
  }

  const topology = readJsonFile(topologyPath);
  let changed = false;
  for (const vertical of topology.verticals ?? []) {
    if (vertical && typeof vertical === 'object' && !Array.isArray(vertical)) {
      changed = normalizeStrictEffectApiMetadata(vertical) || changed;
    }
  }

  if (changed) {
    writeJsonFile(topologyPath, topology);
  }

  return changed;
}

function createMigrationPackageSource(
  args: string[],
  current: ReturnType<typeof readUltramodernConfig>,
): ResolvedUltramodernPackageSource {
  const strategy = hasFlag(args, '--workspace') ? 'workspace' : 'install';
  const registry =
    readOption(args, '--registry') ??
    readOption(args, '--ultramodern-package-registry');
  const explicitAliasScope =
    readOption(args, '--alias-scope') ??
    readOption(args, '--ultramodern-package-scope');
  const aliasScope =
    explicitAliasScope ??
    (strategy === 'install' && registry === undefined
      ? (current.packageSource?.aliasScope ?? BLEEDINGDEV_PACKAGE_SCOPE)
      : current.packageSource?.aliasScope);
  const aliasPackageNamePrefix =
    readOption(args, '--alias-package-name-prefix') ??
    readOption(args, '--ultramodern-package-name-prefix') ??
    current.packageSource?.aliasPackageNamePrefix ??
    (aliasScope ? BLEEDINGDEV_PACKAGE_NAME_PREFIX : undefined);

  if (strategy === 'workspace') {
    return {
      strategy,
      modernPackageVersion: WORKSPACE_PACKAGE_VERSION,
      ...(registry ? { registry } : {}),
      ...(aliasScope ? { aliasScope } : {}),
      ...(aliasPackageNamePrefix ? { aliasPackageNamePrefix } : {}),
    };
  }

  const version =
    readOption(args, '--version') ??
    readOption(args, '--ultramodern-package-version') ??
    current.packageSource?.modernPackageVersion;

  if (!version || version === WORKSPACE_PACKAGE_VERSION) {
    throw new Error(
      'migrate-strict-effect needs --version <published-ultramodern-version> for install package source.',
    );
  }

  return {
    strategy,
    modernPackageVersion: version,
    ...(registry ? { registry } : {}),
    ...(aliasScope ? { aliasScope } : {}),
    ...(aliasPackageNamePrefix ? { aliasPackageNamePrefix } : {}),
  };
}

function runPnpmLockfileRefresh(context: CommandContext) {
  const result = spawnSync(
    'pnpm',
    ['install', '--lockfile-only', '--ignore-scripts'],
    {
      cwd: context.workspaceRoot,
      stdio: 'inherit',
    },
  );

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function runMigrateStrictEffect(args: string[], context: CommandContext) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Usage:
  modern-js-create ultramodern migrate-strict-effect --version <version> [--skip-install]

Updates generated UltraModern package-source metadata, Modern package aliases,
framework-owned toolchain pins, direct Effect API topology metadata, strict
Effect pnpm overrides/trust policy, framework-owned TypeScript config
surfaces, and the pnpm lockfile. Source code still has to pass pnpm api:check
and pnpm contract:check.
`);
    return 0;
  }

  const current = readUltramodernConfig(context.workspaceRoot);
  const packageSource = createMigrationPackageSource(args, current);

  updateUltramodernConfig(context.workspaceRoot, packageSource);
  updateReferenceTopology(context.workspaceRoot);
  const migrated = readUltramodernConfig(context.workspaceRoot);
  const migratedApps = workspaceAppsFromToolingConfig(migrated);
  removeStaleBackendFederationArtifacts(context.workspaceRoot, migrated);
  writeGeneratedToolWrapperScripts(context.workspaceRoot);
  updateGeneratedZeropsArtifacts(context.workspaceRoot, migrated);
  updateGeneratedBackendFederationContractFiles(
    context.workspaceRoot,
    migrated,
  );
  updateGeneratedBuildIdentityModules(context.workspaceRoot, migrated);
  updateGeneratedTypeScriptSurfaces(context.workspaceRoot, migrated);
  updateGeneratedModernConfigs(context.workspaceRoot, migrated);

  for (const relativePackageFile of listWorkspacePackageFiles(
    context.workspaceRoot,
  )) {
    const packageFile = path.join(context.workspaceRoot, relativePackageFile);
    const packageJson = readJsonFile(packageFile);

    if (relativePackageFile === 'package.json') {
      packageJson.modernjs ??= {};
      packageJson.modernjs.packageSource = {
        strategy: packageSource.strategy,
        config: './.modernjs/ultramodern.json',
      };
    }

    const modernDependenciesChanged = updateModernDependencies(
      packageJson,
      packageSource,
    );
    const toolingDependenciesChanged =
      updateGeneratedToolingDependencies(packageJson);
    const generatedScriptsChanged = updateGeneratedPackageScripts(packageJson, {
      relativePackageFile,
      apps: migratedApps,
    });
    const changed =
      modernDependenciesChanged ||
      toolingDependenciesChanged ||
      generatedScriptsChanged;

    if (changed) {
      writeJsonFile(packageFile, packageJson);
    } else if (relativePackageFile === 'package.json') {
      writeJsonFile(packageFile, packageJson);
    }
  }

  updateGeneratedPnpmWorkspacePolicy(context.workspaceRoot);
  ensureGeneratedDeclarationPatches(context.workspaceRoot, {
    includeDrizzleOrmPatch: workspaceUsesDependency(
      context.workspaceRoot,
      'drizzle-orm',
    ),
  });

  if (!hasFlag(args, '--skip-install')) {
    const status = runPnpmLockfileRefresh(context);
    if (status !== 0) {
      return status;
    }
  }

  process.stdout.write(
    `UltraModern strict Effect metadata migrated to ${packageSource.modernPackageVersion}. Run pnpm api:check && pnpm contract:check next.\n`,
  );
  return 0;
}

function runSkills(args: string[], context: CommandContext) {
  const [subcommand, ...rest] = args;
  if (subcommand === 'install') {
    return spawnNodeScript(
      'template-workspace/scripts/bootstrap-agent-skills.mjs',
      rest,
      context,
    );
  }
  if (subcommand === 'check') {
    return spawnNodeScript(
      'template-workspace/scripts/bootstrap-agent-skills.mjs',
      ['--check', ...rest],
      context,
    );
  }

  throw new Error('Usage: modern-js-create ultramodern skills <install|check>');
}

interface CloudflareOutputVerifyTarget {
  label: string;
  outputDirectory: string;
}

const resolveCloudflareOutputVerifyTargets = (
  args: string[],
  context: CommandContext,
): CloudflareOutputVerifyTarget[] => {
  const outputDirectory = readOption(args, '--output');
  const appId = readOption(args, '--app');

  if (outputDirectory && appId) {
    throw new Error('Use either --app or --output, not both.');
  }

  const targets = outputDirectory
    ? [
        {
          label: outputDirectory,
          outputDirectory: path.resolve(context.invocationCwd, outputDirectory),
        },
      ]
    : workspaceAppsFromToolingConfig(
        readUltramodernConfig(context.workspaceRoot),
      )
        .filter(app => !appId || app.id === appId)
        .map(app => ({
          label: app.id,
          outputDirectory: path.join(
            context.workspaceRoot,
            app.directory,
            '.output',
          ),
        }));

  if (targets.length === 0) {
    throw new Error(`No generated UltraModern app matched ${appId}.`);
  }

  return targets;
};

const renderCloudflareOutputVerifyModule = ({
  workspaceRoot,
  targets,
  scanRoots,
  importWorker,
}: {
  workspaceRoot: string;
  targets: CloudflareOutputVerifyTarget[];
  scanRoots: string[];
  importWorker: boolean;
}) => `
import { createRequire } from 'node:module';
import path from 'node:path';

const workspaceRoot = ${JSON.stringify(workspaceRoot)};
const targets = ${JSON.stringify(targets, null, 2)};
const scanRoots = ${JSON.stringify(scanRoots)};
const verifierRequire = createRequire(path.join(workspaceRoot, 'package.json'));
const {
  verifyCloudflareOutput,
  verifyCloudflareOutputMutationPolicy,
} = verifierRequire('@modern-js/app-tools/cloudflare-output-verifier');

let failed = false;
for (const target of targets) {
  const result = await verifyCloudflareOutput({
    outputDirectory: target.outputDirectory,
    importWorker: ${JSON.stringify(importWorker)},
  });
  if (result.ok) {
    console.log(\`[ultramodern] Cloudflare output verified: \${target.label}\`);
  } else {
    failed = true;
    console.error(\`[ultramodern] Cloudflare output failed: \${target.label}\`);
    for (const issue of result.issues) {
      console.error(\`- \${issue.code}: \${issue.message}\${issue.path ? \` (\${issue.path})\` : ''}\`);
    }
  }
}

if (scanRoots.length > 0) {
  const policyResult = await verifyCloudflareOutputMutationPolicy({ scanRoots });
  if (!policyResult.ok) {
    failed = true;
    console.error('[ultramodern] generated-output mutation policy failed');
    for (const issue of policyResult.issues) {
      console.error(\`- \${issue.code}: \${issue.message}\${issue.path ? \` (\${issue.path})\` : ''}\`);
    }
  }
}

process.exit(failed ? 1 : 0);
`;

function runCloudflareOutputVerify(args: string[], context: CommandContext) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Usage:
  modern-js-create ultramodern cloudflare-output-verify [--app <id> | --output <dir>] [--no-import-worker] [--no-source-scan]

Verifies generated Cloudflare output against the UltraModern worker contract.
Without --app or --output, every generated workspace app is verified.
`);
    return 0;
  }

  const source = renderCloudflareOutputVerifyModule({
    workspaceRoot: context.workspaceRoot,
    targets: resolveCloudflareOutputVerifyTargets(args, context),
    scanRoots: hasFlag(args, '--no-source-scan') ? [] : [context.workspaceRoot],
    importWorker: !hasFlag(args, '--no-import-worker'),
  });

  return runRenderedModule(source, context);
}

export async function runUltramodernToolingCli(
  args: string[],
  workspaceRoot = process.env.ULTRAMODERN_WORKSPACE_ROOT ?? process.cwd(),
): Promise<number> {
  try {
    const [command, ...rest] = args;
    const context = {
      workspaceRoot: path.resolve(workspaceRoot),
      invocationCwd: process.cwd(),
    };

    switch (command) {
      case undefined:
      case '--help':
      case '-h':
        printHelp();
        return 0;
      case GENERATED_TOOLING_COMMANDS.validate.command:
        return runValidate(context);
      case GENERATED_TOOLING_COMMANDS.mfTypes.command:
        return runMfTypes(rest, context);
      case GENERATED_TOOLING_COMMANDS.migrateStrictEffect.command:
        return runMigrateStrictEffect(rest, context);
      case GENERATED_TOOLING_COMMANDS.cloudflareOutputVerify.command:
        return runCloudflareOutputVerify(rest, context);
      case 'skills':
        return runSkills(rest, context);
      default:
        {
          const templateBackedStatus = runTemplateBackedToolingCommand(
            command ?? '',
            rest,
            context,
          );
          if (templateBackedStatus !== undefined) {
            return templateBackedStatus;
          }
        }
        throw new Error(`Unknown UltraModern command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ultramodern] ${message}\n`);
    return 1;
  }
}
