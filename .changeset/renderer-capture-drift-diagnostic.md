---
'@modern-js/app-tools-extensions': patch
---

When a renderer build no longer matches the identity captured in `shared/ultramodern-build.json` (for example after renaming the main entry in modern.config), the build error now names the drifted entries and tells you to recapture with `ultramodern-create ultramodern sync-delivery-unit`.
