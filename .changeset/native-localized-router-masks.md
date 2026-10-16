---
'@modern-js/renderer-octane': patch
'@modern-js/renderer-solid': patch
'@modern-js/i18n-runtime-extensions': patch
---

Use native router links and localized URL masks for Solid and Octane. Keep validated search values and defaults when masking the public URL, preserve native preloading and navigation options, and use native active state. Apply the canonical URL rewrite consistently on the server and client.

Use the supported native history blocker API for Octane document navigation, preserve replace actions, and bypass blockers only when explicitly requested.

Validate external link destinations after rewriting and suppress disabled or unsafe destinations in the owning router binding. Remove the unused localized active-state helper.
