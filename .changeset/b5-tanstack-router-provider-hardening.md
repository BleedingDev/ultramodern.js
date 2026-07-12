---
'@modern-js/plugin-tanstack': minor
'@modern-js/runtime': minor
---

fix(tanstack-router): make the TanStack provider registration tree-shake-proof and remove the runtime-config source sniffing

User-visible fixes:

- `runtime.router.framework: 'tanstack'` apps using `createRoutes` no longer crash with "no TanStack router provider is registered": Rspack pruned the side-effect-only `import './register'` from the side-effect-free runtime index, dropping the provider registration from both the SSR and browser bundles. The runtime index/router modules are now listed in `sideEffects`, and the CLI plugin injects the framework-resolving router plugin through the new `@modern-js/plugin-tanstack/runtime/router` module, which value-imports the registration so it can never be tree-shaken away. The injection only applies to true custom entries: entrypoints owned by the built-in `routes/`/`pages/` conventions or by another routes-owner plugin keep their own router plugin untouched, so installing `tanstackRouterPlugin` next to classic react-router entries neither pulls the TanStack runtime into those bundles nor risks installing two routers.
- independently bundled Modern.js apps now resolve router providers from an immutable app-owned runtime realm. A second TanStack vertical no longer captures the first vertical's provider factory or navigation primitives, and different non-default providers may coexist on one page. The versioned global registry remains a read-only-compatible fallback for older wrappers and mixed published cohorts, but current TanStack runtime wrappers bind their own provider directly.
- `@modern-js/runtime` no longer decides router installation by regex-sniffing the user's `modern.runtime.ts` source (`/router\s*:/` matched comments and missed spread configs). Installing `tanstackRouterPlugin()` is now the explicit signal for non-file-route entrypoints; built-in route entrypoints are unaffected. Custom-entry apps relying on the removed sniff for plain react-router configs must configure routes through the standard entrypoints.
- generated `router.gen.ts` files import the loader bridge (`modernLoaderToTanstack`, `createRouteStaticData`, `ModernRouterContext`) from `@modern-js/plugin-tanstack/runtime` instead of embedding a ~175-line preamble whose absolute-redirect handler threw `redirect({ href })` inside its own catch block, downgrading external redirects to internal paths. The shared bridge also stops re-translating its own TanStack redirects (which collapsed relative redirect targets to `/`).
- generated route component imports are resolved to relative paths like loader imports; the raw `@_modern_js_src` alias broke app typechecking.
- `register.gen.d.ts` only augments `@modern-js/plugin-i18n/runtime` when plugin-i18n is actually registered — apps with a hand-rolled `/:lang/` param no longer fail typechecking on an unresolvable module.
- `source.include` now covers the package dist via path resolution (the old `.replace('cjs', 'esm')` corrupted workspace paths containing `cjs` and missed the bundled `dist/esm` runtime under the ESM CLI condition) and additionally down-levels `@tanstack/router-core` and `@tanstack/react-store`.

Internal/API changes:

- `@modern-js/runtime/cli` additionally re-exports `getEntrypointRoutesOwner` (alongside the existing `getEntrypointRoutesDir`) so routes-owner plugins can recognize entrypoints claimed by other conventions.
- the six router hooks are declared once (`routerProviderRegistryHooks`, exported through `@modern-js/runtime/context` together with the router state types and `DefaultNotFound`); the react-router and TanStack providers register the same instances, and the router wrapper warns about provider hooks outside the contract instead of dropping them silently.
- removed dead `@modern-js/plugin-tanstack` exports: `isTanstackRouterFrameworkEnabled`, `isTanstackStartRouteModuleSource`, the descriptive route-splitting profile fields, `createRouteTreeFromModernRoutes` and its modern-route-only helpers, plus the react-router-only `oldVersion`/`future` fields of the TanStack `RouterConfig` and the synthetic `*`/`DefaultNotFound` route that was added and immediately stripped again.
