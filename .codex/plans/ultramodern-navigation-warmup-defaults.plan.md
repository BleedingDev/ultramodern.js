---
name: ultramodern-navigation-warmup-defaults
overview: Implement only the accepted UltraModern navigation warmup defaults: prefetch on render, preload on viewport, same-origin only, no private data by default, Save-Data/slow-network guardrails, concurrency caps, and explicit override preservation.
todos:
  - id: define-navigation-warmup-contract
    content: Define the navigation-only contract and API semantics for render prefetch, viewport preload, intent warmup, click load, code/module warmup, data warmup opt-in, network guardrails, concurrency caps, and explicit opt-outs.
    status: pending
  - id: audit-existing-link-surfaces
    content: Audit the classic runtime Link/NavLink, TanStack runtime adapters, plugin-tanstack duplicate surface, i18n Link forwarding, route manifest assets, and generated starter links so all affected entrypoints are identified before implementation.
    status: pending
  - id: implement-safe-warmup-policy
    content: Implement or extract a browser warmup policy with same-origin checks, Save-Data and slow-network gates, concurrency caps, dedupe, cancellation, bounded TTL, and no app-level navigation interception.
    status: pending
  - id: align-classic-runtime-link
    content: Update the classic Modern runtime Link/NavLink prefetch implementation to support render prefetch plus viewport preload semantics while preserving intent and none behavior and avoiding absolute/external URL warmups.
    status: pending
  - id: align-tanstack-link-adapters
    content: Update both TanStack link adapter surfaces so prefetch and preload defaults can coexist, explicit user preload props are never overridden, and viewport behavior remains compatible with TanStack Router.
    status: pending
  - id: preserve-i18n-forwarding
    content: Ensure I18nLink forwards warmup props to the active router Link and add coverage for localized URLs without changing unrelated starter markup, metadata, security, or public-surface behavior.
    status: pending
  - id: add-private-data-guardrails
    content: Add route/data guardrails so render prefetch does not fetch credentialed private loader data unless the route explicitly declares data warmup as safe.
    status: pending
  - id: add-runtime-and-starter-tests
    content: Add focused tests for render, viewport, intent, none, explicit override preservation, external URL skips, Save-Data/slow-network skips, concurrency caps, private data guardrails, and i18n forwarding.
    status: pending
  - id: document-defaults-and-escape-hatches
    content: Document only the navigation warmup defaults, opt-outs, data-safety rules, and SuperApp/MF timing caveats so teams can tune warmup without app-level click interception or custom wrappers.
    status: pending
isProject: false
---

# ultramodern-navigation-warmup-defaults

## Execution Notes

Accepted direction from the corrected scope:

- This graph is only for point 1: navigation warmup defaults.
- In scope: prefetch on render, preload on viewport, same-origin only, no private data by default, Save-Data/slow-network guardrails, concurrency caps, and explicit user override preservation.
- Out of scope: starter correctness, security headers, public surfaces, resilience, certification, agent readiness, JSON-LD/schema work, route indexing policy, and broad Website Spec compliance.
- Avoid the historical Next.js-style footgun where broad, opaque prefetching quietly spends bandwidth or warms private data.
- The implementation tracker is Beads issue `modernjs-ztla`.

Local evidence:

- `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx` currently supports `prefetch: 'intent' | 'render' | 'none'`, defaults to `none`, uses `WEBPACK_CHUNK_LOAD` for matched route chunks, skips absolute URLs, and emits loader-data `<link rel="prefetch" as="fetch">` when `window._SSR_DATA` exists.
- `packages/runtime/plugin-runtime/src/router/runtime/tanstack/prefetchLink.tsx` and `packages/runtime/plugin-tanstack/src/runtime/prefetchLink.tsx` already expose `PrefetchBehavior = 'intent' | 'render' | 'viewport' | 'none'` and preserve explicit TanStack `preload` props.
- `packages/runtime/plugin-i18n/src/runtime/I18nLink.tsx` forwards arbitrary props to the active router Link, so warmup props should pass through localized URL generation without changing its public API.
- `packages/runtime/plugin-runtime/tests/router/prefetch.test.tsx`, `packages/runtime/plugin-runtime/tests/router/tanstackPrefetchLink.test.tsx`, and `packages/runtime/plugin-tanstack/tests/router/prefetchLink.test.tsx` are the current focused test anchors.
- `docs/super-app-rfc-adr/ADR-0011-mf-vs-garfish-runtime-parity-contract.md` records prefetch and routing timing as a known MF/Garfish runtime non-equivalence; navigation warmup changes need explicit MF/SuperApp timing caveats.
- See `.codex/reports/navigation-warmup-codebase-research.md` for the codebase-deep-research backing this plan.

Suggested semantics to validate in the first todo:

- Render prefetch: low-priority, deduped warmup scheduled after a safe internal link renders. It may warm route code/module metadata, but must not fetch credentialed/private loader data by default.
- Viewport preload: stronger code/module warmup when the link enters the viewport. It must remain budgeted and cancelable where possible.
- Intent warmup: user hover/focus/touch intent remains supported and can promote data warmup when the route declares that safe.
- Click load: remains authoritative; warmup is an optimization only and must not change navigation correctness.

## Constraints

- Do not add app-level navigation wrappers, manual click interception, synthetic anchor handlers, generated-file hacks, or local suppressions.
- Do not make every app screen indexable or public as part of this work.
- Do not implement starter correctness, security headers, public surfaces, resilience, certification, agent readiness, or JSON-LD/schema work in this graph.
- Do not fetch private, tenant, auth, or credentialed loader data from render-time link presence unless a route explicitly opts in.
- Do not override explicit user `prefetch`, `preload`, or TanStack `preload={false}` choices.
- Do not warm absolute, protocol-relative, cross-origin, `mailto:`, `tel:`, download, or target-new-window links by default.
- Respect `navigator.connection.saveData`, very slow effective connection types where available, and small concurrency budgets.
- Keep the default easy for app authors: product teams must be able to opt out per link or route without custom wrappers.
- Preserve SSR, RSC navigation, MF fallback, and existing route manifest behavior.

## Operator Guidance

Start by writing the contract and tests before changing runtime behavior. Treat the current classic runtime and TanStack behavior as two related surfaces that need one shared vocabulary, not two independent feature lines.

Recommended first test targets:

- `packages/runtime/plugin-runtime/tests/router/prefetch.test.tsx`
- `packages/runtime/plugin-runtime/tests/router/tanstackPrefetchLink.test.tsx`
- `packages/runtime/plugin-tanstack/tests/router/prefetchLink.test.tsx`
- a focused i18n forwarding test around `I18nLink`

Run focused package tests first:

- `pnpm --filter @modern-js/runtime test -- --run tests/router/prefetch.test.tsx tests/router/tanstackPrefetchLink.test.tsx`
- `pnpm --filter @modern-js/plugin-tanstack test -- --run tests/router/prefetchLink.test.tsx`
- `pnpm --filter @modern-js/plugin-i18n test -- --run tests/routerAdapter.test.tsx`

For SuperApp confidence, add a later browser/integration proof only after unit behavior is stable. That proof should show MF remote route warmup does not bypass trust, compatibility, fallback, or telemetry contracts.
