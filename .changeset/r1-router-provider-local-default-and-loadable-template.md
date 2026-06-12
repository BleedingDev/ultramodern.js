---
'@modern-js/runtime': patch
---

fix(runtime): two router/runtime correctness fixes surfaced by the i18n integration lane

- Router provider resolution now prefers the resolving module's own copy of
  the default `react-router` provider. The provider registry is realm-global
  with keep-first semantics, so in a page hosting several independent
  Modern.js apps (Module Federation app-level remotes) the host's
  first-registered copy used to win for every app: the bridged remote rendered
  the HOST's routes inside its mount and crashed in the host's providers
  (`useModernI18n must be used within a ModernI18nProvider`).
- The generated `routes.js` template imports `loadable`/`lazy` statically from
  `@modern-js/runtime/loadable` again. The runtime interop helper introduced
  for Cloudflare made the call sites invisible to
  `@swc/plugin-loadable-components`, so every string-SSR render of a
  route-chunked app failed with ``loadable: SSR requires `@loadable/babel-plugin```
  and fell back to client rendering. ESM/CJS interop stays handled inside the
  `@modern-js/runtime/loadable` export itself.
