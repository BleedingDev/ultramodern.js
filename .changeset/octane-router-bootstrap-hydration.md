---
'@modern-js/renderer-octane': patch
---

Octane server documents render the router's `$_TSR` bootstrap inside the `Scripts` barrier script again, so the client hydrates that script in place. Before, Octane's streamed-signal injection subscribed before rendering, which lifted the router's script barrier too early: the server rendered no `Scripts` output, the client rebuilt that subtree, and development builds logged a hydration mismatch on every page.
