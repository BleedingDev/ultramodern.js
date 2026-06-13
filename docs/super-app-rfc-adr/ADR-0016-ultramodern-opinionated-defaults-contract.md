# ADR-0016: UltraModern Opinionated Defaults Contract

- Status: Accepted
- Date: 2026-06-05
- Related Beads: `modernjs-99vw`, `modernjs-fikq`, `modernjs-04jb`, `modernjs-a6d4`, `modernjs-ztla`, `modernjs-5dic`, `modernjs-b5cb`, `modernjs-sddt`
- Related Documents:
  - `ARCH-0001-effect-tanstack-target-architecture.md`
  - `PREFLIGHT-0001-ultramodern-superapp-readiness.md`
  - `CLOUDFLARE-ZEPHYR-0001-ultramodern-worker-ssr.md`
  - `ADR-0002-app-level-mf-ssr-strategy.md`
  - `ADR-0005-cross-project-bff-hardening.md`

## Decision

UltraModern defaults are a self-contained framework and template contract. They
model good starter behavior, security posture, resilience behavior, and public
surface generation without introducing a broad `webSpec`, `profile`,
`agentReadiness`, or compliance-engine configuration system.

The framework may enforce objective defects it owns, such as invalid server
headers, unsafe production cookie defaults, broken route statuses, trust-bypassing
Module Federation fallback, or deterministic generated-file instability. It must
not globally fail arbitrary product UI, product copy, app information
architecture, accessibility certification, or business-domain quality claims.

## Ownership Matrix

| Concern | Owner | Enforcement |
| --- | --- | --- |
| Security headers, production cookies, CSP rendering, noindex for server-owned non-production responses | Framework server, deploy adapter, generated config | Typed config, platform adapters, unit/integration tests |
| Cloudflare Module Federation SSR response headers, remote manifests, remote assets, preview behavior | Deploy adapter and generated Cloudflare contract | Cloudflare-first proof scripts and MF SSR tests |
| App route publicness, route metadata, generated public files | Template generator and route metadata API | Private-first metadata, deterministic generated outputs |
| Starter pages, example copy, localized metadata | Templates | Generated files and template validation |
| Resilience statuses, BFF failure envelopes, MF fallback telemetry | Server/runtime/BFF owners | Runtime tests and telemetry contracts |
| Performance readiness | Default-on diagnostics with explicit opt-out | Generated report script, typed opt-out config, framework-owned invariant tests |
| Explicit route JSON-LD and accessibility certification | Route metadata API for JSON-LD, out-of-scope for accessibility certification | Optional helper types, no inference or certification engine |

## Explicit Rejections

1. Do not add a broad `webSpec`, profile, certification, or agent-readiness
   engine.
2. Do not add app-level shims, generated suppressions, route wrappers, click
   interceptors, hook bypasses, or demo-only patches to hide framework defects.
3. Do not hard-fail arbitrary app screens for SEO, accessibility certification,
   marketing copy, or product UI choices.
4. Do not require route owner, route id, canonical path, or structured data fields
   for normal private app screens.
5. Do not stamp sitemap `lastmod` with build time. Omit `lastmod` when reliable
   content or metadata modification time is unavailable.
6. Do not infer JSON-LD from route titles, descriptions, localized paths, app
   names, Module Federation metadata, or BFF contracts.

## Private-First Public Surfaces

Generated UltraModern app routes are private and non-indexable by default.
Private, auth, tenant, dashboard, internal, and normal product app screens must
not appear in robots, sitemap, `llms.txt`, API catalogs, or public manifests
unless they explicitly opt in through the route metadata surface or are generated
as public starter/docs/help/product surfaces.

The minimal public metadata surface is:

- `public`
- `indexable`
- `publicSurface`
- title and description keys
- canonical and localized path inference
- opt-out behavior
- optional reliable content modification time

Localized metadata and `hreflang` generation apply only to public/indexable
routes for generated public files. Locale redirects may still use private route
metadata for routing correctness.

Generated public files are deterministic and private-first. With no
public/indexable routes, generated app screens emit only a `robots.txt` that
disallows crawling; sitemap, web manifest, `llms.txt`, API catalog, security.txt,
and JSON-LD output are omitted. When public routes exist, generated discovery
files are derived only from `publicRoutes`, never from private route ownership,
tenant, auth, Effect BFF, or Module Federation metadata. Sitemap `lastmod` is
omitted unless a stable content date exists.

## Explicit JSON-LD Policy

UltraModern does not infer structured data automatically. JSON-LD is optional
route metadata authored beside localized paths, title and description keys, and
public/indexable flags. The generated head renderer may emit JSON-LD only when
the matched route is explicitly `public && indexable` and the route metadata
contains a `jsonLd` value. Private, auth, tenant, dashboard, internal, and
normal app screens emit no JSON-LD by default even when they have titles,
descriptions, localized paths, BFF APIs, or Module Federation boundaries.

Generated apps provide typed helper builders for common app-safe schema.org
types: `WebPage`, `WebApplication`, `SoftwareApplication`, `BreadcrumbList`,
`FAQPage`, and `Organization`. Raw JSON-LD remains possible through the same
`jsonLd` route metadata field when an author needs a type outside that helper
surface. The helpers are authoring aids, not a profile, compliance, or automatic
schema engine.

## Security Defaults And Escape Hatches

Security defaults must be platform-aware. Cloudflare Module Federation SSR is
the first compatibility target, followed by Node/Modern server and other
Modern.js-supported deployments where the owning layer can enforce behavior.

The common security contract covers:

- `Referrer-Policy`
- `X-Content-Type-Options`
- `Permissions-Policy`
- `frame-ancestors`
- starter CSP policy
- secure production cookies
- non-production noindex where server-owned

Escape hatches must be typed and explicit for embedded apps, enterprise SSO,
legacy third-party widgets, CSP report-only or disable behavior, additional
script/connect origins, and viewport zoom exceptions.

## Resilience And Performance Readiness

Framework-owned runtime behavior must preserve correct 404, 500, and 503
statuses, maintenance `Retry-After`, production stack redaction, deterministic
Module Federation fallback, and fallback telemetry. Effect BFF failure envelopes
and operation context remain owned by the BFF/server layer.

Performance readiness diagnostics are default-on for generated UltraModern
workspaces. The generated contract defines a stable signal set for BFCache,
Core Web Vitals/RUM readiness, duplicate prefetch/warmup waste, cache policy
sanity, `Save-Data` behavior, and Cloudflare SSR response/caching hints. The
generated `scripts/ultramodern-performance-readiness.mjs` command emits a
deterministic JSON report and is wired into the default generated build/check
flow.

The explicit opt-out is
`scripts/ultramodern-performance-readiness.config.mjs#enabled=false`, with
`ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS=false` reserved for local or CI
fast paths. The config carries the generated
`UltramodernPerformanceReadinessDiagnosticsConfig` type. These diagnostics may
fail objective generated/framework invariants, such as missing generated
contracts or duplicate generated route/remote metadata, but must not become
synthetic benchmark gates, product UI scorecards, accessibility certification,
marketing-copy blockers, or a broad compliance engine. They must not revive
dead RsDoctor artifact machinery; RsDoctor remains separately opt-in.

Navigation warmup already exists and must not bypass trust, fallback, or
telemetry contracts.

## Downstream Boundaries

- `modernjs-fikq`: implement platform security defaults through framework,
  server, deploy, and template owners only.
- `modernjs-04jb`: implement generated public files from the private-first route
  metadata model.
- `modernjs-a6d4`: implement resilience defaults and default-on performance
  readiness diagnostics without accessibility certification or broad compliance
  gates.
- `modernjs-ztla`, `modernjs-5dic`: inherit these boundaries and must not
  reintroduce rejected profile/compliance engines.
- `modernjs-sddt`: resolved as no automatic JSON-LD inference.
- `modernjs-b5cb`: implement optional typed JSON-LD helpers through route-owned
  metadata only.

## Validation

Validation must use docs, Beads dependencies, generated contract checks, plan
graph constraints, and objective tests. This ADR is the durable context source
for agents that start without prior chat history.
