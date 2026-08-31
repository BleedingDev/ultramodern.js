---
'@modern-js/ultramodern-create': minor
---

Split the 8.5k-line ultramodern workspace scaffolder into focused modules, move generated workspace scripts and static app files into real template files under templates/, centralize every version pin and skill-repo commit hash in versions.ts, and make create package root resolution walk up parent directories (bounded to a fixed number of ancestor levels with a clear error). The full generated file list (79-file default scaffold plus the 24-file vertical add) and the rendered contents of the highest-risk generated files are pinned by snapshot tests.

Generated output is byte-identical to the previous scaffolder except for two intentionally amended provenance fields in `.modernjs/ultramodern-workspace-template-manifest.json`: `source.generator` now points at the module directory `packages/toolkit/ultramodern-create/src/ultramodern-workspace/` (the old monolith path it referenced was deleted), and `integrity.checksums` gains a second sha256 entry (`scope: "file-templates-tree"`) covering the new templates/ tree that now directly produces generated output.
