author: codex
timestamp: 2026-05-14T23:55:00Z
ticket_id: modernjs-2ub
commit_sha: 7198e6b36cc4a96a495c005a441ac45f5044a1d7
workflow_run_url: https://github.com/BleedingDev/ultramodern.js/actions/workflows/contract-gates.yml

# Architecture Evidence

- Scope: extend release-candidate gates to cover the Effect service boundary required by `presetUltramodern` Micro Verticals.
- Decision: treat Effect adapter request propagation as a release-gated contract target, not only a package-local regression.
- Rationale: an Effect service can act as a backend boundary only when authorization, tenant, locale, trace, and correlation metadata move from shell or remote callers into the service without bespoke header plumbing.
- Compatibility: `@modern-js/plugin-bff/server` stays Effect-first; Hono remains available through the explicit `@modern-js/plugin-bff/hono-server` compatibility lane.
- Out of scope: no `presetMicroVerticals`, migration/codemod, AI/MCP operations, or downstream business-domain scaffold work is introduced by this gate.
