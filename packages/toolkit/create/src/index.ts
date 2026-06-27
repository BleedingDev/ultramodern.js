import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolveCreatePackageRoot } from './create-package-root';
import { i18n, localeKeys } from './locale';
import {
  BLEEDINGDEV_CREATE_PACKAGE,
  BLEEDINGDEV_FRAMEWORK_VERSION_ENV,
  BLEEDINGDEV_PACKAGE_NAME_PREFIX,
  BLEEDINGDEV_PACKAGE_SCOPE,
  type ResolvedUltramodernPackageSource,
  WORKSPACE_PACKAGE_VERSION,
} from './ultramodern-package-source';
import { runUltramodernToolingCli } from './ultramodern-tooling/commands';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
  planUltramodernVertical,
} from './ultramodern-workspace';
import {
  hasUltramodernBridgeCliOptions,
  parseUltramodernBridgeCliOptions,
  ultramodernBridgeCliBooleanFlags,
  ultramodernBridgeCliValueFlags,
} from './ultramodern-workspace/bridge-config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const createPackageRoot = resolveCreatePackageRoot(__dirname);
type UltramodernPackageSource = ResolvedUltramodernPackageSource;
type CreatePackageJson = {
  name?: string;
  version?: string;
  ultramodern?: {
    frameworkVersion?: string;
  };
};

const semverPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const LEGACY_MODERN_JS_FLAG = '--legacy-modern-js';
const LEGACY_MODERN_JS_CONFIRMATION = 'USE LEGACY MODERN.JS';
const WORKSPACE_PROTOCOL_FLAG = '--workspace';
const DRY_RUN_FLAG = '--dry-run';
const VERTICAL_FLAG = '--vertical';
const VERTICAL_NAME_FLAG = '--vertical-name';
const CODESMITH_OVERLAY_FLAG = '--codesmith-overlay';
const BFF_FLAG = '--bff';
const BFF_RUNTIME_OPTION = '--bff-runtime';
const SUPPORTED_BFF_RUNTIMES = ['effect'] as const;
const REGISTRY_LOOKUP_TIMEOUT_MS = 15_000;

type SupportedBffRuntime = (typeof SUPPORTED_BFF_RUNTIMES)[number];

function getOptionValue(args: string[], names: string[]): string | undefined {
  for (const name of names) {
    const prefix = `${name}=`;
    const byEquals = args.find(arg => arg.startsWith(prefix));
    if (byEquals) {
      return byEquals.slice(prefix.length);
    }

    const index = args.findIndex(arg => arg === name);
    if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('-')) {
      return args[index + 1];
    }
  }

  return undefined;
}

const detectLanguage = (): 'zh' | 'en' => {
  const lang = getOptionValue(process.argv.slice(2), ['--lang', '-l']);
  if (lang === 'zh') {
    return 'zh';
  }

  return 'en';
};

i18n.changeLanguage({ locale: detectLanguage() });

function readCreatePackageJson(): CreatePackageJson {
  const createPackageJson = path.join(createPackageRoot, 'package.json');
  return JSON.parse(fs.readFileSync(createPackageJson, 'utf-8'));
}

function isBleedingDevCreatePackage(createPackage: CreatePackageJson): boolean {
  return createPackage.name === BLEEDINGDEV_CREATE_PACKAGE;
}

function getBleedingDevFrameworkVersion(
  createPackage: CreatePackageJson,
  fallbackVersion: string,
): string {
  const frameworkVersion = createPackage.ultramodern?.frameworkVersion;
  return typeof frameworkVersion === 'string' && frameworkVersion.length > 0
    ? frameworkVersion
    : fallbackVersion;
}

function showVersion() {
  const createPackage = readCreatePackageJson();
  const name = createPackage.name || '@modern-js/create';
  const version = createPackage.version || 'unknown';
  console.log(i18n.t(localeKeys.version.message, { name, version }));
  process.exit(0);
}

function showHelp() {
  console.log(i18n.t(localeKeys.help.title));
  console.log(i18n.t(localeKeys.help.description));
  console.log('');
  console.log(i18n.t(localeKeys.help.usage));
  console.log(i18n.t(localeKeys.help.usageExample));
  console.log('');
  console.log(i18n.t(localeKeys.help.options));
  console.log(i18n.t(localeKeys.help.optionHelp));
  console.log(i18n.t(localeKeys.help.optionVersion));
  console.log(i18n.t(localeKeys.help.optionLang));
  console.log(i18n.t(localeKeys.help.optionTailwind));
  console.log(i18n.t(localeKeys.help.optionBff));
  console.log(i18n.t(localeKeys.help.optionBffRuntime));
  console.log(i18n.t(localeKeys.help.optionWorkspace));
  console.log(i18n.t(localeKeys.help.optionUltramodernPackageSource));
  console.log(i18n.t(localeKeys.help.optionUltramodernPackageVersion));
  console.log(i18n.t(localeKeys.help.optionUltramodernPackageRegistry));
  console.log(i18n.t(localeKeys.help.optionUltramodernPackageScope));
  console.log(i18n.t(localeKeys.help.optionUltramodernPackageNamePrefix));
  console.log(i18n.t(localeKeys.help.optionBridge));
  console.log(i18n.t(localeKeys.help.optionBridgeParentRoot));
  console.log(i18n.t(localeKeys.help.optionBridgeWorkspacePackage));
  console.log(i18n.t(localeKeys.help.optionBridgeWorkspacePackageName));
  console.log(i18n.t(localeKeys.help.optionBridgeTestAlias));
  console.log(i18n.t(localeKeys.help.optionBridgeDependency));
  console.log(i18n.t(localeKeys.help.optionBridgeLockfilePolicy));
  console.log(i18n.t(localeKeys.help.optionBridgeGate));
  console.log(i18n.t(localeKeys.help.optionBridgeGateCwd));
  console.log(i18n.t(localeKeys.help.optionBridgeReactSingleton));
  console.log(i18n.t(localeKeys.help.optionVertical));
  console.log(i18n.t(localeKeys.help.optionVerticalName));
  console.log(i18n.t(localeKeys.help.optionDryRun));
  console.log(i18n.t(localeKeys.help.optionCodeSmithOverlay));
  console.log(i18n.t(localeKeys.help.optionLegacyModernJs));
  console.log('');
  console.log(i18n.t(localeKeys.help.examples));
  console.log(i18n.t(localeKeys.help.example1));
  console.log(i18n.t(localeKeys.help.example2));
  console.log(i18n.t(localeKeys.help.example3));
  console.log(i18n.t(localeKeys.help.example4));
  console.log(i18n.t(localeKeys.help.example5));
  console.log(i18n.t(localeKeys.help.example6));
  console.log(i18n.t(localeKeys.help.example7));
  console.log(i18n.t(localeKeys.help.example8));
  console.log(i18n.t(localeKeys.help.example9));
  console.log(i18n.t(localeKeys.help.example10));
  console.log('');
  console.log(i18n.t(localeKeys.help.moreInfo));
  console.log('');
  process.exit(0);
}

function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function detectLegacyModernJsFlag(args: string[]): boolean {
  if (args.some(arg => arg.startsWith(`${LEGACY_MODERN_JS_FLAG}=`))) {
    console.error(`${LEGACY_MODERN_JS_FLAG} does not accept a value.`);
    process.exit(1);
  }

  return args.includes(LEGACY_MODERN_JS_FLAG);
}

function stripLegacyModernJsArgs(args: string[]): string[] {
  return args.filter(arg => arg !== LEGACY_MODERN_JS_FLAG);
}

async function confirmLegacyModernJsSetup() {
  console.error('');
  console.error(i18n.t(localeKeys.message.legacyModernJsWarning));
  console.error('');

  const answer = await promptInput(
    i18n.t(localeKeys.prompt.legacyModernJsConfirmation, {
      confirmation: LEGACY_MODERN_JS_CONFIRMATION,
    }),
  );

  if (answer !== LEGACY_MODERN_JS_CONFIRMATION) {
    console.error(i18n.t(localeKeys.error.legacyModernJsNotConfirmed));
    process.exit(1);
  }
}

function delegateLegacyModernJsSetup(args: string[]) {
  const forwardedArgs = stripLegacyModernJsArgs(args);

  if (commandExists('pnpm')) {
    runSetupCommand('pnpm', ['dlx', '@modern-js/create', ...forwardedArgs], {
      stdio: 'inherit',
    });
    return;
  }

  if (commandExists('npx')) {
    runSetupCommand('npx', ['@modern-js/create', ...forwardedArgs], {
      stdio: 'inherit',
    });
    return;
  }

  throw new Error(
    'Legacy Modern.js setup requires pnpm or npx to run @modern-js/create.',
  );
}

// The UltraModern scaffold ships exactly one BFF shape: every MicroVertical
// exposes an Effect BFF (plugin-bff runtimeFramework 'effect'). `--bff` keeps
// working as an explicit opt-in to that default; `--bff-runtime` selects the
// runtime and rejects anything the workspace generator cannot scaffold (the
// pre-UltraModern hono single-app scaffold was removed together with the old
// CLI).
function detectBffRuntime(args: string[]): SupportedBffRuntime {
  if (args.some(arg => arg.startsWith(`${BFF_FLAG}=`))) {
    console.error(
      `${BFF_FLAG} does not accept a value. Use: ${BFF_RUNTIME_OPTION} <runtime>`,
    );
    process.exit(1);
  }

  const runtimeRequested = args.some(
    arg =>
      arg === BFF_RUNTIME_OPTION || arg.startsWith(`${BFF_RUNTIME_OPTION}=`),
  );
  if (!runtimeRequested) {
    return 'effect';
  }

  const runtime = getOptionValue(args, [BFF_RUNTIME_OPTION]);
  if (!runtime) {
    console.error(
      `${BFF_RUNTIME_OPTION} requires a value (supported: ${SUPPORTED_BFF_RUNTIMES.join(', ')})`,
    );
    process.exit(1);
  }

  if (!(SUPPORTED_BFF_RUNTIMES as readonly string[]).includes(runtime)) {
    console.error(
      `Unsupported BFF runtime "${runtime}". UltraModern workspaces scaffold an Effect BFF for every MicroVertical (supported: ${SUPPORTED_BFF_RUNTIMES.join(', ')}).`,
    );
    process.exit(1);
  }

  return runtime as SupportedBffRuntime;
}

function detectTailwindFlag(): boolean {
  const args = process.argv.slice(2);
  return !args.includes('--no-tailwind');
}

function detectExplicitTailwindFlag(): boolean | undefined {
  const args = process.argv.slice(2);
  if (args.includes('--no-tailwind')) {
    return false;
  }
  if (args.includes('--tailwind')) {
    return true;
  }
  return undefined;
}

type VerticalCliInput =
  | {
      addVertical: false;
    }
  | {
      addVertical: true;
      name: string;
    };

type VerticalNameCandidate = {
  value: string;
  source: string;
};

function collectPositionalArgs(args: string[]): string[] {
  const optionWithValue = new Set([
    '--lang',
    '-l',
    BFF_RUNTIME_OPTION,
    '--ultramodern-package-source',
    '--ultramodern-package-version',
    '--ultramodern-package-registry',
    '--ultramodern-package-scope',
    '--ultramodern-package-name-prefix',
    VERTICAL_NAME_FLAG,
    CODESMITH_OVERLAY_FLAG,
    ...ultramodernBridgeCliValueFlags,
  ]);
  const optionWithoutValue = new Set([
    '--help',
    '-h',
    '--version',
    '-v',
    '--tailwind',
    '--no-tailwind',
    BFF_FLAG,
    WORKSPACE_PROTOCOL_FLAG,
    DRY_RUN_FLAG,
    VERTICAL_FLAG,
    LEGACY_MODERN_JS_FLAG,
    ...ultramodernBridgeCliBooleanFlags,
  ]);
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (optionWithoutValue.has(arg)) {
      continue;
    }

    if (optionWithValue.has(arg)) {
      i += 1;
      continue;
    }

    if (
      arg.startsWith('--lang=') ||
      arg.startsWith(`${BFF_RUNTIME_OPTION}=`) ||
      arg.startsWith('--ultramodern-package-source=') ||
      arg.startsWith('--ultramodern-package-version=') ||
      arg.startsWith('--ultramodern-package-registry=') ||
      arg.startsWith('--ultramodern-package-scope=') ||
      arg.startsWith('--ultramodern-package-name-prefix=') ||
      arg.startsWith(`${VERTICAL_FLAG}=`) ||
      arg.startsWith(`${VERTICAL_NAME_FLAG}=`) ||
      arg.startsWith(`${CODESMITH_OVERLAY_FLAG}=`) ||
      ultramodernBridgeCliBooleanFlags.some(flag =>
        arg.startsWith(`${flag}=`),
      ) ||
      ultramodernBridgeCliValueFlags.some(flag => arg.startsWith(`${flag}=`))
    ) {
      continue;
    }

    positionalArgs.push(arg);
  }

  return positionalArgs;
}

function readRequiredVerticalNameValue(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    console.error(i18n.t(localeKeys.error.verticalNameMissing));
    process.exit(1);
  }

  return value;
}

function resolveVerticalCliInput(args: string[]): VerticalCliInput {
  const candidates: VerticalNameCandidate[] = [];
  let addVertical = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === VERTICAL_FLAG) {
      addVertical = true;
      continue;
    }

    if (arg.startsWith(`${VERTICAL_FLAG}=`)) {
      addVertical = true;
      candidates.push({
        value: arg.slice(`${VERTICAL_FLAG}=`.length),
        source: `${VERTICAL_FLAG}=<name>`,
      });
      continue;
    }

    if (arg === VERTICAL_NAME_FLAG) {
      addVertical = true;
      candidates.push({
        value: readRequiredVerticalNameValue(args, i),
        source: VERTICAL_NAME_FLAG,
      });
      i += 1;
      continue;
    }

    if (arg.startsWith(`${VERTICAL_NAME_FLAG}=`)) {
      addVertical = true;
      candidates.push({
        value: arg.slice(`${VERTICAL_NAME_FLAG}=`.length),
        source: `${VERTICAL_NAME_FLAG}=<name>`,
      });
    }
  }

  if (!addVertical) {
    return { addVertical: false };
  }

  const positionalArgs = collectPositionalArgs(args);
  if (positionalArgs.length > 1) {
    console.error(`Unexpected positional argument: ${positionalArgs[1]}`);
    process.exit(1);
  }

  if (positionalArgs[0]) {
    candidates.push({
      value: positionalArgs[0],
      source: 'positional argument',
    });
  }

  const emptyCandidate = candidates.find(candidate => candidate.value === '');
  if (!candidates.length || emptyCandidate) {
    console.error(i18n.t(localeKeys.error.verticalNameMissing));
    process.exit(1);
  }

  const [firstCandidate] = candidates;
  const disagreement = candidates.find(
    candidate => candidate.value !== firstCandidate.value,
  );
  if (disagreement) {
    console.error(
      i18n.t(localeKeys.error.verticalNameAmbiguous, {
        firstName: firstCandidate.value,
        firstSource: firstCandidate.source,
        secondName: disagreement.value,
        secondSource: disagreement.source,
      }),
    );
    process.exit(1);
  }

  return {
    addVertical: true,
    name: firstCandidate.value,
  };
}

function detectDryRunFlag(args: string[]): boolean {
  if (args.some(arg => arg.startsWith(`${DRY_RUN_FLAG}=`))) {
    console.error(`${DRY_RUN_FLAG} does not accept a value.`);
    process.exit(1);
  }

  return args.includes(DRY_RUN_FLAG);
}

function detectCodeSmithOverlays(args: string[]) {
  const overlays: { generator: string }[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === CODESMITH_OVERLAY_FLAG) {
      const generator = args[i + 1];
      if (!generator || generator.startsWith('-')) {
        console.error(`${CODESMITH_OVERLAY_FLAG} requires a package or path.`);
        process.exit(1);
      }
      overlays.push({ generator });
      i += 1;
      continue;
    }

    if (arg.startsWith(`${CODESMITH_OVERLAY_FLAG}=`)) {
      const generator = arg.slice(`${CODESMITH_OVERLAY_FLAG}=`.length);
      if (!generator) {
        console.error(`${CODESMITH_OVERLAY_FLAG} requires a package or path.`);
        process.exit(1);
      }
      overlays.push({ generator });
    }
  }

  return overlays.length > 0 ? overlays : undefined;
}

function readBridgeCliOptions(args: string[]) {
  try {
    return parseUltramodernBridgeCliOptions(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function detectUltramodernPackageSource(
  args: string[],
  defaultPackageVersion: string,
  createPackage: CreatePackageJson,
): UltramodernPackageSource {
  const bleedingDevDefaults = isBleedingDevCreatePackage(createPackage);
  const strategy =
    getOptionValue(args, ['--ultramodern-package-source']) ??
    (bleedingDevDefaults ? 'install' : 'workspace');
  if (strategy !== 'workspace' && strategy !== 'install') {
    console.error(
      '--ultramodern-package-source must be "workspace" or "install"',
    );
    process.exit(1);
  }
  const packageSourceStrategy =
    strategy as UltramodernPackageSource['strategy'];
  const explicitRegistry = getOptionValue(args, [
    '--ultramodern-package-registry',
  ]);
  const aliasScope =
    getOptionValue(args, ['--ultramodern-package-scope']) ??
    (bleedingDevDefaults &&
    packageSourceStrategy === 'install' &&
    !explicitRegistry
      ? BLEEDINGDEV_PACKAGE_SCOPE
      : undefined);
  return {
    strategy: packageSourceStrategy,
    modernPackageVersion:
      getOptionValue(args, ['--ultramodern-package-version']) ??
      defaultPackageVersion,
    registry: explicitRegistry,
    aliasScope,
    aliasPackageNamePrefix:
      getOptionValue(args, ['--ultramodern-package-name-prefix']) ??
      (aliasScope ? BLEEDINGDEV_PACKAGE_NAME_PREFIX : undefined),
  };
}

function hasExplicitUltramodernPackageSource(
  args: string[],
  value?: UltramodernPackageSource['strategy'],
): boolean {
  const configuredValue = getOptionValue(args, [
    '--ultramodern-package-source',
  ]);
  return value ? configuredValue === value : configuredValue !== undefined;
}

function readBleedingDevFrameworkVersionFromRegistry(
  fallbackVersion: string,
): string {
  const envVersion = process.env[BLEEDINGDEV_FRAMEWORK_VERSION_ENV]?.trim();
  if (envVersion) {
    if (!semverPattern.test(envVersion)) {
      console.error(
        `${BLEEDINGDEV_FRAMEWORK_VERSION_ENV} must be a valid semver version`,
      );
      process.exit(1);
    }
    return envVersion;
  }

  try {
    const rawVersion = runSetupCommand(
      'npm',
      [
        'view',
        `${BLEEDINGDEV_CREATE_PACKAGE}@latest`,
        'ultramodern.frameworkVersion',
        '--json',
      ],
      { timeoutMs: REGISTRY_LOOKUP_TIMEOUT_MS },
    ).trim();
    const version = JSON.parse(rawVersion);
    if (typeof version === 'string' && semverPattern.test(version)) {
      return version;
    }
  } catch {
    // Fall through to the offline-safe fallback below.
  }

  console.warn(
    [
      `Could not resolve ${BLEEDINGDEV_CREATE_PACKAGE}@latest ultramodern.frameworkVersion from the npm registry.`,
      `Falling back to the packaged framework version ${fallbackVersion}.`,
      `Pass ${WORKSPACE_PROTOCOL_FLAG} to use local workspace protocol dependencies,`,
      'or pass --ultramodern-package-version with the exact BleedingDev framework cohort.',
    ].join(' '),
  );
  return fallbackVersion;
}

function resolveInstallBackedPackageSource(
  args: string[],
  createPackage: CreatePackageJson,
  packageSource: UltramodernPackageSource,
): UltramodernPackageSource {
  const explicitVersion = getOptionValue(args, [
    '--ultramodern-package-version',
  ]);
  const explicitRegistry = getOptionValue(args, [
    '--ultramodern-package-registry',
  ]);
  const aliasScope =
    getOptionValue(args, ['--ultramodern-package-scope']) ??
    packageSource.aliasScope ??
    (explicitRegistry ? undefined : BLEEDINGDEV_PACKAGE_SCOPE);

  return {
    ...packageSource,
    strategy: 'install',
    modernPackageVersion:
      explicitVersion ??
      (isBleedingDevCreatePackage(createPackage)
        ? packageSource.modernPackageVersion
        : readBleedingDevFrameworkVersionFromRegistry(
            packageSource.modernPackageVersion,
          )),
    aliasScope,
    aliasPackageNamePrefix:
      getOptionValue(args, ['--ultramodern-package-name-prefix']) ??
      packageSource.aliasPackageNamePrefix ??
      (aliasScope ? BLEEDINGDEV_PACKAGE_NAME_PREFIX : undefined),
  };
}

function resolveWorkspacePackageSource(
  args: string[],
  createPackage: CreatePackageJson,
  packageSource: UltramodernPackageSource,
): UltramodernPackageSource {
  const workspaceProtocolRequested = args.includes(WORKSPACE_PROTOCOL_FLAG);
  if (
    workspaceProtocolRequested &&
    hasExplicitUltramodernPackageSource(args, 'install')
  ) {
    console.error(
      `${WORKSPACE_PROTOCOL_FLAG} conflicts with --ultramodern-package-source=install`,
    );
    process.exit(1);
  }

  if (
    workspaceProtocolRequested ||
    hasExplicitUltramodernPackageSource(args, 'workspace')
  ) {
    return {
      ...packageSource,
      strategy: 'workspace',
      modernPackageVersion: WORKSPACE_PACKAGE_VERSION,
    };
  }

  return resolveInstallBackedPackageSource(args, createPackage, packageSource);
}

function runSetupCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    stdio?: 'ignore' | 'inherit';
    timeoutMs?: number;
  } = {},
) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf-8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
  });
}

function commandExists(command: string): boolean {
  try {
    runSetupCommand(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function assertGitAvailableForGeneratedProject() {
  if (commandExists('git')) {
    return;
  }

  throw new Error(
    'Git is required for UltraModern setup. Install git yourself (for example "brew install git" or "sudo apt-get install git") and rerun create. This tool never installs system packages on your behalf.',
  );
}

function isInsideGitWorkTree(targetDir: string): boolean {
  try {
    return (
      runSetupCommand('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: targetDir,
      }).trim() === 'true'
    );
  } catch {
    return false;
  }
}

function initializeGeneratedGitRepository(targetDir: string) {
  assertGitAvailableForGeneratedProject();
  if (isInsideGitWorkTree(targetDir)) {
    return;
  }

  try {
    runSetupCommand('git', ['init', '-b', 'main'], {
      cwd: targetDir,
      stdio: 'inherit',
    });
  } catch {
    runSetupCommand('git', ['init'], { cwd: targetDir, stdio: 'inherit' });
    runSetupCommand('git', ['branch', '-M', 'main'], {
      cwd: targetDir,
      stdio: 'inherit',
    });
  }
}

function isDirectoryEmpty(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) {
    return false;
  }
  try {
    const files = fs.readdirSync(dirPath);
    return files.length === 0;
  } catch {
    return false;
  }
}

async function getProjectName(): Promise<{
  name: string;
  useCurrentDir: boolean;
}> {
  const args = process.argv.slice(2);
  const positionalArgs = collectPositionalArgs(args);

  if (positionalArgs.length > 1) {
    console.error(`Unexpected positional argument: ${positionalArgs[1]}`);
    process.exit(1);
  }

  const projectNameArg = positionalArgs[0];

  if (projectNameArg) {
    if (projectNameArg === '.') {
      return { name: path.basename(process.cwd()), useCurrentDir: true };
    }
    return { name: projectNameArg, useCurrentDir: false };
  }

  // 如果当前目录为空，直接使用当前目录名作为项目名
  const currentDir = process.cwd();
  if (isDirectoryEmpty(currentDir)) {
    return { name: path.basename(currentDir), useCurrentDir: true };
  }

  const projectName = await promptInput(i18n.t(localeKeys.prompt.projectName));

  if (!projectName) {
    console.error(i18n.t(localeKeys.error.projectNameEmpty));
    process.exit(1);
  }

  return { name: projectName, useCurrentDir: false };
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'ultramodern') {
    process.exitCode = await runUltramodernToolingCli(args.slice(1));
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    return;
  }

  if (detectLegacyModernJsFlag(args)) {
    await confirmLegacyModernJsSetup();
    delegateLegacyModernJsSetup(args);
    return;
  }

  // Validate the BFF flag surface before any prompt or filesystem write so an
  // unsupported runtime never leaves a half-created project behind. The
  // returned runtime is always 'effect' today: the workspace generator bakes
  // the Effect BFF into every scaffolded vertical.
  detectBffRuntime(args);
  const dryRun = detectDryRunFlag(args);
  const verticalInput = resolveVerticalCliInput(args);
  const overlays = detectCodeSmithOverlays(args);
  const bridgeRequested = hasUltramodernBridgeCliOptions(args);

  if (dryRun && !verticalInput.addVertical) {
    console.error(
      `${DRY_RUN_FLAG} is currently supported only with ${VERTICAL_FLAG}`,
    );
    process.exit(1);
  }

  if (verticalInput.addVertical && bridgeRequested) {
    console.error(
      'Bridge options are supported only when creating a new UltraModern workspace.',
    );
    process.exit(1);
  }

  const bridge = readBridgeCliOptions(args);

  if (!dryRun) {
    console.log(`\n${i18n.t(localeKeys.message.welcome)}\n`);
  }

  const createPackage = readCreatePackageJson();
  const version = createPackage.version || 'latest';
  const ultramodernPackageVersion = isBleedingDevCreatePackage(createPackage)
    ? getBleedingDevFrameworkVersion(createPackage, version)
    : version;

  if (verticalInput.addVertical) {
    const overridePackageSource = args.some(arg =>
      arg.startsWith('--ultramodern-package-'),
    )
      ? detectUltramodernPackageSource(
          args,
          ultramodernPackageVersion,
          createPackage,
        )
      : undefined;
    const verticalOptions = {
      workspaceRoot: process.cwd(),
      name: verticalInput.name,
      modernVersion: version,
      enableTailwind: detectExplicitTailwindFlag(),
      overlays,
      packageSource: overridePackageSource,
    };

    if (dryRun) {
      console.log(
        JSON.stringify(planUltramodernVertical(verticalOptions), null, 2),
      );
      return;
    }

    addUltramodernVertical(verticalOptions);

    const dim = '\x1b[2m\x1b[3m';
    const reset = '\x1b[0m';

    console.log(`${i18n.t(localeKeys.message.success)}\n`);
    console.log(`${dim}   pnpm check${reset}\n`);
    return;
  }

  const { name: projectName, useCurrentDir } = await getProjectName();
  const targetDir = useCurrentDir
    ? process.cwd()
    : path.isAbsolute(projectName)
      ? projectName
      : path.resolve(process.cwd(), projectName);
  const generatedPackageName =
    useCurrentDir || path.isAbsolute(projectName)
      ? path.basename(targetDir)
      : projectName;

  if (fs.existsSync(targetDir)) {
    const files = fs.readdirSync(targetDir);
    if (files.length > 0) {
      console.error(i18n.t(localeKeys.error.directoryExists, { projectName }));
      process.exit(1);
    }
  }

  const packageSource = resolveWorkspacePackageSource(
    args,
    createPackage,
    detectUltramodernPackageSource(
      args,
      ultramodernPackageVersion,
      createPackage,
    ),
  );
  generateUltramodernWorkspace({
    targetDir,
    packageName: generatedPackageName,
    modernVersion: version,
    enableTailwind: detectTailwindFlag(),
    bridge,
    overlays,
    packageSource,
  });
  initializeGeneratedGitRepository(targetDir);

  // ANSI escape codes: \x1b[2m = dim, \x1b[3m = italic, \x1b[0m = reset
  const dim = '\x1b[2m\x1b[3m';
  const reset = '\x1b[0m';

  console.log(`${i18n.t(localeKeys.message.success)}\n`);
  console.log(i18n.t(localeKeys.message.nextSteps));
  if (!useCurrentDir) {
    console.log(
      `${dim}   ${i18n.t(localeKeys.message.step1, { projectName })}${reset}`,
    );
  }
  console.log(`${dim}   ${i18n.t(localeKeys.message.step2)}${reset}`);
  console.log(`${dim}   pnpm check${reset}`);
  console.log(`${dim}   ${i18n.t(localeKeys.message.step3)}${reset}\n`);
}

main().catch(error => {
  console.error(i18n.t(localeKeys.error.createFailed), error);
  process.exit(1);
});
