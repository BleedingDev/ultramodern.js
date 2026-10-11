---
'@modern-js/ultramodern-app-tools': patch
---

`presetUltramodern` now defaults React Module Federation builds to the `loaded-first` share strategy, like the Solid and Octane federation profiles. A host no longer loads every remote entry when it starts, so a remote it has not rendered yet cannot fail or slow down host startup, and the manifest-recovery hook handles the first real request. An authored `shareStrategy` is kept.
