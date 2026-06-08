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
    invalidRouter:
      'Error: Unsupported router "{router}". Use "react-router" or "tanstack".',
    invalidBffRuntime:
      'Error: Unsupported BFF runtime "{runtime}". Use "hono" or "effect".',
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
      'presetUltramodern, TanStack Router, Effect BFF, Tailwind CSS v4,',
      'and the BleedingDev package cohort.',
      'The original Modern.js setup is legacy compatibility only.',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    ].join('\n'),
  },
  help: {
    title: '🚀 UltraModern.js Project Creator',
    description:
      'Create a new UltraModern.js app with TanStack Router and Effect BFF by default',
    usage: '📖 Usage:',
    usageExample:
      '  pnpm dlx @bleedingdev/modern-js-create [project-name] [options]',
    options: '⚙️  Options:',
    optionHelp: '  -h, --help     Display this help message',
    optionVersion: '  -v, --version  Display version information',
    optionLang: '  -l, --lang     Set the language (zh or en)',
    optionRouter:
      '  -r, --router   Select router framework (tanstack default; react-router is compatibility mode)',
    optionBff:
      '      --bff      Keep Effect BFF enabled (default for UltraModern apps)',
    optionBffRuntime: '      --bff-runtime Select BFF runtime (hono or effect)',
    optionTailwind:
      '      --no-tailwind Disable default Tailwind CSS v4 scaffold',
    optionWorkspace:
      '      --workspace Use workspace protocol for @modern-js dependencies (for local monorepo testing)',
    optionUltramodernWorkspace:
      '      --ultramodern-workspace Generate an UltraModern SuperApp workspace (default is a full UltraModern single app)',
    optionUltramodernPackageSource:
      '      --ultramodern-package-source Select UltraModern package source (workspace or install; BleedingDev defaults to install aliases)',
    optionUltramodernPackageScope:
      '      --ultramodern-package-scope Publish scope for npm alias installs (for example bleedingdev)',
    optionUltramodernPackageNamePrefix:
      '      --ultramodern-package-name-prefix Prefix for npm alias package names (default: modern-js-)',
    optionVertical:
      '      --vertical Mutate the current existing UltraModern workspace and wire a MicroVertical named <project-name>',
    optionLegacyModernJs:
      '      --legacy-modern-js Opt into the original Modern.js setup after a large warning and typed confirmation',
    optionSub: '  -s, --sub       Mark as a subproject (package in monorepo)',
    examples: '💡 Examples:',
    example1: '  pnpm dlx @bleedingdev/modern-js-create my-app',
    example2: '  pnpm dlx @bleedingdev/modern-js-create my-app --lang zh',
    example3: '  pnpm dlx @bleedingdev/modern-js-create my-app --sub',
    example4: '  pnpm dlx @bleedingdev/modern-js-create --help',
    example5: '  pnpm dlx @bleedingdev/modern-js-create .',
    example6:
      '  pnpm dlx @bleedingdev/modern-js-create my-app --router react-router --no-tailwind',
    example7:
      '  pnpm dlx @bleedingdev/modern-js-create my-app --bff-runtime hono',
    example8: '  pnpm dlx @bleedingdev/modern-js-create my-app --workspace',
    example9:
      '  pnpm dlx @bleedingdev/modern-js-create my-super-app --ultramodern-workspace',
    example10: '  pnpm dlx @bleedingdev/modern-js-create my-app --no-tailwind',
    example11:
      '  pnpm dlx @bleedingdev/modern-js-create my-app --router react-router # compatibility mode',
    example12: '  pnpm dlx @bleedingdev/modern-js-create catalog --vertical',
    moreInfo: '📚 Learn more: https://modernjs.dev',
  },
  version: {
    message: '@bleedingdev/modern-js-create version: {version}',
  },
};
