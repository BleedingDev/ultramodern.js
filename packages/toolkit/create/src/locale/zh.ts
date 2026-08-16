export const ZH_LOCALE = {
  prompt: {
    projectName: '请输入项目名称: ',
  },
  error: {
    projectNameEmpty: '错误: 项目名称不能为空',
    directoryExists: '错误: 目录 "{projectName}" 已存在且不为空',
    verticalNameMissing:
      '错误: 缺少 MicroVertical 名称。请使用 <名称> --vertical、--vertical=<名称> 或 --vertical-name <名称>。',
    verticalNameAmbiguous:
      '错误: MicroVertical 名称不明确：{firstSource} 的 "{firstName}" 与 {secondSource} 的 "{secondName}" 不一致。',
    createFailed: '创建项目时出错:',
    agentsMdOnlyConflict:
      '错误: --agents-md-only 只更新当前项目，不能与项目名或 --no-agents-md 同时使用',
  },
  message: {
    welcome: '🚀 欢迎使用 UltraModern.js',
    success: '✨ 创建成功！',
    agentsMd:
      '✔ 已生成 AGENTS.md 和 CLAUDE.md —— AI 编码助手会自动读取。（--no-agents-md 可跳过）',
    nextSteps: '📋 下一步：',
    step1: 'cd {projectName}',
    step2: 'pnpm install',
    step3: 'pnpm dev',
  },
  agentsCmd: {
    created: '✔ 已创建 {file}',
    updatedBlock: '✔ 已更新 {file} 中的 modernjs-agent-rules 块',
    addedBlock: '✔ 已在 {file} 顶部添加 modernjs-agent-rules 块',
    linked: '✔ 已向 {file} 添加 `@AGENTS.md` 引用',
    unchanged: '• {file} 已是最新',
    done: '✨ 完成 —— AI 编码助手会读取 {location}。',
    targetNotFound: '错误: 目标目录 "{dir}" 不存在',
    notAProject: '错误: 当前目录不是 Modern.js 项目，请在项目根目录运行',
    unsupportedVersion:
      '• 当前 @modern-js/app-tools@{version} 不支持随包文档，未修改任何文件。可在 AGENTS.md 中补充 https://modernjs.dev/llms.txt 供 AI 工具获取框架知识，或升级到 {since} 及以上后重新执行本命令',
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
    optionNoAgentsMd:
      '      --no-agents-md 跳过生成 AGENTS.md / CLAUDE.md（AI 编码助手指引文件）',
    optionAgentsMdOnly:
      '      --agents-md-only 仅为当前项目补齐/更新 AGENTS.md / CLAUDE.md（不创建项目）',
    optionTailwind: '      --no-tailwind 禁用默认 Tailwind CSS v4 工作区样式',
    optionBff:
      '      --bff 保留默认的严格 Effect API 运行时（每个 MicroVertical 自带一个）',
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
    optionBridge: '      --bridge 为新工作区启用显式的嵌套父 monorepo 桥接模式',
    optionBridgeParentRoot:
      '      --bridge-parent-root <路径> 桥接模式使用的父 monorepo 根目录',
    optionBridgeWorkspacePackage:
      '      --bridge-workspace-package <glob> 生成应用消费的父工作区包 glob',
    optionBridgeWorkspacePackageName:
      '      --bridge-workspace-package-name <glob=包名[,包名]> 桥接工作区 glob 覆盖的包名',
    optionBridgeTestAlias:
      '      --bridge-test-alias <glob:别名=目标> 桥接工作区包 glob 的测试/源码 alias',
    optionBridgeDependency:
      '      --bridge-dependency <包名[,包名]> 生成应用显式消费的父包依赖',
    optionBridgeLockfilePolicy:
      '      --bridge-lockfile-policy <nested|parent> 桥接 lockfile 归属策略（默认：nested）',
    optionBridgeGate:
      '      --bridge-gate <名称=命令> 桥接包委托给父工作区执行的 gate 命令',
    optionBridgeGateCwd:
      '      --bridge-gate-cwd <名称=目录> 指定桥接 gate 的工作目录',
    optionBridgeReactSingleton:
      '      --bridge-react-singleton <包名[,包名]> React 单例包预期（默认：react,react-dom,react-dom/client）',
    optionVertical:
      '      --vertical[=<名称>] 修改当前已有的 UltraModern 工作区，并接入 MicroVertical',
    optionVerticalName:
      '      --vertical-name <名称> 为自动化工作流显式指定 MicroVertical 名称',
    optionDryRun:
      '      --dry-run 预览 MicroVertical 修改计划但不写入文件（与 --vertical 一起使用）',
    optionCodeSmithOverlay:
      '      --codesmith-overlay <包或路径> 生成完成后运行显式配置的 CodeSmith overlay',
    optionPreset:
      '      --preset=<full-stack|api-only|ui-only> 将 MicroVertical 限定为仅 API 或仅 UI 表面（默认 full-stack）',
    optionApiProtocol:
      '      --api-protocol=<rest|rpc> 选择 MicroVertical API 协议（默认 rest）',
    optionHorizontalRemote:
      '      --horizontal-remote 生成仅包含组件的 Horizontal Remote 交付单元',
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
    example8: '  pnpm dlx @bleedingdev/modern-js-create --vertical=catalog',
    example9:
      '  pnpm dlx @bleedingdev/modern-js-create catalog --vertical --dry-run',
    example10:
      '  pnpm dlx @bleedingdev/modern-js-create catalog --vertical --codesmith-overlay ./overlay-generator',
    example11: '  pnpm dlx @bleedingdev/modern-js-create --agents-md-only',
    moreInfo: '📚 更多信息: https://modernjs.dev',
  },
  version: {
    message: '{name} 版本: {version}',
  },
};
