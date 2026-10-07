---
'@modern-js/ultramodern-app-tools': patch
---

Solid and Octane server documents now link the application's stylesheets (entry, layout and route CSS) in the head, so the first paint is styled before any client script runs. Builds that load module scripts (Solid's default) also preload the application's modules; classic-script builds (Octane's default) get no preloads. `renderer-assets.json` entries list stylesheets first, then module preloads, then entry scripts. Lazy component styles still load with their component.
