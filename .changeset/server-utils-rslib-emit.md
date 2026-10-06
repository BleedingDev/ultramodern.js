---
'@modern-js/server-utils': minor
'@modern-js/app-tools': patch
---

Build BFF and server output with Rslib for the Node target. Rspack applies `source.alias` and tsconfig `paths` while it emits, so imported specifiers and source maps are right without a post-emit rewrite, and app sources imported from outside the server directories are emitted too. TS-Go now only type-checks (and emits declarations when the tsconfig asks for them); a failed type check still fails the build unless `noEmitOnError` is `false`.
