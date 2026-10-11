---
'@modern-js/i18n-runtime-extensions': patch
---

Give each supported language the quality of the most specific `Accept-Language` range covering it, so a narrower positive range such as `en-US` overrides a broader `en;q=0`.
