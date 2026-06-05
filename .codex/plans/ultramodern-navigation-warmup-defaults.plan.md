---
name: ultramodern-navigation-warmup-defaults
overview: Implement UltraModern navigation warmup defaults so generated apps can prefetch links on render and preload links on viewport without broad hidden data fetching, app-level shims, or opaque project-specific performance guesses.
todos:
  - id: define-navigation-warmup-contract
    content: Define the framework-owned navigation warmup contract, including the exact semantics for render prefetch, viewport preload, intent warmup, click load, code/module warmup, data warmup, network guardrails, and explicit opt-outs.
    status: pending
  - id: audit-existing-link-surfaces
    content: Audit the classic runtime Link/NavLink, TanStack runtime adapters, plugin-tanstack duplicate surface, i18n Link forwarding, route manifest assets, and generated starter links so all affected entrypoints are identified before implementation.
    status: pending
  - id: implement-shared-warmup-scheduler
    content: Implement or extract a shared browser warmup scheduler with same-origin checks, Save-Data and slow-network gates, concurrency caps, dedupe, cancellation, bounded TTL, and telemetry hooks.
    status: pending
  - id: align-classic-runtime-link
    content: Update the classic Modern runtime Link/NavLink prefetch implementation to support render prefetch plus viewport preload semantics while preserving intent and none behavior and avoiding absolute/external URL warmups.
    status: pending
  - id: align-tanstack-link-adapters
    content: Update both TanStack link adapter surfaces so prefetch and preload defaults can coexist, explicit user preload props are never overridden, and viewport behavior remains compatible with TanStack Router.
    status: pending
  - id: propagate-i18n-and-template-defaults
    content: Ensure i18n links forward the warmup props correctly and update UltraModern generated starters to use the accepted defaults only on safe internal navigation links.
    status: pending
  - id: add-private-data-guardrails
    content: Add route/data guardrails so render prefetch does not fetch credentialed private loader data unless the route explicitly declares data warmup as safe.
    status: pending
  - id: add-navigation-warmup-telemetry
    content: Emit lightweight diagnostics for scheduled, skipped, aborted, completed, and wasted warmups using the existing telemetry envelope without adding app boilerplate.
    status: pending
  - id: add-runtime-and-starter-tests
    content: Add focused tests for render, viewport, intent, none, explicit override preservation, external URL skips, network guard skips, i18n forwarding, and generated starter behavior.
    status: pending
  - id: document-defaults-and-escape-hatches
    content: Document the defaults, opt-outs, data-safety rules, and SuperApp/MF guidance so teams understand how to tune navigation warmup without app-level click interception or custom wrappers.
    status: pending
isProject: false
---

# ultramodern-navigation-warmup-defaults

## Execution Notes

Accepted direction from the Website Spec defaults discussion:

- Do not add a broad `webSpec` or site-quality profile system for this slice.
- Keep new defaults small, concrete, and framework-owned.
- Generated apps should move toward `prefetch on render` and `preload on viewport` for safe internal navigation.
- Avoid the historical Next.js-style footgun where broad, opaque prefetching quietly spends bandwidth or warms private data.
- JSON-LD/schema defaults are explicitly deferred to Beads issues `modernjs-b5cb` and `modernjs-sddt`.
- The main implementation tracker is Beads issue `modernjs-ztla`.

Local evidence:

- `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx` currently supports `prefetch: 'intent' | 'render' | 'none'`, loads matched route chunks, and emits data prefetch links when SSR data exists.
- `packages/runtime/plugin-runtime/src/router/runtime/tanstack/prefetchLink.tsx` already maps `prefetch: 'viewport'` to TanStack `preload`.
- `packages/runtime/plugin-tanstack/src/runtime/prefetchLink.tsx` has the same TanStack adapter shape and needs to stay in sync.
- `packages/runtime/plugin-i18n/src/runtime/I18nLink.tsx` forwards arbitrary props to the active router Link, so it must preserve warmup props through localized URL generation.
- `docs/super-app-rfc-adr/ADR-0011-mf-vs-garfish-runtime-parity-contract.md` records prefetch and routing timing as a known runtime non-equivalence, so MF/SuperApp behavior needs explicit evidence.

Suggested semantics to validate in the first todo:

- Render prefetch: low-priority, deduped warmup scheduled after a safe internal link renders. It may discover route metadata and prepare fetch hints, but it must not fetch credentialed/private loader data by default.
- Viewport preload: stronger code/module warmup when the link enters the viewport. It should remain budgeted and cancelable where possible.
- Intent warmup: user hover/focus/touch intent remains supported and can promote data warmup when the route declares that safe.
- Click load: remains authoritative; warmup is an optimization only and must not change navigation correctness.

## Constraints

- Do not add app-level navigation wrappers, manual click interception, synthetic anchor handlers, generated-file hacks, or local suppressions.
- Do not make every app screen indexable or public as part of this work.
- Do not fetch private, tenant, auth, or credentialed loader data from render-time link presence unless a route explicitly opts in.
- Do not override explicit user `prefetch`, `preload`, or TanStack `preload={false}` choices.
- Do not warm absolute, protocol-relative, cross-origin, `mailto:`, `tel:`, download, or target-new-window links by default.
- Respect `navigator.connection.saveData`, very slow effective connection types where available, and small concurrency budgets.
- Keep the default easy for app authors: starter links can opt into the accepted defaults, but product teams must be able to opt out per link or route without custom wrappers.
- Preserve SSR, RSC navigation, MF fallback, and existing route manifest behavior.

## Operator Guidance

Start by writing the contract and tests before changing runtime behavior. Treat the current classic runtime and TanStack behavior as two related surfaces that need one shared vocabulary, not two independent feature lines.

Recommended first test targets:

- `packages/runtime/plugin-runtime/tests/router/prefetch.test.tsx`
- `packages/runtime/plugin-runtime/tests/router/tanstackPrefetchLink.test.tsx`
- `packages/runtime/plugin-tanstack/tests/router/prefetchLink.test.tsx`
- a focused i18n forwarding test around `I18nLink`
- generated UltraModern starter validation where internal links use the new defaults

Run focused package tests first:

- `pnpm --filter @modern-js/runtime test -- --run tests/router/prefetch.test.tsx tests/router/tanstackPrefetchLink.test.tsx`
- `pnpm --filter @modern-js/plugin-tanstack test -- --run tests/router/prefetchLink.test.tsx`

For SuperApp confidence, add a later browser/integration proof only after unit behavior is stable. That proof should show MF remote route warmup does not bypass trust, compatibility, fallback, or telemetry contracts.
