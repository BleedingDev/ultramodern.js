---
'@modern-js/app-tools-extensions': patch
'@modern-js/ultramodern-create': patch
---

Cloudflare Workers now build the Effect BFF dispatcher for each request and dispose it once the response body has been delivered. workerd binds sockets, timers and pending promises to the request that created them, so a dispatcher cached for the isolate hung from the second request on whenever its runtime held I/O, such as a pooled PostgreSQL connection. Platform pools such as Hyperdrive keep connections warm across requests.

The `cloudflare-ssr-proof` command now binds each Worker's `wrangler.hyperdrive` entries to a local PostgreSQL, as `wrangler dev` does: from `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>`, else the entry's `localConnectionString`. A Hyperdrive binding with neither fails the proof and names the variable to set.
