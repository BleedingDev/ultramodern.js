---
'@modern-js/render': patch
'@modern-js/server-utils': patch
---

RSC render and BFF compiler correctness fixes:

- The RSC server-action handler (`handleAction`) is now a single shared implementation bound by both the Node (`/rsc`) and edge worker (`/rsc-worker`) entries instead of two diverging 86-line copies. Behavior is unchanged in both lanes.
- The BFF tsgo compiler resolves `@typescript/native-preview` from the app directory first, then from `@modern-js/server-utils`' own dependency tree, and fails with an actionable "please install" error instead of a bare MODULE_NOT_FOUND in strict-isolation installs (pnpm hoist=false, Yarn PnP).
- Post-emit alias rewriting no longer uses a global regex over file contents: a lightweight lexer only rewrites real module syntax (`import`/`export ... from`, bare `import`, `import()`, `require()`), so specifier-shaped text inside strings, template literals and comments is left alone, and member calls like `Array.from('...')`/`foo.require('...')` are no longer touched.
- Rewritten outputs no longer ship stale sourcemaps: the `sourceMappingURL` pragma and the sibling `.map` file are dropped for files whose specifiers changed (untouched files keep their maps).
- `.mjs`/`.cjs` outputs emitted from `.mts`/`.cts` sources are now alias-rewritten too.
- The temporary `.tsgo.<pid>.<n>.resolved.json` config is written beside the app tsconfig (fixing relative `files`/`paths` bases when `server.tsconfigPath` points into a subdirectory), gets a unique per-compile name, and is always cleaned up — including when the tsgo process fails to spawn.
