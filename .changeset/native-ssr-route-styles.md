---
'@modern-js/ultramodern-app-tools': patch
---

Solid and Octane server documents now link the application's stylesheets (entry, layout and route CSS) in the head and preload its modules, so the first paint is styled before any client script runs. `renderer-assets.json` entries list stylesheets first, then module preloads, then entry scripts. Lazy component styles still load with their component.
