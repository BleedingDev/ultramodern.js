export const EN_LOCALE = {
  prompt: {
    projectName: 'Please enter project name: ',
  },
  error: {
    projectNameEmpty: 'Error: Project name cannot be empty',
    directoryExists:
      'Error: Directory "{projectName}" already exists and is not empty',
    invalidRouter:
      'Error: Unsupported router "{router}". Use "react-router" or "tanstack".',
    invalidBffRuntime:
      'Error: Unsupported BFF runtime "{runtime}". Use "hono" or "effect".',
    createFailed: 'Error creating project:',
  },
  message: {
    welcome: '🚀 Welcome to Modern.js',
    success: '✨ Created successfully!',
    nextSteps: '📋 Next steps:',
    step1: 'cd {projectName}',
    step2: 'pnpm install',
    step3: 'pnpm dev',
  },
  help: {
    title: '🚀 Modern.js Project Creator',
    description: 'Create a new Modern.js project with ease',
    usage: '📖 Usage:',
    usageExample: '  create [project-name] [options]',
    options: '⚙️  Options:',
    optionHelp: '  -h, --help     Display this help message',
    optionVersion: '  -v, --version  Display version information',
    optionLang: '  -l, --lang     Set the language (zh or en)',
    optionRouter:
      '  -r, --router   Select router framework (react-router or tanstack)',
    optionBff: '      --bff      Enable BFF scaffold (default runtime: effect)',
    optionBffRuntime: '      --bff-runtime Select BFF runtime (hono or effect)',
    optionTailwind:
      '      --no-tailwind Disable default Tailwind CSS v4 scaffold',
    optionWorkspace:
      '      --workspace Use workspace protocol for @modern-js dependencies (for local monorepo testing)',
    optionUltramodernWorkspace:
      '      --ultramodern-workspace Generate the canonical UltraModern SuperApp workspace',
    optionUltramodernPackageSource:
      '      --ultramodern-package-source Select UltraModern package source (workspace or install)',
    optionUltramodernPackageScope:
      '      --ultramodern-package-scope Publish scope for npm alias installs (for example bleedingdev)',
    optionUltramodernPackageNamePrefix:
      '      --ultramodern-package-name-prefix Prefix for npm alias package names (default: modern-js-)',
    optionVertical:
      '      --vertical Add a full-stack vertical to an existing UltraModern workspace',
    optionSub: '  -s, --sub       Mark as a subproject (package in monorepo)',
    examples: '💡 Examples:',
    example1: '  create my-app',
    example2: '  create my-app --lang zh',
    example3: '  create my-app --sub',
    example4: '  create --help',
    example5: '  create my-app --router tanstack',
    example6: '  create my-app --router tanstack --no-tailwind',
    example7: '  create my-app --bff',
    example8: '  create my-app --router tanstack --bff-runtime effect',
    example9:
      '  create my-app --router tanstack --bff-runtime effect --workspace',
    example10: '  pnpm dlx @bleedingdev/modern-js-create my-super-app',
    example11: '  create catalog --vertical',
    moreInfo: '📚 Learn more: https://modernjs.dev',
  },
  version: {
    message: '@modern-js/create version: {version}',
  },
};
