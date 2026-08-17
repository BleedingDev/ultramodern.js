---
"@modern-js/plugin-bff": patch
"@modern-js/server-utils": patch
---

Make published crossProject BFF client declarations resolvable in consumer projects.

The server compiler no longer forces `declaration: false`, so an app that asks for
declarations gets them, and the post-emit specifier rewrite now covers `.d.ts` /
`.d.mts` / `.d.cts` so tsconfig path aliases never leak into published types. The
client generator stops copying a handler declaration into `dist/client` (which
broke every relative specifier inside it) and instead writes a facade that
re-exports the declaration in place, ships the whole `dist/**/*.d.ts` closure, and
only generates clients for the API files `ApiRouter` resolved. A handler whose
declaration was not emitted now fails the build instead of publishing a package
whose advertised types silently degrade to `any`.
