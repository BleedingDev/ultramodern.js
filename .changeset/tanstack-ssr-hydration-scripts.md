---
'@modern-js/plugin-tanstack': patch
---

Emit TanStack's dehydrated router state through `serverSsr.takeInitialHydrationScriptTags()`. Router-core 1.171.30 removed `takeBufferedScripts`, so server HTML carried no `$_TSR` data and the client re-rendered matched routes from scratch, briefly unmounting server-rendered Module Federation remotes.
