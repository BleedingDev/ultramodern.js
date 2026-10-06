---
'@modern-js/app-tools': patch
'@modern-js/app-tools-extensions': patch
'@modern-js/plugin-styled-components': patch
---

Declare the React peer that `@loadable/component` and `styled-components` need, so pnpm resolves them to the app's React instead of any React in the store.
