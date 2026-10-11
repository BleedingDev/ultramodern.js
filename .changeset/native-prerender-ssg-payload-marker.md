---
'@modern-js/ultramodern-app-tools': patch
---

Static loader payloads captured during native prerendering now carry the same `x-modern-ssg-render` marker as the document render, so a loader that branches on it produces payloads matching the prerendered HTML.
