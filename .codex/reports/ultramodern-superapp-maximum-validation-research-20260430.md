# UltraModern.js SuperApp Maximum Validation Research

Date: 2026-04-30
Branch: `main-ultramodern`
Scope: Effect-first BFF, TanStack Router runtime, Module Federation, SSR/streaming, large SuperApp/ERP readiness.

## Executive Summary

UltraModern.js is ready for serious SuperApp work only if we treat readiness as a rolling certification program, not a one-time test pass. The local fork already has meaningful evidence: an Effect + TanStack ERP fixture, production build/serve coverage, OpenAPI checks, invalid payload drift checks, route churn, long soak, heavy concurrent chat mutation stress, TanStack route suites, TanStack + Module Federation host/remotes, BFF runtime parity, cross-project BFF, RSC/SSR, deploy and release-contract gates.

The remaining gap is test-system depth: richer fake production apps, explicit performance budgets, memory/leak telemetry, browser matrix coverage, CI/nightly separation, deploy-like environments, failure injection, artifacted reports, and compatibility drift testing against upstream Modern.js releases.

Upstream Modern.js is active and moving. The GitHub API snapshot on 2026-04-30 showed `web-infra-dev/modern.js` at 5,006 stars, 409 forks, 36 open issues, TypeScript as primary language, default branch `main`, latest release `v3.1.5` published 2026-04-23, and a same-day merged PR touching BFF docs. Recent releases shipped weekly through March/April 2026. That means our certification has to include upstream merge smoke and dependency drift lanes.

## Source Signals

- Upstream repo: https://github.com/web-infra-dev/modern.js
- Modern.js docs describe the framework as a progressive React framework with Rspack, integrated BFF, nested routes, SSR/SSG/RSC, and testing support: https://modernjs.dev/
- Modern.js BFF docs emphasize RESTful HTTP contracts, type-safe frontend/backend invocation, shared code via `shared`, and version consistency between `@modern-js/app-tools` and `@modern-js/plugin-bff`: https://modernjs.dev/guides/advanced-features/bff/function.html
- Modern.js Module Federation docs describe MF as a split-application architecture, Modern.js MF plugin integration, SSR support, application-level modules, and Bridge loading: https://modernjs.dev/guides/topic-detail/module-federation/introduce
- Modern.js MF SSR docs explicitly cover streaming SSR, component-level remote loading, fallback branches, and experimental data fetching: https://modernjs.dev/guides/topic-detail/module-federation/ssr
- Modern.js route docs cover file-based nested routes, dynamic routes, wildcard routes, pathless layouts, redirects, error boundaries, loading states, and prefetch behavior: https://modernjs.dev/guides/basic-features/routes.html
- Current local UltraModern docs define V3 additions: TanStack runtime, Effect BFF default/split, MF reliability, telemetry, precompression, module SDK contracts, release gates, and CI boundary guards.

## Current Local Evidence

The current fork already covers these important paths:

1. `tests/integration/superapp-erp`
   - Effect BFF runtime via `bff.runtimeFramework: 'effect'`.
   - OpenAPI exposed at `/bff-api/openapi.json`.
   - SSR string mode.
   - TanStack runtime via `src/modern.runtime.tsx`.
   - Shared Effect HttpApi schemas in `shared/superapp-api.ts`.
   - Business fixture modules: dispatch, finance, inventory, HR, chat.
   - Tests cover TypeScript contracts, dev runtime, production build/serve, SSR HTML, route manifest assets, browser errors, Effect API workflows, invalid payload rejection, concurrent mutation stress, route churn, and long-running soak.

2. `tests/integration/routes-tanstack`
   - TanStack route generation, loaders, redirect, optional/dynamic route coverage, blocker/mutation coverage, string and stream modes.

3. `tests/integration/routes-tanstack-mf`
   - MF host + remotes, manifest contracts, remote aliases, shared TanStack runtime, generated router bridge, request-context propagation, remote loader retry/timeout/contract-error behavior.

4. `tests/integration/bff-runtime-parity`
   - Hono/effect parity, error behavior, upload/image/context paths, Effect-only data platform contracts.

5. `tests/integration/bff-corss-project`
   - Cross-project BFF producer/consumer path, generated Effect client, request envelope, operation manifest, locale and traceparent propagation.

6. CI/release infrastructure
   - Linux and Windows integration workflows.
   - Release/module certification gates.
   - Boundary anti-pattern gates.
   - Bun super-app smoke.
   - Test orchestrator for broad package script discovery and lane execution.

## Key Gaps To Close

1. Realistic data and persistence
   - Current ERP state is in-memory.
   - Need database-backed tests with migrations, seeded data, transaction boundaries, idempotency keys, optimistic updates, rollback and recovery.
   - Use SQLite for deterministic CI, then optional Postgres/Redis via service containers for nightly.

2. Authentication and authorization
   - Need session cookies, token refresh, tenant switching, permission boundaries, CSRF, same-site cookie behavior, role-based route guards, unauthorized SSR redirects.

3. Observability and memory
   - Current stress outputs p95/max latency but not memory slope, event-loop delay, CPU profile, request histogram artifact, server logs, browser performance traces, or heap snapshots.

4. Browser and device matrix
   - Current browser automation uses Puppeteer/Chromium.
   - Add Playwright Chromium/WebKit/Firefox, mobile viewport, slow network, offline recovery, high-DPI screenshots, reduced motion.

5. Module Federation production realism
   - Existing MF contracts are good but should add deployed-origin simulation, CDN asset prefixes, stale manifest, remote version skew, remote down, slow remote, remote schema mismatch, duplicate shared dependency and cache poisoning.

6. SSR/stream/RSC edge cases
   - Need systematic matrix across `server.ssr.mode: string | stream`, CSR fallback, SSG, RSC+SSR interactions, hydration mismatch assertions, redirect/notFound/error boundaries and loader cancellation.

7. Load outside Vitest
   - Vitest stress is valuable, but high concurrency should also run with an external HTTP load runner (`autocannon` or `k6`) so the test runner is not the bottleneck.

8. Artifacted certification
   - Need machine-readable output per run: JSON summary, latency histograms, heap/RSS samples, build timings, bundle sizes, route manifest checksum, OpenAPI snapshot, browser error logs.

9. Upstream/dependency drift
   - Upstream is active. Add scheduled lane that pulls/rebases against `origin/main`, runs a focused certification subset, and reports conflicts, dependency updates, and behavioral deltas.

10. Test app diversity
   - One ERP fixture is not enough. We need multiple fake apps that hit different failure modes.

## Test App Portfolio

### App A: ERP Core SuperApp

Purpose: evolve the current `superapp-erp` into a high-signal baseline.

Modules:
- Finance approvals, procurement, inventory, HR, chat, audit log, tenant settings.
- Effect BFF as canonical API.
- TanStack Router with dashboard, nested workflows, dynamic object routes, optional create/edit routes, wildcard 404, route errors and loaders.

Must test:
- Contract/schema validation.
- Optimistic writes and rollback.
- Concurrent approvals and chat.
- Route churn after heavy API mutations.
- SSR HTML correctness and hydration.
- Asset manifest and precompression.
- OpenAPI snapshot compatibility.
- Memory slope during 30m/2h soaks.

### App B: Mobility/Marketplace SuperApp

Purpose: Uber/Grab-like complexity with real-time-ish flows.

Modules:
- Rider booking, driver dispatch, map/search facade, pricing, payments, support chat, promotions, fraud/risk.

Must test:
- High-frequency status updates.
- Cancellation and retries.
- Multi-tenant/region routing.
- Long-running chat/support threads.
- Price quote idempotency.
- Route transitions under streaming updates.
- Offline/online and slow network browser behavior.

### App C: Enterprise MegaERP

Purpose: dense internal app with large tables and workflows.

Modules:
- GL, AP/AR, inventory, CRM, HR, payroll, procurement, document approvals, activity stream.

Must test:
- Large TanStack table/list views.
- Query invalidation.
- Search/filter/sort/pagination.
- Bulk actions and partial failures.
- Cross-module permission boundaries.
- Long nested route tree generation.
- Bundle split and route prefetch budgets.

### App D: Micro-Frontend Platform

Purpose: host/remotes production realism.

Apps:
- Shell host.
- Finance remote.
- Inventory remote.
- Chat/support remote.
- Admin remote.

Must test:
- Host + remotes built and served independently.
- Remote manifest version skew.
- Stale/missing manifest.
- Slow remote fallback.
- Contract mismatch fallback.
- Shared dependency singleton behavior.
- SSR component-level MF.
- App-level MF CSR bridge.
- Traceparent continuity host to remote to BFF.

### App E: Failure Lab

Purpose: deterministic failure injection.

Scenarios:
- API timeout, 500, malformed JSON, invalid envelope, missing trace context.
- Chunk load failure, stale chunk, 404 asset, precompressed asset mismatch.
- Remote down, remote returns wrong component export.
- Loader throws, redirect loops, notFound, hydration mismatch.
- Process restart during load, port collision, SIGTERM graceful shutdown.
- Clock skew and request timeout.

### App F: Deployment Matrix Fixture

Purpose: deployment-like confidence.

Targets:
- Node production server.
- Static CSR deploy.
- SSR with asset prefix.
- Multiple entries.
- i18n SSR.
- precompressed assets.

Must test:
- `Accept-Encoding` negotiation for `.br`/`.gz`.
- CDN/asset prefix correctness.
- cache-control headers.
- routes-manifest correctness.
- source maps and diagnostics artifacts.

## Validation Matrix

### Contract Tests

- TypeScript `tsc --noEmit` for each fake app.
- Effect HttpApi compile-time and runtime schemas.
- OpenAPI JSON snapshots with compatibility diff rules.
- Request/response envelope validation.
- Operation manifest snapshots.
- Module SDK contract validation.
- Route manifest snapshot and asset existence.
- MF manifest snapshot.
- Telemetry event schema snapshots.

Acceptance:
- No missing generated types.
- No unversioned contract breaking changes.
- All invalid payloads fail with 4xx and do not mutate state.
- OpenAPI deltas require explicit expected snapshot update.

### Integration Tests

- Dev server and production build/serve.
- SSR HTML contains expected critical state and no dev-only markers.
- Browser route navigation across all major workflows.
- Loader redirect, notFound, thrown errors, error boundaries.
- Form/mutation flows from UI and direct API.
- Uploads, cookies, headers, locale, traceparent.
- Cross-project producer clients with `requestId` isolation.

Acceptance:
- Zero browser `console.error` and `pageerror`.
- No unexpected 5xx.
- No state drift after invalid requests.
- Build and serve pass on Linux and Windows.

### Load, Stress, Soak

- Short PR stress: 1-3 minutes, deterministic.
- Medium manual stress: 10-20 minutes.
- Nightly soak: 60-120 minutes.
- Weekend soak: 6-12 hours.
- External HTTP load runner for API endpoints.
- Browser route churn while API load runs.

Suggested budgets:
- API p95 under 1,500ms in CI fixture stress.
- API max under 5,000ms in CI fixture stress.
- Zero unhandled promise rejections.
- RSS growth slope below 5-10 MB/hour after warmup for long soak.
- Event loop delay p95 below 100ms for fake apps.
- Route navigation p95 below 1,000ms under local stress.

### Performance And Build

- Cold build time.
- Warm build time.
- Route generation time.
- Production bundle size by route.
- Async chunk count.
- RsDoctor artifact existence and manifest contract.
- Precompression output and served encoding.
- Node startup time and first request time.

Acceptance:
- Budgets stored per fixture in JSON.
- Regression threshold: warn at +10%, fail at +20% unless approved.

### Browser Matrix

- Chromium, WebKit, Firefox.
- Desktop 1440x900.
- Mobile 390x844.
- Slow 4G.
- Offline after initial load.
- Reduced motion.
- Light/dark if app supports it.

Acceptance:
- No overlapping UI at target viewports.
- No hydration mismatch console errors.
- No unhandled chunk/route failures without visible fallback.

### Security And Isolation

- Tenant A cannot read Tenant B data.
- Role permissions enforced in SSR loaders and BFF actions.
- Missing/expired auth redirects correctly.
- CSRF-sensitive mutation checks.
- Header forwarding only where intended.
- RequestId producer isolation.
- CORS and origin envelope validation.
- Redaction of authorization/token headers in telemetry.

Acceptance:
- All negative authorization tests fail closed.
- No sensitive values in logs/artifacts.

### Chaos And Recovery

- Kill and restart production server mid-test.
- Remote service down.
- Slow remote.
- Corrupt manifest.
- Stale asset prefix.
- DB transaction failure.
- Load runner abort.
- Browser reload during mutation.

Acceptance:
- Expected fallbacks render.
- State remains consistent.
- Server exits cleanly on SIGTERM.
- Restart returns to healthy within budget.

## Proposed Execution Waves

### Wave 1: Instrument Current SuperApp

Deliverables:
- Add reusable metrics harness for `superapp-erp`.
- Emit `.modern/superapp-runs/<run-id>/summary.json`.
- Capture p50/p95/p99/max, error counts, state invariant checks, RSS/heap samples, event-loop delay, route timings, browser errors.
- Keep default tests skipped unless env opts in.

Commands:
- Default PR: `pnpm --dir tests exec vitest -c vitest.framework.config.mjs superapp-erp`
- Heavy local: `SUPERAPP_ERP_STRESS=1 SUPERAPP_ERP_STRESS_ROUNDS=50 SUPERAPP_ERP_STRESS_BATCH=64 pnpm --dir tests exec vitest -c vitest.framework.config.mjs superapp-erp/tests/stress.test.ts`
- Soak local: `SUPERAPP_ERP_SOAK=1 SUPERAPP_ERP_SOAK_MS=3600000 pnpm --dir tests exec vitest -c vitest.framework.config.mjs superapp-erp/tests/soak.test.ts`

### Wave 2: Add External Load Runner

Deliverables:
- Add `scripts/superapp-load/run-superapp-load.js`.
- Support `autocannon` first because it is easy to run from Node.
- Optional `k6` profile for larger environments.
- Run against built `modern serve`.
- Write JSON reports.

Scenarios:
- Bootstrap read.
- Approval write.
- Chat write burst.
- Mixed read/write.
- Invalid payload flood.
- Reset cycle.

### Wave 3: Expand Fake App Portfolio

Deliverables:
- `tests/integration/superapp-mobility`
- `tests/integration/superapp-megaerp`
- `tests/integration/superapp-mf-platform`
- `tests/integration/superapp-failure-lab`

Rules:
- All apps use Effect + TanStack as primary path.
- Each app owns a different risk profile.
- Shared helpers only after duplication becomes real.
- Each app has PR smoke, manual stress and nightly profile.

### Wave 4: Browser Matrix With Playwright

Deliverables:
- Add Playwright-driven matrix for SuperApp apps.
- Browser console/pageerror capture.
- Screenshot/video/trace on failure.
- Desktop/mobile/slow network profiles.

Keep Puppeteer tests that are already stable, but use Playwright for matrix breadth.

### Wave 5: Deployment And MF Reliability

Deliverables:
- Multi-process host/remotes harness.
- Asset prefix matrix.
- Stale/down/slow remote simulation.
- MF manifest and type prompt checks.
- SSR component-level MF checks.
- App-level module CSR checks.
- Contract fallback screenshots.

### Wave 6: Security And Tenant Isolation

Deliverables:
- Add auth/session fixture.
- Role matrix tests.
- Tenant switch tests.
- SSR redirect tests.
- CSRF/origin checks.
- Telemetry redaction assertions.

### Wave 7: Nightly And Release Certification

Deliverables:
- `superapp-certification-nightly.yml`.
- Manual workflow inputs for duration, app subset, browser subset and upstream ref.
- Scheduled upstream drift workflow:
  - fetch `origin/main`;
  - rebase/merge in disposable branch or worktree;
  - run focused gates;
  - publish report artifact.
- Weekend soak workflow for self-hosted runner only.

### Wave 8: Readiness Dashboard

Deliverables:
- Machine-readable certification snapshot under `.modern/superapp-certification/latest.json`.
- Historical artifacts in CI.
- Markdown report generator.
- Gate summary:
  - contract: pass/fail
  - integration: pass/fail
  - stress: pass/fail
  - soak: pass/fail
  - browser: pass/fail
  - MF: pass/fail
  - security: pass/fail
  - upstream drift: pass/fail

## CI Structure

PR lanes:
- Lint/package/dependency checks.
- Typecheck.
- Standard `test:framework`.
- SuperApp smoke only; no long soak.
- Contract snapshot checks.
- Linux + Windows.

Manual dispatch:
- Heavy stress.
- Browser matrix.
- MF reliability full matrix.
- External load runner.
- 1h soak.

Nightly:
- Full SuperApp portfolio.
- 1-2h soak.
- Playwright browser matrix.
- Upstream drift check.
- Dependency drift smoke.
- Artifact upload.

Weekend:
- 6-12h soak on self-hosted runner.
- Higher concurrency.
- Memory profiling.
- Heap snapshots before/after.
- Failure-lab chaos suite.

Release candidate:
- PR lanes green.
- Nightly green on latest branch.
- Manual heavy stress green.
- No known P0/P1 open Beads.
- Release certification evidence committed.

## Minimum App Readiness Bar

A complex production-like app is considered ready only when:

1. It has at least one Effect + TanStack SuperApp fixture that passes dev and production build/serve.
2. TypeScript, OpenAPI and Effect schemas pass.
3. SSR HTML, hydration and browser workflows pass.
4. Invalid payloads and auth failures fail closed without state drift.
5. Concurrent writes preserve invariants.
6. Route churn remains stable after stressed state.
7. External load runner stays within budgets.
8. Long soak shows bounded memory slope.
9. MF remotes degrade deterministically.
10. CI artifacts explain every failure without rerunning locally.

## Immediate Implementation Backlog

1. Add metrics/artifact harness to `superapp-erp` stress and soak.
2. Add external load runner for `superapp-erp`.
3. Add Playwright browser matrix profile.
4. Scaffold `superapp-mobility`.
5. Scaffold `superapp-mf-platform`.
6. Add auth/tenant/security fixture.
7. Add failure-lab fixture.
8. Add nightly SuperApp certification workflow.
9. Add upstream drift certification workflow.
10. Add certification report generator.

## Recommended First Cut

Start with Wave 1 and Wave 2. They multiply the value of the existing test investment without introducing four new apps at once. Once metrics and artifacts exist, add new apps into the same harness. This keeps every future test from becoming another isolated suite that only prints pass/fail.
