---
'@modern-js/builder': minor
---

feat(builder): run build-time type checking on TypeScript Go (`tsgo`) by default, resolving `@typescript/native-preview` from the project with a fallback to the copy bundled with the builder; set `tools.tsChecker.typescript.tsgo: false` to use the classic checker
