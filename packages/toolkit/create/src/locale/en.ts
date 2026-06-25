export const EN_LOCALE = {
  prompt: {
    projectName: 'Please enter project name: ',
    legacyModernJsConfirmation:
      'Type "{confirmation}" to continue with the original Modern.js setup: ',
  },
  error: {
    projectNameEmpty: 'Error: Project name cannot be empty',
    directoryExists:
      'Error: Directory "{projectName}" already exists and is not empty',
    legacyModernJsNotConfirmed:
      'Aborted. UltraModern.js remains the default unattended setup.',
    createFailed: 'Error creating project:',
  },
  message: {
    welcome: '🚀 Welcome to UltraModern.js',
    success: '✨ Created successfully!',
    nextSteps: '📋 Next steps:',
    step1: 'cd {projectName}',
    step2: 'pnpm install',
    step3: 'pnpm dev',
    legacyModernJsWarning: [
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      'BRUTAL WARNING: YOU ARE OPTING OUT OF ULTRAMODERN.JS DEFAULTS.',
      'The unattended default is the best UltraModern.js configuration:',
      'a structured SuperApp workspace, presetUltramodern, TanStack Router,',
      'Effect BFF, Tailwind CSS v4, and the BleedingDev package cohort.',
      'The original Modern.js setup is a dangerous opt-in path.',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    ].join('\n'),
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
      '      --bff Keep the default Effect BFF scaffolding (every MicroVertical ships an Effect BFF)',
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
    optionVertical:
      '      --vertical Mutate the current existing UltraModern workspace and wire a MicroVertical named <project-name>',
    optionDryRun:
      '      --dry-run Preview a MicroVertical mutation plan without writing files (supported with --vertical)',
    optionLegacyModernJs:
      '      --legacy-modern-js Opt into the original Modern.js setup after a large warning and typed confirmation',
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
    example8:
      '  pnpm dlx @bleedingdev/modern-js-create catalog --vertical --dry-run',
    moreInfo: '📚 Learn more: https://modernjs.dev',
  },
  version: {
    message: '{name} version: {version}',
  },
};
