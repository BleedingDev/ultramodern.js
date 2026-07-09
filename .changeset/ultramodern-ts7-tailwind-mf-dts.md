---
'@modern-js/builder': patch
'@modern-js/create': patch
---

Default UltraModern workspaces to TypeScript 7 and the Rsbuild Tailwind CSS plugin, remove generated PostCSS configuration from the Tailwind path, and keep Module Federation DTS generation on the `@effect/tsgo` executable while quarantining current Module Federation compiler-API internals on `@typescript/typescript6`.

The builder TS-Go resolver now prefers app-local TypeScript 7 packages and keeps the native-preview package as a compatibility fallback.
