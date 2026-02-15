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
    creating: '📦 正在创建项目 "{projectName}"...',
    success: '\n✨ 项目创建成功！🎉',
    nextSteps: '\n📋 接下来你可以执行以下命令：',
    step1Desc: '📁 进入项目目录：',
    step1: '  cd {projectName}',
    step2Desc: '🔧 初始化 Git 仓库：',
    step2: '  git init',
    step3Desc: '📥 安装项目依赖：',
    step3: '  pnpm install',
    step4Desc: '⚡ 启动开发服务器：',
    step4: '  pnpm start',
    divider: '─'.repeat(50),
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
    optionBff: '      --bff      启用 BFF 模板（默认运行时：hono）',
    optionBffRuntime: '      --bff-runtime 选择 BFF 运行时（hono 或 effect）',
    optionTailwind:
      '      --tailwind 启用 Tailwind CSS v4 模板（PostCSS + 示例样式）',
    optionWorkspace:
      '      --workspace 对 @modern-js 依赖使用 workspace 协议（用于本地 monorepo 联调）',
    optionSub: '  -s, --sub       标记为子项目（monorepo 中的子包）',
    examples: '💡 示例:',
    example1: '  create my-app',
    example2: '  create my-app --lang zh',
    example3: '  create my-app --sub',
    example4: '  create --help',
    example5: '  create my-app --router tanstack',
    example6: '  create my-app --router tanstack --tailwind',
    example7: '  create my-app --bff',
    example8: '  create my-app --router tanstack --bff-runtime effect',
    example9:
      '  create my-app --router tanstack --bff-runtime effect --workspace',
    moreInfo: '📚 更多信息: https://modernjs.dev',
  },
  version: {
    message: '@modern-js/create 版本: {version}',
  },
};
