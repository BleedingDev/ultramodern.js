---
'@modern-js/ultramodern-app-tools': patch
---

React router bindings record the `react-router` and `@tanstack/react-router`/`@tanstack/router-core` versions the application actually installs through `@modern-js/runtime` and `@modern-js/plugin-tanstack`, so an app that shares an earlier router patch with the framework (for example through pnpm overrides) records that version in `renderer-build.json` and in `ultramodern validate` alike. An app whose dependencies are not installed yet still binds the framework's declared routers.
