import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentsMd } from './agents-md';
import {
  CODESMITH_OVERLAY_FLAG,
  DRY_RUN_FLAG,
  detectApiProtocolFlag,
  detectBffRuntime,
  detectCodeSmithOverlays,
  detectDryRunFlag,
  detectExplicitTailwindFlag,
  detectHorizontalRemoteFlag,
  detectLanguage,
  detectPresetFlag,
  detectTailwindFlag,
  readBridgeCliOptions,
  resolveVerticalCliInput,
  VERTICAL_FLAG,
} from './cli/flags';
import { showHelp, showVersion } from './cli/help';
import {
  detectUltramodernPackageSource,
  getBleedingDevFrameworkVersion,
  isBleedingDevCreatePackage,
  readCreatePackageJson,
  resolveWorkspacePackageSource,
} from './cli/package-source';
import { initializeGeneratedGitRepository } from './cli/project-setup';
import { getProjectName } from './cli/prompts';
import { i18n, localeKeys } from './locale';
import { runUltramodernToolingCli } from './ultramodern-tooling/commands';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
  planUltramodernVertical,
} from './ultramodern-workspace';
import { hasUltramodernBridgeCliOptions } from './ultramodern-workspace/bridge-config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateDir = [
  path.resolve(__dirname, '../template-workspace'),
  path.resolve(__dirname, '../../template-workspace'),
].find(candidate => fs.existsSync(candidate));

if (!templateDir) {
  throw new Error('Unable to locate the UltraModern workspace templates');
}
const availableTemplateDir = templateDir;

i18n.changeLanguage({ locale: detectLanguage() });

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

  // Mode for existing projects: refresh agent instructions without reserving
  // a positional project name.
  if (args.includes('--agents-md-only')) {
    const valueFlags = ['--lang', '-l'];
    const hasProjectName = args.some(
      (arg, index) =>
        !arg.startsWith('-') && !valueFlags.includes(args[index - 1]),
    );
    if (hasProjectName || args.includes('--no-agents-md')) {
      console.error(i18n.t(localeKeys.error.agentsMdOnlyConflict));
      process.exit(1);
    }
    runAgentsMd(availableTemplateDir, process.cwd());
    return;
  }

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
    const preset = detectPresetFlag(args);
    const apiProtocol = detectApiProtocolFlag(args);
    const horizontalRemote = detectHorizontalRemoteFlag(args);
    const verticalOptions = {
      workspaceRoot: process.cwd(),
      name: verticalInput.name,
      modernVersion: version,
      enableTailwind: detectExplicitTailwindFlag(),
      overlays,
      packageSource: overridePackageSource,
      ...(preset ? { preset } : {}),
      ...(apiProtocol ? { apiProtocol } : {}),
      ...(horizontalRemote ? { horizontalRemote: true } : {}),
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
  const generateAgentFiles = !args.includes('--no-agents-md');
  generateUltramodernWorkspace({
    targetDir,
    packageName: generatedPackageName,
    modernVersion: version,
    enableTailwind: detectTailwindFlag(),
    bridge,
    overlays,
    packageSource,
    generateAgentFiles,
  });
  initializeGeneratedGitRepository(targetDir);

  const dim = '\x1b[2m\x1b[3m';
  const reset = '\x1b[0m';

  console.log(`${i18n.t(localeKeys.message.success)}\n`);
  if (generateAgentFiles) {
    console.log(`${i18n.t(localeKeys.message.agentsMd)}\n`);
  }
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
