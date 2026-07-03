---
'@modern-js/plugin-tanstack': patch
---

Fix `Link`/`NavLink` so a caller-supplied `aria-current` always wins over TanStack Router's force-injected `aria-current="page"` on active links (including `aria-current={false}` to suppress the attribute entirely), fixing conflicting "current page" a11y markers when e.g. a language switcher points at the current pathname.
