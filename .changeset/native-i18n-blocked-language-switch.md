---
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
---

`changeLanguage()` from `useI18n()` restores the previous language when the localized navigation is blocked or fails, so the page never shows one language at another language's URL.
