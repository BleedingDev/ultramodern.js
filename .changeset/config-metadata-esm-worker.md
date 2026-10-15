---
'@modern-js/ultramodern-app-tools': patch
---

Load `modern.config` metadata in the ESM worker, so configs whose imports read `import.meta` (such as Effect's `ConfigProvider`) load during `ultramodern validate` and `sync-delivery-unit` instead of failing with "Cannot use 'import.meta' outside a module".
