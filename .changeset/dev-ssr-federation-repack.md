---
'@modern-js/server': patch
---

Reset the Module Federation runtime together with the SSR require cache when the dev server reloads server bundles after a rebuild. The containers, share scopes and remote entry caches that the previous bundle generation registered on `globalThis` used to survive, so the re-required bundle joined the stale container and consumed its React, `@modern-js/runtime`, router and i18n singletons while its own unshared modules were fresh. React contexts split across the two generations and dev SSR returned the last rendered page's tree for every URL until the client re-rendered.
