---
'@modern-js/plugin-i18n': minor
---

i18n correctness and packaging fixes:

- `localeDetection.localisedUrls` is now strictly opt-in: only a non-empty
  map enables localised-slug route expansion and validation. Upstream-style
  configs (`localePathRedirect` + `languages` without a map) no longer fail
  the build; `localisedUrls: false` opt-outs are no longer needed.
- Request URLs with malformed percent-encoding (e.g. `/cs/produkty/%E0%A4%A`)
  no longer throw `URIError` inside the server redirect middleware (500) or
  client `<Link>` active-state computation; they are treated as non-matching
  paths. Literal `[x]` segments in concrete pathnames are no longer
  misinterpreted as route params.
- The Node SSR fs-backend default `loadPath`/`addPath` now follows the same
  directory detection that auto-enables the backend (project-root `./locales`
  first, then `./config/public/locales`) instead of hardcoding
  `./config/public/locales`, so SSR/SSG render translated content for
  upstream-convention apps again.
- `react-i18next` is an optional peerDependency (`^17.0.0`) again instead of
  an exact-pinned hard dependency, restoring upstream packaging semantics and
  avoiding duplicate module instances when the app installs its own copy.
  Apps using the bundled react-i18next integration must list `react-i18next`
  in their own dependencies (generated workspaces already do).
- `<Link prefetch>` now reaches the underlying router link: it is mapped to
  TanStack Router's `preload` prop (`'none'` -> `false`, explicit `preload`
  wins) and forwarded verbatim to the Modern.js react-router `PrefetchLink`;
  it is still stripped from plain-anchor fallbacks.
