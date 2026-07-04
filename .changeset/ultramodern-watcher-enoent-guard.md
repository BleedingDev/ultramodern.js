---
'@modern-js/plugin': patch
---

Fix the CLI file watcher (used by MF DTS generation and `onFileChanged`) crashing the dev server with an unhandled rejection when a transient editor temp file (e.g. `page.tsx.tmp.<pid>.<hash>`) is deleted between the chokidar `change`/`add` event and the subsequent `fs.readFileSync` — the read now treats ENOENT as a benign skip instead of throwing.
