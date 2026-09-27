---
'@modern-js/code-tools': minor
---

`modern-api-check --rules <module>` runs consumer contract rules. Each rule receives the module graph of an API contract and can follow imports and re-exports across workspace packages to the declaring module or external package, with the full chain. The runner function `runMicroVerticalApiCheckCli` now returns a Promise.
