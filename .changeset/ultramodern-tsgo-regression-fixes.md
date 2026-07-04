---
'@modern-js/plugin-bff': patch
'@modern-js/runtime': patch
'@modern-js/plugin-tanstack': patch
---

Type-level fixes clearing tsgo validation regressions: effect-diagnostics
directives for the deliberately imperative backend-federation runtime files,
restored internal runtime context type shapes (RouteManifest,
StaticHandlerContext, BaseSSRServerContext-based SSR request/response), and
SSR request narrowing in the TanStack server plugin. No runtime behavior
changes.
