# ADR-0017: SuperApp Composition x Router Framework Coordination

- Status: Accepted (documents the existing contract; no new behavior)
- Date: 2026-06-11
- Decision Type: Runtime composition contract
- Related: ADR-0002 (app-level MF SSR), ADR-0011 (MF vs Garfish parity contract, Retired 2026-06-12)

> **Update (2026-06-13 docs cleanup):** the Garfish composition lane
> (`packages/runtime/plugin-garfish`) was deleted in Phase A-C. This ADR now
> documents the live Module Federation composition contract only.

> **Scope note:** this ADR documents the contract as implemented after the
> router consolidation, which has landed: all TanStack code lives in
> `@modern-js/plugin-tanstack`, `plugin-runtime` exposes the router
> provider-registry (`src/router/runtime/provider.ts`), and `routerFramework`
> no longer exists in runtime package source. Wrapper tests assert its absence,
> while one plugin-i18n fixture still builds a legacy-shaped test context.

## 1. Context

The fork has one live composition lane and two router lanes:

1. Composition:
   - **Module Federation**: build-time remotes, optionally SSR-capable via
     `server.ssr.moduleFederationAppSSR` (ADR-0002). This is the live app-level
     composition lane and the only composition lane with an SSR contract.
2. Router:
   - **react-router** (default, in `plugin-runtime`).
   - **TanStack Router** (`@modern-js/plugin-tanstack`, registered per-app via
     `tanstackRouterPlugin()`; its runtime entry registers the `tanstack`
     provider in the `plugin-runtime` provider-registry,
     `plugin-tanstack/src/runtime/register.ts:29`; react-router registers
     itself as the default at
     `plugin-runtime/src/router/runtime/internal.ts:14`).

## 2. Decision (implied precedence, made explicit)

1. **Module Federation composes apps; each host or remote picks its own router
   at build time.** The shell must not impose a router framework on remotes.
2. Host-to-remote routing coordination is through Module Federation entry
   configuration, SSR request context, and remote manifest/topology metadata,
   not through a global `routerFramework` discriminant.
3. Router selection must flow through the provider-registry in
   `plugin-runtime`; nothing in composition code may branch on a
   `routerFramework` discriminant (grep-verified: `routerFramework` appears
   nowhere under `packages/runtime/*/src`; wrapper tests assert it is absent
   from the context).

## 3. Mechanics (code evidence)

### 3.1 `context.router` surfaces published by each router plugin

- react-router (`plugin-runtime/src/router/runtime/plugin.tsx`):
  `{ useMatches, useLocation, useHref }` — with an explicit upstream comment
  "for garfish plugin to get basename". That comment is historical after
  Phase A-C, but the surface remains available to runtime consumers.
- TanStack (`plugin-tanstack/src/runtime/plugin.tsx`):
  `{ Link, useMatches, useLocation, useNavigate, useRouter }`.

### 3.2 Remote-side basename consumption

- `plugin-runtime/src/core/browser/index.tsx` copies
  `App.props.basename` -> `_internalRouterBaseName` on the internal context.
- Both router plugins consume `_internalRouterBaseName || basename`:
  react-router in `plugin-runtime/src/router/runtime/plugin.tsx`; TanStack in
  `plugin-tanstack/src/runtime/plugin.tsx`, which applies
  `createModernBasepathRewrite` (`src/runtime/basepathRewrite.ts`) instead of
  TanStack's built-in `basepath` (avoids the trailing-slash root rewrite).

### 3.3 Module Federation SSR and artifact policy

- App-level MF SSR is enabled through `server.ssr.moduleFederationAppSSR` and
  the `MODERN_MF_APP_SSR` runtime define (ADR-0002).
- MF manifest endpoints are excluded from i18n locale redirects:
  `/mf-manifest.json`, `/mf-stats.json`, and `/remoteEntry.js`.
- MF cache policy lives in `@modern-js/server-runtime-extensions/src/mfCache.ts`:
  manifests are no-store, non-versioned remote entries revalidate, and
  query-pinned remote entries (`mfv` / `v` / `version`) are immutable.
- Topology-level digest/SRI/provenance/attestation evidence remains in the MV
  topology documents and `scripts/mv-integration-pilot`; the removed
  app-tools `deploy.microFrontend.*` fields are not live runtime config.

### 3.4 Hydration

- TanStack SSR hydration keys off the page-global `window.$_TSR` bootstrap and
  performs a full `window.location.reload()` on initial-URL hydration
  mismatch (`plugin-tanstack/src/runtime/plugin.tsx`).
- MF SSR hosts and remotes must keep request context, route basename, and
  hydration boot payloads aligned across the host/remote boundary.

## 4. Compositions exercised today (test evidence)

| Composition | Coverage |
| --- | --- |
| TanStack single app + Effect BFF + string SSR | `tests/integration/superapp-portfolio` (including the folded MegaERP approval/chat flows) + `superapp-browser-matrix` runtime-matrix tests |
| TanStack + Module Federation host/remotes (incl. the `moduleFederationAppSSR: true` runtime contract — `tests/tanstack-mf-contract.test.ts:281` — and remote-loader reliability) | `tests/integration/routes-tanstack-mf` |
| react-router + app-level MF SSR + i18n (the suite that asserts the `MODERN_MF_APP_SSR` env marker, `test/app-level-ssr-serve.test.ts:46`) | `tests/integration/i18n/mf` |

## 5. Constraints

1. **Informal router surface:** `context.router` is untyped by design (the
   upstream comment admits it). The provider-registry
   (`plugin-runtime/src/router/runtime/provider.ts`) has landed but selects
   provider factories only — it does not type `context.router`. Until that
   surface is formalized, both router plugins must keep
   `useMatches`/`useLocation` shape-compatible (objects with `pathname` and
   `params`).
2. **Remote basename contract:** MF remotes still rely on `_internalRouterBaseName`
   or `basename` reaching the selected router implementation. Keep React Router
   and TanStack basename behavior aligned when changing runtime bootstrap code.
3. **Artifact policy is topology evidence:** digest/SRI/provenance/attestation
   policy is not app-tools runtime config after Phase A-C. Do not wire new code
   to the deleted `deploy.microFrontend.*` fields.

## 6. Open risks (UNTESTED — do not assume guarantees)

1. **Scoped TanStack hydration under MF:** `window.$_TSR` is page-global today;
   host/remotes that both SSR TanStack routes need a scoped bootstrap contract
   before assuming independent hydration payloads.
2. **Topology artifact policy end-to-end:** topology manifest digest/SRI/
   provenance/attestation evidence is validated by docs/contracts/script
   evidence, not by the deleted Garfish runtime. Promotion docs must not imply
   app-tools `deploy.microFrontend.*` enforcement exists.
3. **Provider-registry collisions under composition:** `routerFramework`
   itself is gone — the consolidation removed it from the runtime context
   (zero `src/` hits; `plugin-runtime/tests/core/react/wrapper.test.tsx:59,73`
   asserts its absence). Registry behavior under bundling duplication: a same-name
   re-registration (two bundled copies of one provider module, e.g. an MF
   remote that does not share `@modern-js/plugin-tanstack/runtime`) is
   keep-first-and-warn-once (`provider.ts:117-132`), while two *different*
   non-default providers are a hard error (`provider.ts:135-145`). The
   formerly-documented mixed-version hazard — an MF remote bundling an
   *older published* `@modern-js/runtime` whose `registerRouterProvider`
   throws on duplicate names, joining the same `globalThis` registry — no
   longer exists: the registry key is versioned
   (`Symbol.for('@modern-js/runtime:router-providers:v2')`,
   `provider.ts:95-97`), so old-keyed and v2-keyed copies hold disjoint
   registry objects and each generation registers and resolves its own
   providers without observing the other (no throw on either side; sharing
   the runtime via MF `shared` remains best practice to avoid
   double-bundling, but is no longer load-bearing for crash-safety). All
   three paths are unit-tested
   (`plugin-runtime/tests/router/provider.test.ts:135-166,229-234,288-350`)
   but never exercised inside a running MF composition. Future composition
   logic must resolve routers through the registry, never a framework
   discriminant.

## 7. Follow-ups

1. Add an MF host/remotes integration fixture that mixes react-router and
   TanStack remotes and asserts basename, navigation, SSR fallback, and
   hydration behavior.
2. Type the `context.router` surface (the provider-registry has landed; the
   surface is still duck-typed).
3. Keep ADR-0011 retired unless a new, live non-MF composition runtime is added.
