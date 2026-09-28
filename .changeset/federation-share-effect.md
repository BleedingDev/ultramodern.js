---
'@modern-js/ultramodern-app-tools': patch
---

`presetUltramodern` shares `effect` wherever it shares `@modern-js/bff-effect`. The bff-effect modules re-export Effect, so a host that decoded a remote's schemas used to run a second copy of Effect. `effect` and every `effect/*` subpath are now shared as singletons, at the version that the installed `@modern-js/bff-effect` resolves, which is the version the release cohort pins.
