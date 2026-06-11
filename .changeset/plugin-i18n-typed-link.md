---
'@modern-js/plugin-i18n': minor
---

feat(plugin-i18n): add typed language-agnostic `Link` component with hash/query safety

- new `Link` component: standard UltraModern link accepting canonical, language-agnostic `to` values; localizes automatically (language prefix + `localisedUrls` slug mapping)
- `#hash` and `?query` in `to` are safe: `<Link to="/#work-with-me" />` → SPA-style navigation to `/cs#work-with-me` on `/cs/platforma`; previously `buildLocalizedUrl` mangled these
- typed `to` + `params`: codegen emits `UltramodernCanonicalRoutes` interface; `<Link to="/talks/$slug" params={{ slug }} />` typechecks, `to="/talkz"` is a compile error
- language-invariant active state: `data-status="active"` + `aria-current="page"` when location matches any localized variant of canonical route
- new runtime utilities: `localizePath()`, `canonicalPath()`, `useLocalizedPaths()`, `useLocalizedLocation()` for hreflang tags and language switchers
- `buildLocalizedUrl()` now parses `to` into pathname/search/hash and localizes only pathname
- `I18nLink` deprecated: delegates to `Link` with one-time dev-only console warning
