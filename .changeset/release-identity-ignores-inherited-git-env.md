---
'@modern-js/app-tools-extensions': patch
---

Resolve the release source revision from the workspace itself, ignoring inherited `GIT_*` variables such as the `GIT_DIR` and `GIT_INDEX_FILE` a git hook exports, so dirty source is never labeled with a clean HEAD.
