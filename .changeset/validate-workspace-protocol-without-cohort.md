---
'@modern-js/ultramodern-create': patch
---

`ultramodern validate` requires the installed release cohort only when a
workspace resolves framework packages through the `ultramodern` catalog.
Workspaces generated with `--ultramodern-package-source workspace` validate
without it.
