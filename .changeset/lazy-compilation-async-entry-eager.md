---
'@modern-js/app-tools': patch
---

Keep the generated async entry module out of the default dev lazy compilation, so the first page load no longer rebuilds the whole entry (`building .modern-js/<entry>/index.jsx`).
