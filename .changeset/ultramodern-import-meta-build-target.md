---
"@modern-js/ultramodern-app-tools": patch
---

Define `import.meta.env.MODERN_TARGET` in every React bundler environment with the same `'browser'` or `'node'` value as `process.env.MODERN_TARGET`, and type it through `@modern-js/ultramodern-app-tools/react-types`. Generated apps type-check with Effect's `processEnv` rule, which rejects `process.env.MODERN_TARGET`; `import.meta.env.MODERN_TARGET === 'browser'` is the build-target guard that type checking and architecture validation both accept, and each bundle still drops the other target's branch.
