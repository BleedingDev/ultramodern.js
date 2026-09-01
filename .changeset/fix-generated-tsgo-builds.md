---
'@modern-js/plugin-i18n': patch
'@modern-js/server-utils': patch
'@modern-js/ultramodern-create': patch
---

Keep the generated Modern.js type checker out of incompatible TypeScript build
mode, give federated consumers a narrow i18n runtime entry with explicit i18n
and distributed-SSR prop contracts, and resolve the stable `@typescript/native`
compiler before legacy native-preview fallbacks for BFF/server compilation.
