---
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
---

`changeLanguage()` calls on one i18n instance now run one at a time, and a call superseded before it starts is skipped. A switch whose language load, navigation or redirect does not land on its target returns to the language of the URL it ends on, or the previously committed language on a URL without a locale prefix.
