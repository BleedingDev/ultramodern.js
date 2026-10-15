---
"@modern-js/ultramodern-create": patch
---

Let shell routes load through the native Module Federation instance in browser-only code that both `pnpm typecheck` and `pnpm contract:check` accept:

- `instance.loadRemote()` and `instance.loadShare()` pass architecture validation inside the true branch of `import.meta.env.MODERN_TARGET === 'browser'` (an `if` or ternary condition, alone or in an `&&` chain), when the TypeScript checker types `instance` as the `ModuleFederation` instance returned by `getInstance` from `@module-federation/modern-js-v3/runtime`. Unguarded, node-guarded, loosely compared, optional-chained, stored-comparison, untyped and hand-rolled loads still fail, including when the receiver is a call such as `getInstance()!`.
- Shell routes may not read `process.env` at all, including `process.env.MODERN_TARGET`, because the generated Effect `processEnv` rule rejects it at typecheck. Config files reject `import.meta.env.MODERN_TARGET`, since config runs in Node where the framework defines no build target.
