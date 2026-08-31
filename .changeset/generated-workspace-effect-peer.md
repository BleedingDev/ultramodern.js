---
'@modern-js/ultramodern-create': patch
---

Declare `effect` and `@effect/opentelemetry` in generated UltraModern workspaces.

`@modern-js/plugin-bff` declares both as **optional** peers so a hono-only
consumer is never forced to install Effect. Every generated workspace runs the
strict Effect BFF lane, so nothing was left to install them: a generated
workspace resolved no `effect` at all. That broke two things at once — the BFF
lane had no Effect to load at runtime, and the `effect@<version>` entry in the
generated `patchedDependencies` matched no package, so `pnpm install` failed the
workspace outright with `ERR_PNPM_UNUSED_PATCH`. The generated root package, and
every app that depends on `plugin-bff`, now carry both at the exact cohort
version, which is what keeps a single Effect Context/Service identity.

在生成的 UltraModern 工作区中显式声明 `effect` 与 `@effect/opentelemetry`。

`@modern-js/plugin-bff` 将二者声明为**可选** peer，使仅使用 hono 的消费者无需安装
Effect。但每个生成的工作区都运行严格 Effect BFF 通道，却没有任何包负责安装它们：
生成的工作区最终解析不到 `effect`。这同时破坏了两处 —— BFF 通道在运行时没有 Effect
可加载，且生成的 `patchedDependencies` 中的 `effect@<version>` 条目匹配不到任何包，
导致 `pnpm install` 直接以 `ERR_PNPM_UNUSED_PATCH` 失败。现在生成的根包以及每个依赖
`plugin-bff` 的应用都会以精确的依赖组版本携带二者，从而保持单一的 Effect
Context/Service 标识。
