---
'@modern-js/ultramodern-create': patch
---

Allow UltraModern workspaces generated with the reviewed Module Federation
2.7 patch cohort to migrate safely to the current cohort. The migrator still
rejects unknown selectors, paths, and patch hashes.
