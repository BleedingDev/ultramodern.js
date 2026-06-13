---
name: open-beads-fast-06-server-resilience
overview: "Finish modernjs-a6d4.3 by adding production-safe BFF/server failure envelopes, deterministic 500/503 behavior, and maintenance Retry-After support where owned."
todos:
  - id: inventory-server-error-paths
    content: "Inventory Effect, Edge, Hono, prod-server, and BFF adapter unmanaged error paths, current onError hooks, operation context propagation, and raw message/stack leakage."
    status: completed
  - id: design-safe-envelope
    content: "Define one fork-owned safe failure envelope/status mapper that preserves trace/operation context without leaking raw production details."
    status: completed
  - id: implement-bff-server-envelopes
    content: "Implement typed safe failure envelopes across owned Effect, Edge, Hono, and prod-server BFF paths with deterministic 500/503 behavior."
    status: completed
  - id: add-maintenance-retry-after
    content: "Add or wire framework-owned maintenance response support with Retry-After where the owning server layer can enforce it."
    status: completed
  - id: test-server-resilience
    content: "Add parity tests covering safe production redaction, development diagnostics where intended, 500/503 statuses, Retry-After, onError preservation, and operation context/trace linkage."
    status: completed
  - id: close-a6d4-3
    content: "Update and close modernjs-a6d4.3 with validation evidence."
    status: completed
isProject: false
---

# open-beads-fast-06-server-resilience

## Execution Notes

This is the highest-value resilience child because server-side error leakage affects correctness and security directly. It should use owning server/BFF layers, not app-level shims.

Primary Bead: `modernjs-a6d4.3`. Context: `docs/super-app-rfc-adr/ADR-0005-cross-project-bff-hardening.md` and `docs/super-app-rfc-adr/ADR-0016-ultramodern-opinionated-defaults-contract.md`.

## Constraints

Do not hide framework defects in app fixtures. Do not break `serverConfig.onError`, operation context, or trace propagation. Production responses must not leak raw stacks/messages; development behavior can stay diagnostic if tests make that boundary explicit.

## Operator Guidance

Assign one or two subagents if needed: one for BFF/Effect/Hono paths and one for prod-server/Edge paths, with a single owner for the shared envelope shape. This lane can start immediately and run parallel to frontend route error hardening.
