export const EN_LOCALE = {
  prompt: {
    projectName: 'Please enter project name: ',
  },
  error: {
    projectNameEmpty: 'Error: Project name cannot be empty',
    directoryExists:
      'Error: Directory "{projectName}" already exists and is not empty',
    verticalNameMissing:
      'Error: Missing MicroVertical name. Use <name> --vertical, --vertical=<name>, or --vertical-name <name>.',
    verticalNameAmbiguous:
      'Error: Ambiguous MicroVertical name: "{firstName}" from {firstSource} does not match "{secondName}" from {secondSource}.',
    createFailed: 'Error creating project:',
  },
  message: {
    welcome: '🚀 Welcome to UltraModern.js',
    success: '✨ Created successfully!',
    nextSteps: '📋 Next steps:',
    step1: 'cd {projectName}',
    step2: 'pnpm install',
    step3: 'pnpm dev',
  },
  help: {
    title: '🚀 UltraModern.js Project Creator',
    description:
      'Create a new UltraModern.js SuperApp workspace with the full quality baseline by default',
    usage: '📖 Usage:',
    usageExample:
      '  pnpm dlx @bleedingdev/modern-js-create [project-name] [options]',
    options: '⚙️  Options:',
    optionHelp: '  -h, --help     Display this help message',
    optionVersion: '  -v, --version  Display version information',
    optionLang: '  -l, --lang     Set the language (en default; zh opt-in)',
    optionTailwind:
      '      --no-tailwind Disable default Tailwind CSS v4 workspace styling',
    optionBff:
      '      --bff Keep the default strict Effect API runtime (every MicroVertical ships one)',
    optionBffRuntime:
      '      --bff-runtime Select the BFF runtime for scaffolded MicroVerticals (supported: effect; default: effect)',
    optionWorkspace:
      '      --workspace Use workspace protocol for @modern-js dependencies (for local monorepo testing)',
    optionUltramodernPackageSource:
      '      --ultramodern-package-source Select UltraModern package source (workspace or install; BleedingDev defaults to install aliases)',
    optionUltramodernPackageVersion:
      '      --ultramodern-package-version Pin the exact BleedingDev framework cohort for install package sources',
    optionUltramodernPackageRegistry:
      '      --ultramodern-package-registry npm registry URL used for install package sources',
    optionUltramodernPackageScope:
      '      --ultramodern-package-scope Publish scope for npm alias installs (for example bleedingdev)',
    optionUltramodernPackageNamePrefix:
      '      --ultramodern-package-name-prefix Prefix for npm alias package names (default: modern-js-)',
    optionBridge:
      '      --bridge Enable explicit nested parent-monorepo bridge mode for new workspaces',
    optionBridgeParentRoot:
      '      --bridge-parent-root <path> Parent monorepo root for bridge mode',
    optionBridgeWorkspacePackage:
      '      --bridge-workspace-package <glob> Parent workspace package glob consumed by generated apps',
    optionBridgeWorkspacePackageName:
      '      --bridge-workspace-package-name <glob=package[,package]> Package names covered by a bridge workspace glob',
    optionBridgeTestAlias:
      '      --bridge-test-alias <glob:alias=target> Test/source alias for a bridge workspace package glob',
    optionBridgeDependency:
      '      --bridge-dependency <package[,package]> Explicit parent package dependency consumed by generated apps',
    optionBridgeLockfilePolicy:
      '      --bridge-lockfile-policy <nested|parent> Bridge lockfile ownership policy (default: nested)',
    optionBridgeGate:
      '      --bridge-gate <name=command> Delegated parent workspace gate command for bridge packages',
    optionBridgeGateCwd:
      '      --bridge-gate-cwd <name=cwd> Working directory for a named bridge gate',
    optionBridgeReactSingleton:
      '      --bridge-react-singleton <package[,package]> React singleton package expectation (default: react,react-dom)',
    optionVertical:
      '      --vertical[=<name>] Mutate the current existing UltraModern workspace and wire a MicroVertical',
    optionVerticalName:
      '      --vertical-name <name> Explicit MicroVertical name for automation-friendly workspace mutation',
    optionDryRun:
      '      --dry-run Preview a MicroVertical mutation plan without writing files (supported with --vertical)',
    optionCodeSmithOverlay:
      '      --codesmith-overlay <package-or-path> Run an explicit CodeSmith overlay after generation',
    optionPreset:
      '      --preset=<full-stack|api-only|ui-only> Restrict a MicroVertical to API-only or UI-only surfaces (default full-stack)',
    optionApiProtocol:
      '      --api-protocol=<rest|rpc> Select the MicroVertical API protocol (default rest)',
    optionHorizontalRemote:
      '      --horizontal-remote Generate a components-only Horizontal Remote delivery unit',
    examples: '💡 Examples:',
    example1: '  pnpm dlx @bleedingdev/modern-js-create my-workspace',
    example2: '  pnpm dlx @bleedingdev/modern-js-create my-workspace --lang zh',
    example3:
      '  pnpm dlx @bleedingdev/modern-js-create my-workspace --no-tailwind',
    example4: '  pnpm dlx @bleedingdev/modern-js-create --help',
    example5: '  pnpm dlx @bleedingdev/modern-js-create .',
    example6:
      '  pnpm dlx @bleedingdev/modern-js-create my-workspace --workspace',
    example7: '  pnpm dlx @bleedingdev/modern-js-create catalog --vertical',
    example8: '  pnpm dlx @bleedingdev/modern-js-create --vertical=catalog',
    example9:
      '  pnpm dlx @bleedingdev/modern-js-create catalog --vertical --dry-run',
    example10:
      '  pnpm dlx @bleedingdev/modern-js-create catalog --vertical --codesmith-overlay ./overlay-generator',
    moreInfo: '📚 Learn more: https://modernjs.dev',
  },
  version: {
    message: '{name} version: {version}',
  },
};
