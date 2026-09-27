---
'@modern-js/plugin-bff-extensions': patch
'@modern-js/bff-effect': patch
'@modern-js/server-runtime-extensions': patch
'@modern-js/app-tools-extensions': patch
---

Load backend federation remotes through a real Module Federation instance with an integrity plugin. Each runtime evaluates a remote once and initializes it with its own share scope, so runtimes stay isolated without URL fragments and caller plugins see the Module Federation lifecycle. Node hosts share the Effect handler factory registry through that share scope instead of an extra evaluator parameter; generated containers adopt it in `init()`. Remove the global entry lookup, the manual plugin entry chain and per-expose re-entry. Rebuild backend containers with this release: older containers no longer receive the registry.
