---
'@modern-js/plugin-tanstack': patch
'@modern-js/ultramodern-create': patch
---

fix(routes-generate): resolve the app config file for headless TanStack route generation

`modern-js-create ultramodern routes-generate` crashed on real workspaces with
`The "path" argument must be of type string. Received type boolean (false)` and
wrote no artifacts. The headless module runs from the workspace root, but
`createRunOptions` resolves the Modern.js config file against `process.cwd()`
rather than the app directory. With no config found there, `findExists` returns
`false`, which flows into `cli.init` -> `getConfigFilePath` ->
`path.isAbsolute(false)` and throws.

`generateTanstackRouteArtifacts` now resolves the app's `modern.config.*` to an
absolute base path and passes it as `configFile`, so route generation is
cwd-independent, and throws a clear error when no config file exists. The
create CLI's route-generate failure path now prints the full stack and cause
chain instead of only `error.message`, so the underlying failure is no longer
swallowed.
