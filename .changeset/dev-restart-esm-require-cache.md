---
'@modern-js/app-tools': patch
---

Editing `modern.config.ts` during `dev` no longer crashes the restart with `Cannot find module './plugins/analyze'` when the ESM build is loaded.
