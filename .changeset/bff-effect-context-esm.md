---
'@modern-js/bff-effect': patch
---

`@modern-js/bff-effect`, `/effect` and `/context` resolve to the ESM build for `import` outside Node, like the other subpaths. A workerd bundle of `/effect-edge` no longer pulls the CJS request storage into its ESM graph.
