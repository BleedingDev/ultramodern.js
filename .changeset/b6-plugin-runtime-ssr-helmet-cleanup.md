---
'@modern-js/runtime': patch
---

SSR correctness fixes in the runtime server lane:

- The server-side `Helmet` collector now matches react-helmet-async semantics: nested Helmet overrides dedupe by primary attribute (meta name/property/charset, link rel/href with canonical/stylesheet rules, script/style/noscript content), `<html>`/`<body>` children map to html/body attributes instead of being dropped, the innermost title/titleTemplate/defaultTitle resolution mirrors the client, and collection is replay-safe under streaming/concurrent rendering (no more compounding state on Suspense retries). Script/style content is no longer duplicated as an `innerHTML`/`cssText` attribute in SSR output.
- Router runtime cleanup no longer runs while a streamed response body is still rendering — it is deferred until the body closes, errors, or is cancelled — and cleanup failures are reported through the request `onError` hook instead of being silently swallowed.
- Removed the unused `@tanstack/router-core` dependency.
