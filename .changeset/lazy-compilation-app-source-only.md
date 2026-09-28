---
'@modern-js/app-tools': patch
---

Make only the app's own source lazy under the default dev lazy compilation. Framework and `node_modules` imports, such as plugin-i18n's backend and `react-i18next`, compile with the entry, so the first page load no longer runs one HMR cycle per framework import.
