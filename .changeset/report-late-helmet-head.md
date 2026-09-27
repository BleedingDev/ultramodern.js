---
'@modern-js/plugin': patch
'@modern-js/runtime': patch
'@modern-js/runtime-extensions': patch
'@modern-js/runtime-renderer-extensions': patch
---

Report a `<Helmet>` whose boundary completes after the streamed shell instead
of dropping its head tags silently. The renderer passes request monitors to SSR
extensions; the head plugin logs an error in development and a warning in
production.
