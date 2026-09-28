---
'@modern-js/app-tools-extensions': patch
---

Resolve the Effect TS-Go compiler from its platform package instead of `effect-tsgo get-exe-path`, so Module Federation builds work on Linux musl (Alpine). The CLI probed Oxlint even for a TypeScript-only lookup and failed with "Linux musl is not supported by the packaged Oxlint integration" whenever Oxlint was installed.
