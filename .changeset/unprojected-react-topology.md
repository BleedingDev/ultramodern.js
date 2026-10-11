---
'@modern-js/app-tools-extensions': patch
'@modern-js/ultramodern-app-tools': patch
'@modern-js/ultramodern-create': patch
---

Workspaces whose `topology/reference-topology.json` predates renderer selection (no `renderer`, `rendererIdentity`, `rendererProfile` or `routerBindings` on a React app) validate and build again. `ultramodern validate` still reconciles the React selection from `modern.config` and checks the app's dependencies, and the build resolves the UI renderer identity from the app config; a topology that does persist a renderer projection must still match it exactly, and a partial projection is rejected.
