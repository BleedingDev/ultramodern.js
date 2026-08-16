---
"@modern-js/create": patch
"@modern-js/plugin-i18n": patch
---

Require `react-dom/client` in generated UltraModern bridge singleton contracts so React 19 federated roots hydrate through one renderer, and align the i18n plugin's React peer range with its required Modern.js runtime cohort.
