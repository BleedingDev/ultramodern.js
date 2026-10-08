---
'@modern-js/i18n-runtime-extensions': patch
'@modern-js/renderer-core': patch
'@modern-js/renderer-solid': patch
---

Expand `*` in `Accept-Language` to supported languages not excluded elsewhere in the header, strip loader `Content-Disposition` from data envelopes and SSR documents, and forward declared `data-*` attributes from the Solid `LocalizedLink` to its anchor.
