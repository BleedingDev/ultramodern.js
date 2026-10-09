---
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
---

After a blocked or redirected language switch, the language is read from the URL's locale prefix case-insensitively, as the server resolves it, so `/CS/login` maps to `cs`.
