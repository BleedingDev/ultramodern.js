---
'@modern-js/app-tools-extensions': patch
'@modern-js/ultramodern-app-tools': patch
---

Each UI app now gets its own renderer `buildId`. The id also hashes the app id and delivery-unit id, so the shell, catalog and other apps built at one commit no longer share one build marker in `renderer-build.json`, `ultramodern-build.json` and release envelopes. The preset's delivery-unit release banner now comes from a builder plugin instead of `tools.rspack`, so React and native renderers replace it with the renderer `buildId`: every emitted script and `ULTRAMODERN_BUILD_MARKER` name the same marker as the manifests. Rebuild to pick up the new ids.
