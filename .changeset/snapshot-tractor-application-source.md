---
'@modern-js/create': patch
---

Run the downstream Tractor workspace check and commit the migrated,
install-materialized application source before release builds so Node and
workerd artifacts carry a clean promotable Git revision.
