---
'@modern-js/app-tools': patch
---

Stop absent copy directories such as config/upload from triggering an extra rebuild at the start of every dev session; creating them later still rebuilds and copies.
