---
name: Ultramodern Beads Live Control Plane
overview: Implement modernjs-1ap by adding an install-backed live UltraModern local control-plane mode for generated SuperApp workspaces while preserving the cheap dry-run preflight default.
todos:
  - id: ubf-live-01
    content: Design install-backed live local control-plane mode, including package source strategy for generated workspaces outside the Modern.js monorepo.
    status: completed
  - id: ubf-live-02
    content: Implement live startup for generated shell, remotes, design-system remote, and Effect service with deterministic process ownership and environment wiring.
    status: completed
  - id: ubf-live-03
    content: Add live readiness probes, log capture, failure classification, and deterministic teardown while keeping cheap preflight on dry-run mode by default.
    status: completed
  - id: ubf-live-04
    content: Prove live mode through generated workspace validation, preserve contract-doctor and dry-run preflight behavior, then update modernjs-1ap.
    status: completed
isProject: true
---

# Ultramodern Beads Live Control Plane

## Execution Notes

This lane is unblocked only after upstream drift closure is clean. It owns `modernjs-1ap`: live local control-plane mode beyond the current generated-workspace dry-run preflight.

Reuse the existing dry-run control-plane and SuperApp certification process-control machinery. Do not build a second orchestration stack. The hard part is generated-workspace package resolution outside the monorepo plus reliable process lifecycle evidence.

## Scope

Own generated-workspace live startup, package source resolution, process lifecycle, readiness probes, log capture, failure classification, teardown, and validation evidence.

The design-system remains a normal Module Federation remote. Effect services remain normal BFF/service runtime pieces. Cheap UltraModern preflight remains dry-run by default.

Do not touch TanStack RSC payload-router behavior or upstream-drift conflict resolution beyond consuming the clean baseline.

## Validation

Minimum proof for completion:

- `pnpm run validate:ultramodern-preflight`
- `pnpm run validate:mv-topology-smoke`
- targeted live-control-plane generated workspace validation added by this lane
- dry-run behavior remains cheap and default
- failures include actionable logs and deterministic teardown evidence
