---
'@modern-js/ultramodern-create': patch
---

refactor(create): update templates to use `Link` component and localization utilities

- templates now use the framework `Link` component instead of stamped helper functions
- replace hand-rolled `localizePath`/`canonicalPath` helpers with `useLocalizedPaths()` hook calls
- replace manual hreflang blocks with `useLocalizedLocation()` hook
