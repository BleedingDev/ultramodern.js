export const ZH_LOCALE = {
  prompt: {
    projectName: '请输入项目名称: ',
    legacyModernJsConfirmation:
      '输入 "{confirmation}" 以继续使用原始 Modern.js 初始化: ',
  },
  error: {
    projectNameEmpty: '错误: 项目名称不能为空',
    directoryExists: '错误: 目录 "{projectName}" 已存在且不为空',
    invalidRouter:
      '错误: 不支持的路由器 "{router}"，请使用 "react-router" 或 "tanstack"',
    invalidBffRuntime:
      '错误: 不支持的 BFF 运行时 "{runtime}"，请使用 "hono" 或 "effect"',
    legacyModernJsNotConfirmed:
      '已中止。UltraModern.js 仍是默认的免交互初始化方案。',
    createFailed: '创建项目时出错:',
  },
  message: {
    welcome: '🚀 欢迎使用 UltraModern.js',
    success: '✨ 创建成功！',
    nextSteps: '📋 下一步：',
    step1: 'cd {projectName}',
    step2: 'pnpm install',
    step3: 'pnpm dev',
    legacyModernJsWarning: [
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      '严重警告：你正在退出 ULTRAMODERN.JS 默认配置。',
      '免交互默认值是最佳 UltraModern.js 配置：',
      'presetUltramodern、TanStack Router、Effect BFF、Tailwind CSS v4，',
      '以及 BleedingDev 包版本队列。',
      '原始 Modern.js 初始化仅用于遗留兼容。',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    ].join('\n'),
  },
  help: {
    title: '🚀 UltraModern.js 项目创建工具',
    description:
      '创建默认包含 TanStack Router 和 Effect BFF 的 UltraModern.js 应用',
    usage: '📖 用法:',
    usageExample: '  pnpm dlx @bleedingdev/modern-js-create [项目名称] [选项]',
    options: '⚙️  选项:',
    optionHelp: '  -h, --help     显示帮助信息',
    optionVersion: '  -v, --version  显示版本信息',
    optionLang: '  -l, --lang     设置语言 (zh 或 en)',
    optionRouter:
      '  -r, --router   选择路由框架（默认 tanstack；react-router 为兼容模式）',
    optionBff: '      --bff      保持启用 Effect BFF（UltraModern 应用默认值）',
    optionBffRuntime: '      --bff-runtime 选择 BFF 运行时（hono 或 effect）',
    optionTailwind: '      --no-tailwind 禁用默认 Tailwind CSS v4 模板',
    optionWorkspace:
      '      --workspace 对 @modern-js 依赖使用 workspace 协议（用于本地 monorepo 联调）',
    optionUltramodernWorkspace:
      '      --ultramodern-workspace 生成 UltraModern SuperApp 工作区（默认创建完整 UltraModern 单应用）',
    optionUltramodernPackageSource:
      '      --ultramodern-package-source 选择 UltraModern 依赖来源（workspace 或 install；BleedingDev 默认使用 install alias）',
    optionUltramodernPackageScope:
      '      --ultramodern-package-scope npm alias 安装使用的发布 scope（例如 bleedingdev）',
    optionUltramodernPackageNamePrefix:
      '      --ultramodern-package-name-prefix npm alias 包名前缀（默认：modern-js-）',
    optionVertical:
      '      --vertical 修改当前已有的 UltraModern 工作区，并接入名为 <项目名称> 的 MicroVertical',
    optionLegacyModernJs:
      '      --legacy-modern-js 在大型警告和输入确认后，选择原始 Modern.js 初始化',
    optionSub: '  -s, --sub       标记为子项目（monorepo 中的子包）',
    examples: '💡 示例:',
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
      '  pnpm dlx @bleedingdev/modern-js-create my-app --router react-router # 兼容模式',
    example12: '  pnpm dlx @bleedingdev/modern-js-create catalog --vertical',
    moreInfo: '📚 更多信息: https://modernjs.dev',
  },
  version: {
    message: '@bleedingdev/modern-js-create 版本: {version}',
  },
};
