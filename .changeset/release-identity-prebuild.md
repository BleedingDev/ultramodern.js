---
'@modern-js/app-tools-extensions': patch
'@modern-js/ultramodern-app-tools': patch
---

A delivery unit now has one release identity that is known before the build and carried unchanged by it. `resolveUltramodernReleaseIdentity` returns a 64-hex marker for a clean source revision (the full digest of unit id, generation marker and revision; it was the first 16 hex). A UI unit's renderer adopts that marker as its `buildId` in promotable production builds, so contracts, release plans and Worker names resolved before the build match `ultramodern-build.json`, `renderer-build.json`, chunk banners, `ULTRAMODERN_BUILD_MARKER` and the release envelope, as API-only units already did. Development and dirty-tree builds keep a per-process `buildId`. Consumers that validated a 16-hex marker must accept the 64-hex one.
