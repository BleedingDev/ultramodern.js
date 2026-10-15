---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/ultramodern-create': patch
---

Let API-only units use `presetUltramodernWorkspace`: a headless unit (topology renderer `none`) no longer needs a browser Module Federation name, and its config must not select a renderer. Generated API-only configs omit `renderer`, and `performance-readiness` only requires `tanstackRouterPlugin` for units that render UI.
