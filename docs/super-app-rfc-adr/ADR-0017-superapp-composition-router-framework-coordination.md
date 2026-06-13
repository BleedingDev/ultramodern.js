# ADR-0017: SuperApp Composition x Router Framework Coordination

- Status: Accepted (documents the existing contract; no new behavior)
- Date: 2026-06-11
- Decision Type: Runtime composition contract
- Related: ADR-0002 (app-level MF SSR), ADR-0011 (MF vs Garfish parity contract, Retired 2026-06-12)

> **Update (2026-06-12 fork cleanup):** the Garfish composition lane
> (`packages/runtime/plugin-garfish`) was deleted; Module Federation is the
> sole composition lane. The Garfish masterApp descriptions and
> `plugin-garfish/src/**` path references below are historical.

> **Scope note:** this ADR documents the contract as implemented after the
> router consolidation, which has landed: all TanStack code lives in
> `@modern-js/plugin-tanstack`, `plugin-runtime` exposes the router
> provider-registry (`src/router/runtime/provider.ts`), and `routerFramework`
> no longer exists on the runtime context — the only remaining references in
> the runtime packages are tests asserting its absence
> (`plugin-runtime/tests/core/react/wrapper.test.tsx:59,73`).

## 1. Context

The fork has two composition lanes and two router lanes, and they are chosen
independently:

1. Composition:
   - **Garfish masterApp** (`@modern-js/plugin-garfish`): the shell registers
     micro-apps via `runtime.masterApp` (`src/cli/index.ts` targets
     `runtime.masterApp`); micro-apps mount client-side into DOM containers.
   - **Module Federation**: build-time remotes, optionally SSR-capable via
     `server.ssr.moduleFederationAppSSR` (ADR-0002). This is the only
     composition lane with an SSR contract.
2. Router:
   - **react-router** (default, in `plugin-runtime`).
   - **TanStack Router** (`@modern-js/plugin-tanstack`, registered per-app via
     `tanstackRouterPlugin()`; its runtime entry registers the `tanstack`
     provider in the `plugin-runtime` provider-registry,
     `plugin-tanstack/src/runtime/register.ts:29`; react-router registers
     itself as the default at
     `plugin-runtime/src/router/runtime/internal.ts:17`).

## 2. Decision (implied precedence, made explicit)

1. **Garfish composes apps; each micro-app picks its own router.** The shell
   never imposes a router framework on micro-apps. A micro-app brings its own
   plugin set and router at build time.
2. The only host-to-micro-app router coupling is:
   - the duck-typed `context.router` surface the **host's** router plugin
     publishes, which Garfish reads to derive the micro-app basename; and
   - the basename handoff into the micro-app via sub-app props ->
     `_internalRouterBaseName`.
3. Router selection must flow through the provider-registry in
   `plugin-runtime`; nothing in composition code may branch on a
   `routerFramework` discriminant (grep-verified: `routerFramework` appears
   nowhere under `packages/runtime/*/src` — the only remaining hits are tests
   asserting it is absent from the context).

## 3. Mechanics (code evidence)

### 3.1 Host-side basename derivation (Garfish)

`packages/runtime/plugin-garfish/src/runtime/utils/apps.tsx`:

- reads `context.router.useMatches()` (and legacy `useRouteMatch`,
  optional-chained), takes the **last** match, strips trailing dynamic params
  with a `/${params[key]}$` regex, and joins the result onto the masterApp
  `basename` option;
- passes the computed `basename` into `Garfish.loadApp` options;
- dispatches a synthetic `PopStateEvent` on host location change while Garfish
  is not running.

### 3.2 `context.router` surfaces published by each router plugin

- react-router (`plugin-runtime/src/router/runtime/plugin.tsx:119`):
  `{ useMatches, useLocation, useHref }` — with an explicit upstream comment
  "for garfish plugin to get basename". This is the informal contract.
- TanStack (`plugin-tanstack/src/runtime/plugin.tsx:501`):
  `{ Link, useMatches, useLocation, useNavigate, useRouter }` — note `useHref`
  is **absent**; Garfish currently does not use it, and nothing new may start
  depending on it without extending both surfaces.

### 3.3 Micro-app-side basename consumption

- `plugin-runtime/src/core/browser/index.tsx:98` copies
  `App.props.basename` -> `_internalRouterBaseName` on the internal context.
- Both router plugins consume `_internalRouterBaseName || basename`:
  react-router at `plugin.tsx:255`; TanStack at
  `plugin-tanstack/src/runtime/plugin.tsx:407`, which applies
  `createModernBasepathRewrite` (`src/runtime/basepathRewrite.ts`) instead of
  TanStack's built-in `basepath` (avoids the trailing-slash root rewrite).

### 3.4 Trust / attestation lane (composition-side, router-agnostic)

- Remote build config `deploy.microFrontend.{runtimeDigest,integrity,attestation}`
  (`app-tools/src/types/config/deploy.ts`) is emitted as
  `MODERN_MF_RUNTIME_DIGEST`, `MODERN_MF_REMOTE_ENTRY_INTEGRITY`,
  `MODERN_MF_REMOTE_ENTRY_ATTESTATION` (`plugin-garfish/src/cli/index.ts`).
- The host enforces `remoteTrust` policy (origins, integrity, attestation,
  isolation) in `plugin-garfish/src/runtime/trust.ts`, the digest handshake in
  `compatibility.ts`, structured fallback telemetry in `fallbackTelemetry.ts`,
  and `mfv` version-pinned remote-entry caching in `cachePolicy.ts`.
- None of this touches router state; it runs before app registration/mount.

### 3.5 Hydration

- Garfish micro-apps are **client-mounted** (`customLoader` renders into a
  `domGetter` container). There is no SSR lane for Garfish sub-apps; app-level
  SSR composition exists only on the MF lane (ADR-0002).
- TanStack SSR hydration keys off the page-global `window.$_TSR` bootstrap and
  performs a full `window.location.reload()` on initial-URL hydration
  mismatch (`plugin-tanstack/src/runtime/plugin.tsx`).

## 4. Compositions exercised today (test evidence)

| Composition | Coverage |
| --- | --- |
| TanStack single app + Effect BFF + string SSR | `tests/integration/superapp-portfolio` (including the folded MegaERP approval/chat flows) + `superapp-browser-matrix` runtime-matrix tests |
| TanStack + Module Federation host/remotes (incl. the `moduleFederationAppSSR: true` runtime contract — `tests/tanstack-mf-contract.test.ts:249` — and remote-loader reliability) | `tests/integration/routes-tanstack-mf` |
| react-router + app-level MF SSR + i18n (the suite that asserts the `MODERN_MF_APP_SSR` env marker, `test/app-level-ssr-serve.test.ts:43`) | `tests/integration/i18n/mf` |
| Garfish masterApp (any router) | **Unit tests only**: `packages/runtime/plugin-garfish/tests/` (trust, compatibility, fallbackTelemetry, cachePolicy, runtimePlugin, reliabilityMatrix) |

`grep -r "garfish\|masterApp" tests/` returns **zero** hits: no integration
fixture runs a Garfish masterApp at all, with any router framework.

## 5. Constraints

1. **Basename heuristic:** the host strips only *trailing* dynamic params from
   the last match; nested splat/optional segments under a micro-app activation
   route are outside the verified shape.
2. **Informal router surface:** `context.router` is untyped by design (the
   upstream comment admits it). The provider-registry
   (`plugin-runtime/src/router/runtime/provider.ts`) has landed but selects
   provider factories only — it does not type `context.router`. Until that
   surface is formalized, both router plugins must keep
   `useMatches`/`useLocation` shape-compatible (objects with `pathname` and
   `params`).
3. **CSR-only Garfish sub-apps:** any SSR requirement forces the MF lane.
4. **History coupling:** Garfish relies on the synthetic popstate dispatch in
   `apps.tsx`; router plugins must not swallow popstate events carrying the
   `garfish` marker.

## 6. Open risks (UNTESTED — do not assume guarantees)

1. **Garfish masterApp has zero integration coverage.** Everything below is
   implied by code reading, not by an executed test.
2. **Garfish host + TanStack micro-app:** the basename handoff
   (`_internalRouterBaseName` -> `createModernBasepathRewrite`) is wired but
   never executed in any test. Hash-history micro-apps are equally unverified.
3. **TanStack host + Garfish MicroApp:** Garfish reads
   `useMatches()[last].pathname/params`; TanStack matches expose both fields,
   but shape compatibility (e.g. param stripping against TanStack `$param`
   pathnames) is unverified.
4. **`window.$_TSR` is page-global:** a TanStack-SSR host composing a TanStack
   micro-app under Garfish would contend for the same hydration bootstrap.
   Behavior is undefined; Garfish sub-apps must assume CSR until a scoped
   bootstrap exists.
5. **Trust/attestation end-to-end:** the `MODERN_MF_*` digest/integrity/
   attestation handshake is unit-tested only; no test loads a digest-pinned
   remote through a real masterApp shell.
6. **Provider-registry collisions under composition:** `routerFramework`
   itself is gone — the consolidation removed it from the runtime context
   (zero `src/` hits; `plugin-runtime/tests/core/react/wrapper.test.tsx:59,73`
   asserts its absence) and Garfish never read it, so composition is
   unaffected. Registry behavior under bundling duplication: a same-name
   re-registration (two bundled copies of one provider module, e.g. an MF
   remote that does not share `@modern-js/plugin-tanstack/runtime`) is
   keep-first-and-warn-once (`provider.ts:69-84`), while two *different*
   non-default providers are a hard error (`provider.ts:92-95`). The
   formerly-documented mixed-version hazard — an MF remote bundling an
   *older published* `@modern-js/runtime` whose `registerRouterProvider`
   throws on duplicate names, joining the same `globalThis` registry — no
   longer exists: the registry key is versioned
   (`Symbol.for('@modern-js/runtime:router-providers:v2')`,
   `provider.ts:47-48`), so old-keyed and v2-keyed copies hold disjoint
   registry objects and each generation registers and resolves its own
   providers without observing the other (no throw on either side; sharing
   the runtime via MF `shared` remains best practice to avoid
   double-bundling, but is no longer load-bearing for crash-safety). All
   three paths are unit-tested
   (`plugin-runtime/tests/router/provider.test.ts:69,118,177`) but never
   exercised inside a running Garfish or MF composition. Future composition
   logic must resolve routers through the registry, never a framework
   discriminant.

## 7. Follow-ups

1. Add one integration fixture: Garfish master (react-router) + two
   micro-apps (one react-router, one TanStack) asserting basename resolution,
   cross-app navigation, and fallback telemetry emission. This converts risks
   1-3 into contracts.
2. Type the `context.router` surface (the provider-registry has landed; the
   surface is still duck-typed) and delete the duck-typed access in
   `plugin-garfish/src/runtime/utils/apps.tsx`.
3. Revisit ADR-0011 (MF vs Garfish parity) once the fixture exists; today its
   parity evidence requirement cannot be satisfied for the Garfish side.
