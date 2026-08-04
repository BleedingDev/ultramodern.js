---
'@modern-js/create': patch
---

Repair `effect@4.0.0-beta.102`'s own `Schema.d.ts` in generated workspaces.

beta.102 marked `SchemaAST.collectSentinels` `@internal`, which erased the
`Sentinel` type from `SchemaAST.d.ts` — but `Schema.d.ts` still references
`SchemaAST.Sentinel` from a public annotation interface. Effect's published
types therefore fail their own `tsgo` check with `TS2694: Namespace
'.../SchemaAST' has no exported member 'Sentinel'`, which took down every
generated vertical's `modern build`. beta.103 has not fixed it. The generated
workspace patch gains a second hunk that retypes the `@internal`-only
`"~sentinels"` property as `ReadonlyArray<unknown>`, leaving the property in
place for internal callers while removing the dangling reference.

修复生成工作区中 `effect@4.0.0-beta.102` 自身的 `Schema.d.ts`。

beta.102 将 `SchemaAST.collectSentinels` 标记为 `@internal`，导致 `Sentinel` 类型从
`SchemaAST.d.ts` 中被擦除 —— 但 `Schema.d.ts` 的公开注解接口仍在引用
`SchemaAST.Sentinel`。因此 Effect 发布的类型无法通过自身的 `tsgo` 检查，报
`TS2694: Namespace '.../SchemaAST' has no exported member 'Sentinel'`，使每个生成
vertical 的 `modern build` 全部失败；beta.103 亦未修复。生成工作区的补丁新增第二个
hunk，将仅供内部使用的 `"~sentinels"` 属性重新标注为 `ReadonlyArray<unknown>`，在
保留该属性供内部调用方使用的同时移除悬空引用。
