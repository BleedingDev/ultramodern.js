# UltraModern Navigation Warmup Operator Log

## Handoff Bundle

- Plan selection: `/Users/satan/side/experiments/modernjs/.codex/plans/ultramodern-navigation-warmup-defaults.plan.md`
- Explicit dependencies: none
- Resolved graph id: `ultramodern-navigation-warmup-defaults-08ce108913`
- Selection hash: `08ce108913`
- Snapshot path: `/Users/satan/side/experiments/modernjs/.codex/plan-graphs/ultramodern-navigation-warmup-defaults-08ce108913/snapshot.json`
- State dir: `/Users/satan/side/experiments/modernjs/.codex/plan-graphs/ultramodern-navigation-warmup-defaults-08ce108913`
- Codebase research: `/Users/satan/side/experiments/modernjs/.codex/reports/navigation-warmup-codebase-research.md`

## Active Scope

- Only point 1 is active: navigation warmup defaults.
- Implement prefetch on render and preload on viewport.
- Keep warmup same-origin only.
- Do not fetch private or credentialed loader data by default.
- Respect Save-Data and slow-network conditions.
- Cap concurrency and dedupe repeated warmups.
- Preserve explicit user `prefetch` and TanStack `preload` overrides.

## Out Of Scope

- Starter correctness.
- Security headers.
- Public surfaces such as robots, sitemap, llms, API catalog, or security.txt.
- Resilience, certification, agent readiness, route indexing, and JSON-LD/schema work.
- App-level shims, click interception, generated-file hacks, or local suppressions.

## Launch Design

- Status: navigation-only graph prepared; no subagents launched.
- Critical path owner: primary agent owns `define-navigation-warmup-contract` and final integration.
- The plan is currently one sequential lane because the contract must settle before implementation.
- After `define-navigation-warmup-contract` and `audit-existing-link-surfaces`, possible sidecars are:
  - `classic-runtime-link`: owns `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx` and `packages/runtime/plugin-runtime/tests/router/prefetch.test.tsx`.
  - `tanstack-adapter-sync`: owns both TanStack adapter copies and their focused tests.
  - `i18n-forwarding-check`: owns `packages/runtime/plugin-i18n/src/runtime/I18nLink.tsx` only if needed, plus `tests/routerAdapter.test.tsx`.

## Conflict Map

- `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx`: single writer, primary or `classic-runtime-link`.
- `packages/runtime/plugin-runtime/src/router/runtime/types.ts`: single writer if a data warmup opt-in contract is needed.
- `packages/runtime/plugin-runtime/src/router/runtime/tanstack/prefetchLink.tsx` and `packages/runtime/plugin-tanstack/src/runtime/prefetchLink.tsx`: must remain behaviorally in sync.
- `packages/runtime/plugin-i18n/src/runtime/I18nLink.tsx`: avoid edits unless prop-forwarding tests reveal a real gap.
- `packages/toolkit/create/template/**`: do not edit for this graph.

## Baseline Verification

Focused existing tests passed before implementation:

- `pnpm --filter @modern-js/runtime test -- --run tests/router/prefetch.test.tsx tests/router/tanstackPrefetchLink.test.tsx`
- `pnpm --filter @modern-js/plugin-tanstack test -- --run tests/router/prefetchLink.test.tsx`
- `pnpm --filter @modern-js/plugin-i18n test -- --run tests/routerAdapter.test.tsx`

## Implementation Run

- Resolved limits: `max_threads=50`, `max_depth=3`; graph intentionally used three sidecars plus primary critical-path ownership.
- Primary lane: classic runtime contract, safe warmup policy, tests, docs, graph integration.
- Agent `019e9992-94b4-7030-8053-0a16f5a40ad6` (`Raman`): TanStack adapter sync; landed commit `14a33e149b` and kept both adapter copies behaviorally aligned.
- Agent `019e9992-beb7-7f12-a8e5-9f48088eebc1` (`Galileo`): i18n forwarding coverage; primary integrated the test-only useful subset and kept i18n target semantics scoped.
- Agent `019e9992-fef7-7480-9d89-6191d0f2d28d` (`Meitner`): read-only verification checklist; primary used it to add coverage for opt-outs, network gates, private data guardrails, concurrency, and forwarding.

## Final Verification

- `pnpm exec biome check packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx packages/runtime/plugin-runtime/tests/router/prefetch.test.tsx packages/runtime/plugin-runtime/tests/router/tanstackPrefetchLink.test.tsx packages/runtime/plugin-tanstack/tests/router/prefetchLink.test.tsx packages/runtime/plugin-i18n/src/runtime/I18nLink.tsx packages/runtime/plugin-i18n/tests/routerAdapter.test.tsx`
- `pnpm --filter @modern-js/runtime test -- --run tests/router/prefetch.test.tsx tests/router/tanstackPrefetchLink.test.tsx`
- `pnpm --filter @modern-js/plugin-tanstack test -- --run tests/router/prefetchLink.test.tsx`
- `pnpm --filter @modern-js/plugin-i18n test -- --run tests/routerAdapter.test.tsx`

Result: navigation-only graph completed, 9/9 todos done. Starter correctness, SEO/indexing, headers, JSON-LD, public-surface, certification, and agent-readiness work remained out of scope.
