---
'@modern-js/plugin-bff': minor
---

Declare `effect` and `@effect/opentelemetry` as optional exact peer dependencies
of `@modern-js/plugin-bff` instead of hard dependencies. Effect 4 derives
`Context` / `Service` keys per module instance, so a bundled copy of `effect`
inside the plugin gave consumers a second Effect identity whenever their own pin
differed. The two move together because `@effect/opentelemetry` declares a
REQUIRED `effect` peer of its own; leaving it in `dependencies` would re-impose
that peer on every consumer transitively. The peers are pinned exact
(`4.0.0-beta.102`) because UltraModern ships Effect as one lockstep cohort — the
generated-workspace patch, the release-age approval ledger and the registry
integrity digests are all keyed to that exact version — and NOT because a range
would be unsatisfiable: `@effect/opentelemetry`'s own `^4.0.0-beta.102` does span
later betas. The trade-off is deliberate: a consumer pinned to a different beta
sees `ERR_PNPM_PEER_DEP_ISSUES` under `--strict-peer-dependencies` and must move
with the cohort.

`@modern-js/plugin-bff/server-plugin` now loads the Effect adapter through a
dynamic import, so the Hono lane no longer pulls `effect/*` into its eager module
graph. Consumers using only `runtimeFramework: 'hono'` or the `./data-platform`
lane need neither package installed. Consumers using `./effect`,
`./effect-server`, `./effect-edge`, `./effect-client`, or
`runtimeFramework: 'effect'` must now install `effect@4.0.0-beta.102` and
`@effect/opentelemetry@4.0.0-beta.102` themselves. Mirrored exact devDependencies
keep local builds and dts emit working under this repository's
`autoInstallPeers: false` policy.

将 `effect` 与 `@effect/opentelemetry` 从 `@modern-js/plugin-bff` 的直接依赖改为可选的
精确 peer 依赖。Effect 4 的 `Context` / `Service` 键按模块实例生成，插件自带一份 `effect`
会让固定了不同版本的使用方出现第二份 Effect 身份。两者必须一起下沉，因为
`@effect/opentelemetry` 自身声明了必需的 `effect` peer，若继续留在 `dependencies` 中，
该 peer 会被传递地强加给所有使用方。peer 采用精确版本（`4.0.0-beta.102`），原因是
UltraModern 以锁步依赖组的方式发布 Effect——生成工作区补丁、release-age 审批账本与
registry 完整性摘要都绑定到该精确版本——而不是因为版本范围不可满足：
`@effect/opentelemetry` 自身的 `^4.0.0-beta.102` 确实可以跨越后续 beta。这是有意的取舍：
固定到其他 beta 的使用方在 `--strict-peer-dependencies` 下会看到
`ERR_PNPM_PEER_DEP_ISSUES`，需要随依赖组一起升级。

`@modern-js/plugin-bff/server-plugin` 现在通过动态 import 加载 Effect adapter，因此
Hono 通道不再把 `effect/*` 拉进立即求值的模块图。只使用 `runtimeFramework: 'hono'` 或
`./data-platform` 通道的使用方无需安装这两个包。使用 `./effect`、`./effect-server`、
`./effect-edge`、`./effect-client` 或 `runtimeFramework: 'effect'` 的使用方需要自行安装
`effect@4.0.0-beta.102` 与 `@effect/opentelemetry@4.0.0-beta.102`。同时镜像一份精确的
devDependency，以便在本仓库 `autoInstallPeers: false` 策略下仍能正常构建与生成类型。
