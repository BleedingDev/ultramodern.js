---
'@modern-js/renderer-core': patch
---

Create the native i18n instance only when a document renders, so data requests and language redirects no longer wait on translation loading, and bypass the document cache for `If-Match` and `If-Unmodified-Since` requests so their preconditions reach the live handler.
