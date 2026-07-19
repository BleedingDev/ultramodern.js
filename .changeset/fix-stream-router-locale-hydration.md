---
'@modern-js/plugin-i18n': patch
'@modern-js/plugin-tanstack': patch
'@modern-js/runtime': patch
---

Order streamed SSR data, router bootstrap, and matched route scripts before the
async hydration entry so browser execution cannot race the server bootstrap.
TanStack Router now keeps its existing hydration boundary suspended until late
SSR hydration completes instead of rendering a mismatched client route tree.

Synchronize URL-driven locale changes with the i18n instance before committing
the provider language, including serialized recovery from rapid navigation and
failed language changes, so native client navigation updates translated UI
without stale intermediate content.
