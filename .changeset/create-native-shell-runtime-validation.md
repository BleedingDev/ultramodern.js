---
"@modern-js/ultramodern-create": patch
---

Let shell routes use two native framework shapes that architecture validation used to reject:

- `process.env.MODERN_TARGET === 'browser'` or `=== 'node'` as an `if` or ternary condition. Modern.js defines this build target per bundler environment, so it is not ambient environment access. Other `process.env` reads still fail, and config files still reject it.
- `instance.loadRemote()` and `instance.loadShare()` inside a `process.env.MODERN_TARGET === 'browser'` branch, when the TypeScript checker types `instance` as the `ModuleFederation` instance returned by `getInstance` from `@module-federation/modern-js-v3/runtime`. Unguarded, node-guarded, untyped and hand-rolled loaders still fail, now also when the receiver is a call such as `getInstance()!`.
