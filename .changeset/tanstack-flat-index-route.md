---
'@modern-js/plugin-tanstack': patch
---

Declare a flat page route as the TanStack index of its path (`$lang/`) when other flat routes live below it, so `/en` renders `[lang]/page.tsx` instead of the `[lang]/$.tsx` splat.
