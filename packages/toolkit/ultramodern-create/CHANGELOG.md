# @modern-js/create

## 3.8.3

## 3.8.2

## 3.8.1

## 3.8.0

### Minor Changes

- ea80c84: feat: agent knowledge supply — bundle version-matched English docs into the app-tools tarball (`docs/`) on publish, and generate `AGENTS.md` / `CLAUDE.md` in new projects created by `@modern-js/create` (skip with `--no-agents-md`). Existing projects can run `npx @modern-js/create --agents-md-only` to add or idempotently refresh these files after an upgrade (managed marker block is updated in place, user content is preserved). Also fixes boolean flags swallowing the following positional argument (e.g. `create --sub my-app`).

  feat: Agent 知识供给 —— 发布时将版本匹配的英文文档打进 app-tools tarball（`docs/`），并在 `@modern-js/create` 新建项目时默认生成 `AGENTS.md` / `CLAUDE.md`（`--no-agents-md` 可跳过）。已有项目可运行 `npx @modern-js/create --agents-md-only` 在升级后补齐或幂等更新这两个文件（就地更新托管标记块，保留用户自定义内容）。同时修复布尔参数吞掉后续位置参数的问题（如 `create --sub my-app`）。

### Patch Changes

- a305126: feat: bundle version-matched docs into `@modern-js/app-tools` and generate `AGENTS.md` / `CLAUDE.md` pointing at them, so AI coding agents read docs matching the installed version

  feat: 随包分发与安装版本一致的文档，并生成指向它的 `AGENTS.md` / `CLAUDE.md`，让 AI 编码助手读到与所装版本匹配的文档

## 3.7.0

## 3.6.0

## 3.5.0

### BleedingDev Strict Effect API Migration Notes

- The `3.5.0-ultramodern.0` BleedingDev UltraModern cohort moves generated
  Effect APIs out of side-path directories. Generated verticals now use `api/index.ts`,
  `shared/api.ts`, and `src/api/*-client.ts`; shell API aggregates live under
  `apps/shell-super-app/src/api/*`.
- Generated configs explicitly set `bff.effect.entry: './api/index'` and
  `bff.effect.strictEffectApproach: true`. The Effect runtime rejects raw
  request handlers, default request handlers, and unbranded `createHandler`
  factories instead of accepting them as compatibility paths.
- Older generated workspaces must remove `api/effect`, `shared/effect`,
  `src/effect`, `apps/shell-super-app/src/effect`, `api.effect` topology, and
  shared Effect API packages. Update package exports to `./api` and
  `./api/client`, then run `pnpm api:check`,
  `scripts/validate-ultramodern-workspace.mts`, `pnpm check`, and `pnpm build`.
- `3.4.0-ultramodern.20` and earlier packages do not contain this full strict
  direct-API cohort. Do not migrate a repo to this layout while validating
  against those package types; use the local Modern.js workspace or pin
  `3.5.0-ultramodern.0` or newer once published.

## 3.4.0

### BleedingDev 3.4.0-ultramodern.19 Migration Notes

- The BleedingDev `@bleedingdev/modern-js-create` package now publishes the
  UltraModern cleanup cohort that addresses the generated-app bloat found in
  `3.4.0-ultramodern.12`.
- `3.4.0-ultramodern.19` supersedes `3.4.0-ultramodern.13` through
  `3.4.0-ultramodern.18`. The `.13` cohort
  published the cleanup, but fresh workspaces could fail `format:check`; `.14`
  preformatted generated files, but downstream Cloudflare Worker SSR could
  still crash when a federated remote published `publicPath: "/"`; `.15` fixed
  the SSR runtime path, but generated Cloudflare proof still compared raw MF
  manifest `publicPath` strings instead of their resolved asset base; `.16`
  fixed that proof but compact validation could under-describe customized
  component exposes; `.17` fixed compact expose validation but still used a
  single-segment unknown-route probe and origin-relative remote asset prefixes.
  `.18` fixed those remote deployment issues, but generated vertical configs
  used string concatenation that failed the generated `oxlint` gate after
  adding a MicroVertical, and Worker builds could rely on transitive
  `react-router-dom` resolution through Module Federation bridge code.
  Use `.19` as the migration target.
- Fresh generated workspaces commit compact UltraModern provenance and config
  in `.modernjs/ultramodern.json` instead of committing the large generated
  contract, package-source, and template-manifest metadata files.
- Generated framework scripts are now small wrappers around the versioned
  `modern-js-create ultramodern` CLI. Framework-owned validation, proof,
  public-surface, performance-readiness, and Module Federation type checks live
  in the published create package instead of being copied into every app.
- Module Federation type validation now discovers real generated app configs,
  reads actual `exposes`, requires non-empty `dist/@mf-types.zip` archives for
  exposing apps, and checks the `tsgo` compiler plus generated MF tsconfig path.
  Compact config validation also maps component exposes to concrete DTS source
  files, with explicit `exposePaths` overrides for non-standard files.
- Generated Cloudflare Worker output accepts generic Wrangler-compatible
  `deploy.worker.wrangler` config and protected `deploy.worker.artifacts`
  staging, while server-only app directories are excluded from public assets.
  Cloudflare proof now resolves relative MF manifest `publicPath` values and
  probes a two-segment missing route so locale-prefixed workspaces do not
  accidentally treat the smoke route as a valid language. Generated remotes
  publish an own-origin default asset prefix for dev and Cloudflare deploys so
  browser Module Federation hydration loads `remoteEntry.js` and expose chunks
  from the remote app, not the shell host.
- Nested parent-monorepo consumption is now an explicit bridge mode with parent
  workspace package globs, generated app dependencies, source/test aliases,
  delegated gates, lockfile policy, and React singleton expectations.
- Codex skill bodies are generated under `.codex/skills`, remain default-on,
  preserve unrelated existing skills, and can be disabled with
  `ULTRAMODERN_SKIP_CODEX_SKILLS=1` or `ULTRAMODERN_CODEX_SKILLS=0`.
- Generated workspaces ignore `.codex/reports/` and `apps/*/.modern-js/`
  generated output.
- Builder diagnostics now include clearer server-only/RSC warning attribution
  so app authors can distinguish server graph warnings from public bundle leaks.
- The upstream Module Federation splitChunks warning may still appear until the
  Module Federation integration releases its own fix; this is tracked outside
  the generator cleanup and should not be hidden with app-level shims.

### BleedingDev 3.4.0-ultramodern.1 Migration Notes

- The BleedingDev `@bleedingdev/modern-js-create` package now publishes the
  UltraModern workspace generator as the supported public automation surface:
  `@modern-js/create/ultramodern-workspace` and
  `@modern-js/create/ultramodern-workspace/codesmith`.
- Generated UltraModern workspaces default to the published BleedingDev package
  cohort. Existing repos should regenerate or add new MicroVerticals with one
  package-source strategy, then run `mise install`, `pnpm install`, `pnpm check`,
  and `pnpm build` from the activated toolchain.
- Older generated workspaces that consumed unreleased workspace packages should
  switch to `--ultramodern-package-source=install` plus an exact
  `--ultramodern-package-version` when proving a published cohort, or keep
  `--workspace` only for local monorepo testing.
- Migration is incremental: existing Modern.js apps can keep running outside
  the generated UltraModern surface, while new or migrated UltraModern
  surfaces move to TanStack Router, strict Effect HttpApi, generated ownership
  contracts, and the `scripts/validate-ultramodern-workspace.mts` self-check.
- Older generated workspaces with Effect BFF entries under `api/effect` should
  update to the corrected BleedingDev cohort before adding app-local package
  metadata or Module Federation shims. The BFF compiler now normalizes
  CommonJS server output so `verbatimModuleSyntax` app tsconfigs can compile
  native ESM source without changing app package type.
- Generated app packages keep stable `typescript` for classic compiler
  consumers such as Module Federation DTS generation, while TS-Go continues to
  run through the pinned `@typescript/native-preview` toolchain. Do not add
  app-level shims or local package overrides to mask framework dependency
  issues.

## 3.3.0

## 3.2.2

## 3.2.1

## 3.2.0

## 3.1.5

## 3.1.4

## 3.1.3

## 3.1.2

## 3.1.1

## 3.1.0

## 3.0.5

## 3.0.4

## 3.0.3

### Patch Changes

- 9387ab3: chore(create): simplify project creation output logs

  chore(create): 简化项目创建输出日志

## 3.0.2

### Patch Changes

- 14d408f: fix(create): skip "enter project directory" step when project is created in current directory

  fix(create): 当项目创建在当前目录时，不再提示执行 cd 进入项目目录

## 3.0.1

## 3.0.0

## 3.0.0-alpha.2

## 3.0.0-alpha.1

## 3.0.0-alpha.0

## 2.68.1

## 2.68.0

## 2.67.11

## 2.67.10

## 2.67.9

## 2.67.8

## 2.67.7

## 2.67.6

## 2.67.5

## 2.67.4

## 2.67.3

## 2.67.2

## 2.67.1

## 2.67.0

## 2.66.0

## 2.65.5

## 2.65.4

## 2.65.3

## 2.65.2

## 2.65.1

## 2.65.0

## 2.64.3

## 2.64.2

## 2.64.1

## 2.64.0

## 2.63.7

## 2.63.6

## 2.63.5

## 2.63.4

## 2.63.3

## 2.63.2

## 2.63.1

## 2.63.0

## 2.62.1

### Patch Changes

- 6203806: fix: new and upgrade command run error

  fix: 修复 new 命令和 upgrade 命令执行报错

## 2.62.0

## 2.61.0

### Minor Changes

- 2c95681: feat: create tools and new command not support Module project

  feat: create 工具和 new 命令不再支持模块项目

## 2.60.6

## 2.60.5

## 2.60.4

### Patch Changes

- d6986c5: feat: optimize generator download

  feat: 优化生成器下载

## 2.60.3

## 2.60.2

### Patch Changes

- 0b6d335: feat: create tools support --time option

  feat: create 工具支持 --time 选项

- 0b6d335: feat: Optimize generator log information

  feat: 优化生成器日志信息

## 2.60.1

## 2.60.0

### Patch Changes

- 65b2922: feat: generator update json add endWithNewLine params

  feat: 生成器更新 json 文件增加 endWithNewLine 参数

## 2.59.0

## 2.58.3

## 2.58.2

### Patch Changes

- 7715b6d: feat: update codesmith version

  feat: 更新 codesmith 版本

## 2.58.1

## 2.58.0

## 2.57.1

## 2.57.0

## 2.56.2

## 2.56.1

## 2.56.0

## 2.55.0

## 2.54.6

## 2.54.5

## 2.54.4

## 2.54.3

## 2.54.2

## 2.54.1

## 2.54.0

## 2.53.0

### Minor Changes

- f0aa3d3: feat: @modern-js/create not support create Monorepo Project

  feat: @modern-js/create 移除创建 Monorepo 项目

## 2.52.0

## 2.51.0

## 2.50.0

## 2.49.4

## 2.49.3

## 2.49.2

## 2.49.1

## 2.49.0

## 2.48.6

## 2.48.5

## 2.48.4

## 2.48.3

## 2.48.2

## 2.48.1

## 2.48.0

## 2.47.1

## 2.47.0

## 2.46.1

## 2.46.0

## 2.45.0

## 2.44.0

## 2.43.0

## 2.42.2

### Patch Changes

- fa731a7: chore: bump codesmith to 2.3.2
  chore: 升级 codesmith 版本到 2.3.2

## 2.42.1

## 2.42.0

### Patch Changes

- b182eb2: chore: bump codesmith v2.3.1 to show timing
  chore: 升级 codesmith 到 v2.3.1, 用于展示执行时间

## 2.41.0

## 2.40.0

## 2.39.2

## 2.39.1

## 2.39.0

## 2.38.0

### Patch Changes

- 8f43163: feat: optimize generator bundle

  feat: 优化生成器打包

## 2.37.2

## 2.37.1

## 2.37.0

## 2.36.0

## 2.35.1

## 2.35.0

## 2.34.0

## 2.33.1

## 2.33.0

## 2.32.1

## 2.32.0

## 2.31.2

## 2.31.1

## 2.31.0

## 2.30.0

## 2.29.0

## 2.28.0

## 2.27.0

## 2.26.0

## 2.25.2

## 2.25.1

## 2.25.0

## 2.24.0

## 2.23.1

## 2.23.0

### Patch Changes

- 7e6fb5f: chore: publishConfig add provenance config

  chore: publishConfig 增加 provenance 配置

## 2.22.1

## 2.22.0

### Patch Changes

- b647c68: chore(generator): update codesmith version

  chore(generator): 更新 codesmith 版本

## 2.21.1

## 2.21.0

### Patch Changes

- 26dcf3a: chore: bump typescript to v5 in devDependencies

  chore: 升级 devDependencies 中的 typescript 版本到 v5

- de8f73f: feat: update codesmith version

  feat: 更新 codesmith 版本

## 2.20.0

### Patch Changes

- 6b9d90a: chore: optimize bundle size
  chore: 优化打包体积
- 6b9d90a: chore: remove @babel/runtime. add @swc/helper and enable `externalHelper` config.
  chore: 移除 @babel/runtime 依赖. 增加 @swc/helpers 依赖并且开启 `externalHelpers` 配置

## 2.19.1

## 2.19.0

## 2.18.1

### Patch Changes

- 21c87bf: feat: bump codesmith packages version

  feat: 升级 codesmith 包版本

- bc61dab: feat: bump codesmith version

  feat: 升级 codesmith 版本

## 2.18.0

## 2.17.1

## 2.17.0

## 2.16.0

### Patch Changes

- 4e876ab: chore: package.json include the monorepo-relative directory

  chore: 在 package.json 中声明 monorepo 的子路径

- 355d36e: feat: adjust create tools and new command option order

  feat: 调整 create 工具及 new 命令 option 操作顺序

## 2.15.0

## 2.14.0

## 2.13.4

## 2.13.3

## 2.13.2

## 2.13.1

## 2.13.0

### Patch Changes

- 034f36b: feat: set the default language of CLI to English

  feat: 将命令行的默认语言设置为英文

- 034f36b: fix(upgrade): i18n of upgrade command not work

  fix(upgrade): 修复 upgrade 命令的 i18n 配置不生效的问题

## 2.12.0

## 2.11.0

## 2.10.0

### Patch Changes

- 0da32d0: chore: upgrade jest and puppeteer
  chore: 升级 jest 和 puppeteer 到 latest

## 2.9.0

## 2.8.0

## 2.7.0

## 2.6.0

## 2.5.0

### Patch Changes

- 577084d: feat: update codesmith version

  feat: 更新 codesmith 版本

## 2.4.0

### Patch Changes

- b4e01e7: chore: rename MWA to Web App

  chore: 将 MWA 重命名为 Web App

## 2.3.0

## 2.2.0

## 2.1.0

## 2.0.2

## 2.0.1

## 2.0.0

### Major Changes

- dda38c9c3e: chore: v2

## 2.0.0-beta.7

### Major Changes

- dda38c9c3e: chore: v2

## 2.0.0-beta.6

### Major Changes

- dda38c9c3e: chore: v2

### Patch Changes

- cc971eabfc: refactor: move server plugin load logic in `@modern-js/core`
  refactor：移除在 `@modern-js/core` 中的 server 插件加载逻辑
- 6b6f180279: fix: generator bundle

  fix: 生成器打包

## 2.0.0-beta.4

### Major Changes

- dda38c9c3e: chore: v2

### Patch Changes

- cc971eabfc: refactor: move server plugin load logic in `@modern-js/core`
  refactor：移除在 `@modern-js/core` 中的 server 插件加载逻辑
- 6b6f180279: fix: generator bundle

  fix: 生成器打包

## 2.0.0-beta.3

### Major Changes

- dda38c9c3e: chore: v2

### Patch Changes

- cc971eabfc: refactor: move server plugin load logic in `@modern-js/core`
  refactor：移除在 `@modern-js/core` 中的 server 插件加载逻辑
- 6b6f180279: fix: generator bundle

  fix: 生成器打包

## 2.0.0-beta.2

### Major Changes

- dda38c9c3e: chore: v2

### Patch Changes

- cc971eabfc: refactor: move server plugin load logic in `@modern-js/core`
  refactor：移除在 `@modern-js/core` 中的 server 插件加载逻辑
- 6b6f180279: fix: generator bundle

  fix: 生成器打包

## 2.0.0-beta.1

### Major Changes

- dda38c9: chore: v2

### Patch Changes

- cc971eabfc: refactor: move server plugin load logic in `@modern-js/core`
  refactor：移除在 `@modern-js/core` 中的 server 插件加载逻辑
- 6b6f180279: fix: generator bundle

  fix: 生成器打包

## 2.0.0-beta.0

### Major Changes

- dda38c9: chore: v2

### Patch Changes

- cc971eabf: refactor: move server plugin load logic in `@modern-js/core`
  refactor：移除在 `@modern-js/core` 中的 server 插件加载逻辑
- 6b6f180: fix: generator bundle

  fix: 生成器打包

## 1.21.2

### Patch Changes

- 7c89bd6: feat: @modern-js/create support --packages params to set special packages version

  feat: @modern-js/create 支持 --packages 参数用于指定特殊的包版本

## 1.21.1

## 1.21.0

### Patch Changes

- cfd8557: feat: new command install not run prepare scripts

  feat: new 命令安装依赖时不执行 prepare 脚本

## 1.20.1

## 1.20.0

## 1.19.0

## 1.18.1

## 1.18.0

## 1.17.0

## 1.16.0

### Minor Changes

- 1100dd58c: chore: support react 18

  chore: 支持 React 18

### Patch Changes

- 9d9bbfd05: feat: update codesmith package

  feat: 升级 codesmith 包版本

## 1.15.0

## 1.6.0

### Minor Changes

- 52374e3: chore(generator): use module-tools bundle function to bundle generator package

  chore(generator): 使用 module-tools 的 bundle 功能实现生成器打包

## 1.5.0

### Minor Changes

- 33cebd2: chore(plugin-i18n): merge `@modern-js/i18n-cli-language-detector` to `@modern-js/plugin-i18n`

  chore(plugin-i18n): 合并 `@modern-js/i18n-cli-language-detector` 包到 `@modern-js/plugin-i18n` 包作为子路径

## 1.4.5

### Patch Changes

- 341bb42: feat: bump codesmith package version

## 1.4.4

### Patch Changes

- a1198d509: feat: bump babel 7.18.0
- c7e38b4e6: feat: upgrade codesmith pkg version

## 1.4.3

### Patch Changes

- d6fc58a3d: fix: create toolkit command

## 1.4.2

### Patch Changes

- 6b0bb5e3b: feat: bump codesmith version

## 1.4.1

### Patch Changes

- 895fa0ff: chore: using "workspace:\*" in devDependencies

## 1.4.0

### Minor Changes

- 2b12032c: feat: upgrade csmith tools

### Patch Changes

- 6cffe99d: chore:
  remove react eslint rules for `modern-js` rule set.
  add .eslintrc for each package to speed up linting
- 04ae5262: chore: bump @modern-js/utils to v1.4.1 in dependencies

## 1.3.2

### Patch Changes

- 07a4887e: feat: prebundle commander and signale to @modern-js/utils

## 1.3.1

### Patch Changes

- e06c7c25: change generator main path on development mode

## 1.3.0

### Minor Changes

- cfe11628: Make Modern.js self bootstraping

## 1.2.4

### Patch Changes

- f73fee4b: feat: upgrade codesmith version to add get npm package timeout's time

## 1.2.2

### Patch Changes

- 4a5214db: fix: generator plugin error

## 1.2.0

### Minor Changes

- e12b3d0b: feat: support generator plugin

### Patch Changes

- e12b3d0b: feat: upgrade codesmith version

## 1.1.3

### Patch Changes

- f6115185: fix create toolkit module params

## 1.1.2

### Patch Changes

- 2debc5eb: fix: fix create tools default config

## 1.1.1

### Patch Changes

- d93a5d82: feat: change initial repo default branch

## 1.1.0

### Minor Changes

- 96119db2: Relese v1.1.0

## 1.0.0

### Patch Changes

- 224f7fe: fix server route match
- 30ac27c: feat: add generator package description
- 0fd196e: feat: fix bugs
- 204c626: feat: initial
- 63be0a5: fix: #118 #104

## 1.0.0-rc.23

### Patch Changes

- 224f7fe: fix server route match
- 30ac27c: feat: add generator package description
- 0fd196e: feat: fix bugs
- 204c626: feat: initial
- 63be0a5: fix: #118 #104

## 1.0.0-rc.22

### Patch Changes

- 224f7fe: fix server route match
- 30ac27c: feat: add generator package description
- 0fd196e: feat: fix bugs
- 204c626: feat: initial
- 63be0a5: fix: #118 #104

## 1.0.0-rc.21

### Patch Changes

- 224f7fe: fix server route match
- 30ac27c: feat: add generator package description
- 0fd196e: feat: fix bugs
- 204c626: feat: initial
- 63be0a5: fix: #118 #104

## 1.0.0-rc.20

### Patch Changes

- 224f7fe: fix server route match
- 30ac27c: feat: add generator package description
- feat: fix bugs
- 204c626: feat: initial
- 63be0a5: fix: #118 #104

## 1.0.0-rc.19

### Patch Changes

- 224f7fe: fix server route match
- 30ac27c: feat: add generator package description
- 204c626: feat: initial
- 63be0a5: fix: #118 #104

## 1.0.0-rc.18

### Patch Changes

- 224f7fe: fix server route match
- 30ac27c: feat: add generator package description
- 204c626: feat: initial
- 63be0a5: fix: #118 #104

## 1.0.0-rc.17

### Patch Changes

- 224f7fe: fix server route match
- 30ac27c: feat: add generator package description
- 204c626: feat: initial
- fix: #118 #104

## 1.0.0-rc.16

### Patch Changes

- 224f7fe: fix server route match
- 30ac27c: feat: add generator package description
- 204c626: feat: initial

## 1.0.0-rc.15

### Patch Changes

- 224f7fe: fix server route match
- 30ac27c: feat: add generator package description
- 204c626: feat: initial

## 1.0.0-rc.14

### Patch Changes

- 224f7fe: fix server route match
- 204c626: feat: initial

## 1.0.0-rc.13

### Patch Changes

- 224f7fe: fix server route match
- 204c626: feat: initial

## 1.0.0-rc.12

### Patch Changes

- 224f7fe: fix server route match
- 204c626: feat: initial

## 1.0.0-rc.11

### Patch Changes

- 224f7fe: fix server route match
- 204c626: feat: initial

## 1.0.0-rc.10

### Patch Changes

- 224f7fe: fix server route match
- 204c626: feat: initial

## 1.0.0-rc.9

### Patch Changes

- 224f7fe: fix server route match
- 204c626: feat: initial

## 1.0.0-rc.8

### Patch Changes

- 224f7fe: fix server route match
- 204c626: feat: initial

## 1.0.0-rc.7

### Patch Changes

- 224f7fe: fix server route match
- 204c626: feat: initial

## 1.0.0-rc.6

### Patch Changes

- 224f7fe: fix server route match
- 204c626: feat: initial

## 1.0.0-rc.5

### Patch Changes

- 224f7fe: fix server route match
- 204c626: feat: initial

## 1.0.0-rc.4

### Patch Changes

- fix server route match
- 204c626: feat: initial

## 1.0.0-rc.3

### Patch Changes

- feat: initial
