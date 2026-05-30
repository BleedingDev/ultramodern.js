export const ZH_LOCALE = {
  prompt: {
    projectName: '请输入项目名称: ',
  },
  error: {
    projectNameEmpty: '错误: 项目名称不能为空',
    directoryExists: '错误: 目录 "{projectName}" 已存在且不为空',
    invalidRouter:
      '错误: 不支持的路由器 "{router}"，请使用 "react-router" 或 "tanstack"',
    invalidBffRuntime:
      '错误: 不支持的 BFF 运行时 "{runtime}"，请使用 "hono" 或 "effect"',
    createFailed: '创建项目时出错:',
  },
  message: {
    welcome: '🚀 欢迎使用 Modern.js',
    success: '✨ 创建成功！',
    nextSteps: '📋 下一步：',
    step1: 'cd {projectName}',
    step2: 'pnpm install',
    step3: 'pnpm dev',
  },
  help: {
    title: '🚀 Modern.js 项目创建工具',
    description: '快速创建一个新的 Modern.js 项目',
    usage: '📖 用法:',
    usageExample: '  create [项目名称] [选项]',
    options: '⚙️  选项:',
    optionHelp: '  -h, --help     显示帮助信息',
    optionVersion: '  -v, --version  显示版本信息',
    optionLang: '  -l, --lang     设置语言 (zh 或 en)',
    optionRouter: '  -r, --router   选择路由框架 (react-router 或 tanstack)',
    optionBff: '      --bff      启用 BFF 模板（默认运行时：effect）',
    optionBffRuntime: '      --bff-runtime 选择 BFF 运行时（hono 或 effect）',
    optionTailwind: '      --no-tailwind 禁用默认 Tailwind CSS v4 模板',
    optionWorkspace:
      '      --workspace 对 @modern-js 依赖使用 workspace 协议（用于本地 monorepo 联调）',
    optionUltramodernWorkspace:
      '      --ultramodern-workspace 生成标准 UltraModern SuperApp 工作区',
    optionUltramodernPackageSource:
      '      --ultramodern-package-source 选择 UltraModern 依赖来源（workspace 或 install）',
    optionUltramodernPackageScope:
      '      --ultramodern-package-scope npm alias 安装使用的发布 scope（例如 bleedingdev）',
    optionUltramodernPackageNamePrefix:
      '      --ultramodern-package-name-prefix npm alias 包名前缀（默认：modern-js-）',
    optionVertical:
      '      --vertical 向现有 UltraModern 工作区添加全栈 Vertical',
    optionSub: '  -s, --sub       标记为子项目（monorepo 中的子包）',
    examples: '💡 示例:',
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
    example10:
      '  create my-super-app --ultramodern-workspace --ultramodern-package-source install --ultramodern-package-scope bleedingdev',
    example11: '  create catalog --vertical',
    moreInfo: '📚 更多信息: https://modernjs.dev',
  },
  version: {
    message: '@modern-js/create 版本: {version}',
  },
};
