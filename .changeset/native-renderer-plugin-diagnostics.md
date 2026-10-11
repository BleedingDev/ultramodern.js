---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/app-tools-extensions': patch
---

Switching renderers now fails early with actionable messages: React-only plugins (TanStack, i18n, Module Federation, runtime plugins) are named with what to do for a native renderer, route modules authored for another renderer are listed, and TS2875 missing jsx-runtime failures explain the selected jsxImportSource.
