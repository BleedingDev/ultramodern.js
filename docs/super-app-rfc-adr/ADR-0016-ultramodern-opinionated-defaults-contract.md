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
| Performance readiness | Diagnostics and optional release gates | Opt-in checks, never default build blockers |
| JSON-LD and accessibility certification | Deferred/out-of-scope | No active enforcement |

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

## Private-First Public Surfaces

Generated UltraModern app routes are private and non-indexable by default.
Private, auth, tenant, dashboard, internal, and normal product app screens must
not appear in robots, sitemap, `llms.txt`, API catalogs, or public manifests
unless they explicitly opt in through the route metadata surface or are generated
as public starter/docs/help/product surfaces.

The minimal public metadata surface is:

- `public`
- `indexable`
- title
- description
- canonical inference
- locale alternates
- opt-out behavior

Localized metadata and `hreflang` generation apply only to public/indexable
routes for generated public files. Locale redirects may still use private route
metadata for routing correctness.

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

Performance readiness checks are diagnostics or opt-in release gates. They may
cover navigation warmup waste ratio, duplicate prefetches, `Save-Data`, cache
policy sanity, BFCache diagnostics, Core Web Vitals/RUM readiness, and
Cloudflare SSR response/caching hints. They are not default build blockers.

Navigation warmup already exists and must not bypass trust, fallback, or
telemetry contracts.

## Downstream Boundaries

- `modernjs-fikq`: implement platform security defaults through framework,
  server, deploy, and template owners only.
- `modernjs-04jb`: implement generated public files from the private-first route
  metadata model.
- `modernjs-a6d4`: implement resilience defaults and optional diagnostics without
  accessibility certification.
- `modernjs-ztla`, `modernjs-5dic`, `modernjs-b5cb`, `modernjs-sddt`: inherit
  these boundaries and must not reintroduce rejected profile/compliance engines.

## Validation

Validation must use docs, Beads dependencies, generated contract checks, plan
graph constraints, and objective tests. This ADR is the durable context source
for agents that start without prior chat history.
