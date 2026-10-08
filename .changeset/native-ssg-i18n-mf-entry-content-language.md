---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/federation-runtime': patch
'@modern-js/renderer-core': patch
---

Prerender native documents once per configured i18n language at their localized URLs, reject a root-relative native server remote entry with a clear error instead of loading `https:/...`, and strip loader `Content-Language` from data envelopes and SSR documents.
