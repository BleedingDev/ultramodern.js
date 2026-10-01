---
'@modern-js/utils': patch
'@modern-js/plugin': patch
---

Generate bundled dependencies during builds and include their declarations,
licenses and provenance in releases instead of tracking generated files in Git.

Keep the file-watcher return declaration anchored to the public utils type.
