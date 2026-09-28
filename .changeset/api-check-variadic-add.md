---
'@modern-js/code-tools': patch
---

The MicroVertical API baseline check accepts Effect's variadic `add`. A root API can compose its foundation group and a generated group list in one call, `HttpApi.make('CatalogApi').add(catalogFoundationGroup, ...generatedGroups)`. The check follows each spread through the module graph to its array literal and traverses every group in it. A spread that does not resolve to an array literal still fails.
