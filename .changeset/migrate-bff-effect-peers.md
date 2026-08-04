---
'@modern-js/create': patch
---

`ultramodern migrate-strict-effect` now supplies plugin-bff's optional Effect peers.

Generating a workspace already declares `effect` and `@effect/opentelemetry`,
but migrating an existing one did not: `updateGeneratedToolingDependencies` only
re-pins dependencies a manifest already declares, so a workspace scaffolded
before plugin-bff moved those to optional peers came out of migration with no
Effect at all. The BFF lane then had nothing to load, and the
`effect@<version>` entry the same migration writes into `patchedDependencies`
matched no package, so `pnpm install` rejected the migrated workspace with
`ERR_PNPM_UNUSED_PATCH`. Migration now adds both pins to every manifest that
depends on `@modern-js/plugin-bff`.

`ultramodern migrate-strict-effect` 现在会补齐 plugin-bff 的可选 Effect peer。

生成工作区时已会声明 `effect` 与 `@effect/opentelemetry`，但迁移既有工作区时不会：
`updateGeneratedToolingDependencies` 只会重新固定清单中**已声明**的依赖，因此在
plugin-bff 将二者改为可选 peer 之前搭建的工作区，迁移后完全没有 Effect。此时 BFF
通道无 Effect 可加载，且同一迁移写入 `patchedDependencies` 的 `effect@<version>`
条目匹配不到任何包，导致 `pnpm install` 以 `ERR_PNPM_UNUSED_PATCH` 拒绝迁移后的
工作区。现在迁移会为每个依赖 `@modern-js/plugin-bff` 的清单补上这两个 pin。
