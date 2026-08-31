---
'@modern-js/plugin-bff-extensions': minor
---

Publish fork-owned Effect adapter tooling, Hono policy middleware, client
generation, and backend federation integration without growing the
upstream-owned BFF plugin. The dedicated edge federation boundary accepts only
static, service, or binding entry providers and rejects Node evaluators and
custom runtimes.

Effect and its OpenTelemetry integration are exact optional peers at
`4.0.0-rc.112`; the Hono entry remains peer-independent. The package consumes
the public `@modern-js/bff-effect` surface directly, so no dependency cycle or
re-export-only `adapter-kit` is introduced.

Expose only purpose-specific subpaths. The package intentionally has no root
barrel, avoiding a convenience surface that would couple unrelated Node,
Worker, adapter, generator, and federation capabilities.
