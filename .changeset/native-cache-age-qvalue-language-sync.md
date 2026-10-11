---
'@modern-js/renderer-core': patch
'@modern-js/i18n-runtime-extensions': patch
---

Serve a cached native document only while its age is within the request's `max-age`, drop `Accept-Language` items whose quality is outside the HTTP 0–1 grammar, and run native router language switches through the language-sync retry policy, reloading the committed URL when the target language cannot load.
