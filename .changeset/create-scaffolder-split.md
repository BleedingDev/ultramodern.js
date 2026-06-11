---
'@modern-js/create': patch
---

Split the 8.5k-line ultramodern workspace scaffolder into focused modules, move generated workspace scripts and static app files into real template files under templates/, centralize every version pin and skill-repo commit hash in versions.ts, and make create package root resolution walk up parent directories. Generated output is byte-identical.
