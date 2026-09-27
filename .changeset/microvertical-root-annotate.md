---
'@modern-js/code-tools': patch
---

The MicroVertical API baseline check accepts `annotate`, `annotateMerge` and `middleware` on the root API, the combinators it already accepts on composed sub-APIs. A consumer can close its composed API with `.annotate(HttpApi.ParseOptions, { onExcessProperty: 'error' })`. The root must still start with its readiness foundation API.
