---
'@modern-js/ultramodern-app-tools': patch
---

Validate a native i18n `localisedUrls` map against the entry's file-system routes before emission, rejecting missing languages, unmapped routes and colliding localized paths as the React i18n tooling does.
