---
'@modern-js/ultramodern-create': patch
---

Retain asynchronous Module Federation server chunks instead of disabling all
splitting. Initial shared chunks remain excluded until the Node MF loader can
report their startup readiness correctly, even when asyncStartup is enabled.
