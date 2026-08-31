---
'@modern-js/ultramodern-create': patch
'@modern-js/plugin-bff': patch
---

Move the UltraModern Effect cohort from `4.0.0-beta.97` to `4.0.0-beta.102`.
`effect`, `@effect/opentelemetry`, and `@effect/vitest` advance together. The
beta.97 release-age approvals are removed rather than re-issued: every package in
the cohort published on 2026-07-26 and has since matured past
`minimumReleaseAge`, so no approval is required to install them. Effect renamed
its `httpapi` type vocabulary in `4.0.0-beta.98`, so the
BFF Effect lane and the generated vertical API client now use
`HttpApi.Constraint` / `HttpApi.Top` and `HttpApiGroup.Constraint` instead of the
removed `Any` / `AnyWithProps` aliases, and endpoint reflection reads
`endpoint.identifier` instead of the removed `endpoint.name` so operation
contracts keep their real endpoint names. The generated workspace patch for
`effect` drops its now-dead `SchemaError` type-id hunk and keeps only the
`preResponseHandler` declaration hunk, and `migrate-strict-effect` recognizes the
superseded beta.97 release-age and trust-policy entries.

将 UltraModern 的 Effect 依赖组从 `4.0.0-beta.97` 升级到 `4.0.0-beta.102`。
`effect`、`@effect/opentelemetry` 与 `@effect/vitest` 同步升级。beta.97 的
release-age 审批被移除而非重新签发：该依赖组的所有包均于 2026-07-26 发布，现已超过
`minimumReleaseAge`，安装时不再需要审批。Effect 在 `4.0.0-beta.98` 重命名了
`httpapi` 类型词汇，因此 BFF Effect 通道和生成的 vertical API client 改用
`HttpApi.Constraint` / `HttpApi.Top` 与 `HttpApiGroup.Constraint`，替换已被移除的
`Any` / `AnyWithProps`；端点反射改读 `endpoint.identifier` 而非已移除的
`endpoint.name`，使 operation contract 保留真实的端点名称。生成工作区的 `effect`
补丁移除了已失效的 `SchemaError` type-id hunk，仅保留 `preResponseHandler` 声明
hunk，`migrate-strict-effect` 也已识别被取代的 beta.97 release-age 与 trust-policy
条目。
