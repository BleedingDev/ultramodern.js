---
'@modern-js/renderer-core': patch
---

The native data client stops waiting for an injected `fetch` once the loader or action request aborts, for both data requests and static payload lookups, and releases the body of a response that arrives as the request aborts.
