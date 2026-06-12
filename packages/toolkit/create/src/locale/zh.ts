export const ZH_LOCALE = {
  prompt: {
    projectName: '请输入项目名称: ',
    legacyModernJsConfirmation:
      '输入 "{confirmation}" 以继续使用原始 Modern.js 初始化: ',
  },
  error: {
    projectNameEmpty: '错误: 项目名称不能为空',
    directoryExists: '错误: 目录 "{projectName}" 已存在且不为空',
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
      '结构化 SuperApp 工作区、presetUltramodern、TanStack Router、',
      'Effect BFF、Tailwind CSS v4，以及 BleedingDev 包版本队列。',
      '原始 Modern.js 初始化是危险的显式选择路径。',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    ].join('\n'),
  },
  help: {
    title: '🚀 UltraModern.js 项目创建工具',
    description: '默认创建带完整质量基线的 UltraModern.js SuperApp 工作区',
    usage: '📖 用法:',
    usageExample: '  pnpm dlx @bleedingdev/modern-js-create [项目名称] [选项]',
    options: '⚙️  选项:',
    optionHelp: '  -h, --help     显示帮助信息',
    optionVersion: '  -v, --version  显示版本信息',
    optionLang: '  -l, --lang     设置语言 (默认 en；zh 需显式选择)',
    optionTailwind: '      --no-tailwind 禁用默认 Tailwind CSS v4 工作区样式',
    optionBff:
      '      --bff 保留默认的 Effect BFF 脚手架（每个 MicroVertical 自带 Effect BFF）',
    optionBffRuntime:
      '      --bff-runtime 选择 MicroVertical 脚手架的 BFF 运行时（支持: effect；默认: effect）',
    optionWorkspace:
      '      --workspace 对 @modern-js 依赖使用 workspace 协议（用于本地 monorepo 联调）',
    optionUltramodernPackageSource:
      '      --ultramodern-package-source 选择 UltraModern 依赖来源（workspace 或 install；BleedingDev 默认使用 install alias）',
    optionUltramodernPackageVersion:
      '      --ultramodern-package-version 为 install 依赖来源固定精确的 BleedingDev 框架版本',
    optionUltramodernPackageRegistry:
      '      --ultramodern-package-registry install 依赖来源使用的 npm registry 地址',
    optionUltramodernPackageScope:
      '      --ultramodern-package-scope npm alias 安装使用的发布 scope（例如 bleedingdev）',
    optionUltramodernPackageNamePrefix:
      '      --ultramodern-package-name-prefix npm alias 包名前缀（默认：modern-js-）',
    optionVertical:
      '      --vertical 修改当前已有的 UltraModern 工作区，并接入名为 <项目名称> 的 MicroVertical',
    optionLegacyModernJs:
      '      --legacy-modern-js 在大型警告和输入确认后，选择原始 Modern.js 初始化',
    examples: '💡 示例:',
    example1: '  pnpm dlx @bleedingdev/modern-js-create my-workspace',
    example2: '  pnpm dlx @bleedingdev/modern-js-create my-workspace --lang zh',
    example3:
      '  pnpm dlx @bleedingdev/modern-js-create my-workspace --no-tailwind',
    example4: '  pnpm dlx @bleedingdev/modern-js-create --help',
    example5: '  pnpm dlx @bleedingdev/modern-js-create .',
    example6:
      '  pnpm dlx @bleedingdev/modern-js-create my-workspace --workspace',
    example7: '  pnpm dlx @bleedingdev/modern-js-create catalog --vertical',
    moreInfo: '📚 更多信息: https://modernjs.dev',
  },
  version: {
    message: '{name} 版本: {version}',
  },
};
