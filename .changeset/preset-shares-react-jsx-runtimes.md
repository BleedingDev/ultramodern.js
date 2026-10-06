---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/ultramodern-create': patch
---

`presetUltramodern` shares `react/jsx-runtime` and `react/jsx-dev-runtime` as
singletons at the shared React version whenever an app's Module Federation
config shares `react`, so hand-written federation configs get one JSX runtime
across host and remotes. Generated workspaces declare the same entries.
