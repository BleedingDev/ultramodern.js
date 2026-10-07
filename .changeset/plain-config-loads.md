---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/app-tools-extensions': patch
'@modern-js/app-tools': patch
'@modern-js/plugin': patch
'@modern-js/ultramodern-create': patch
---

Config loading no longer records or re-checks the files a config reads. `dev`, `build`, `serve` and `deploy` load `modern.config` the normal Modern way; a config change restarts dev as usual. The `./config-evaluator`, `./config-evaluator-worker` and `./native-config-load` exports of `@modern-js/ultramodern-app-tools` and `./native-config-load-provider` of `@modern-js/app-tools-extensions` are removed, as are the `wrapConfigLoad` CLI option and the `packageMetadataRead` app context field of `@modern-js/plugin`. The create and add commands read each app's renderer and entries with `loadUltramodernConfigMetadata` from the new `./config-metadata` export, which loads the config once in a short-lived Node process. They no longer snapshot the workspace or fail with "changed a source input consumed by modern.config"; a CodeSmith overlay that edits files outside the app it adds is still rejected.
