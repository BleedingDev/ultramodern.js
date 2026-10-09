---
'@modern-js/renderer-solid': patch
---

The Solid `Link` keeps `role`, `aria-disabled`, `data-status` and `aria-current` from `activeProps`, `inactiveProps` or its own props, except while it sets them itself for a disabled or active link.
