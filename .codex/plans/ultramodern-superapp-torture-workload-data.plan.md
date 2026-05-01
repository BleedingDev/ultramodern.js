---
name: UltraModern SuperApp Torture Workload Data
overview: Expand the SuperApp pilot fixtures into larger, more realistic ERP, mobility, marketplace, chat, and tenant datasets that can drive high-volume read/write, pagination, search, and permission workloads.
todos:
  - id: ust-data-01
    content: "Define realistic multi-tenant fixture domains for ERP finance, dispatch, marketplace orders, fleet mobility, chat threads, audit events, and admin operations."
    status: pending
  - id: ust-data-02
    content: "Generate deterministic large datasets with thousands of orders, invoices, rides, messages, audit entries, users, roles, and tenant-scoped resources."
    status: pending
  - id: ust-data-03
    content: "Add workload scenario definitions for read-heavy, write-heavy, mixed, search/filter/sort, chat pagination, and tenant-boundary probes."
    status: pending
  - id: ust-data-04
    content: "Add reset and seed paths that restore deterministic state between stress, chaos, browser, and contract runs."
    status: pending
  - id: ust-data-05
    content: "Record dataset size, scenario coverage, and reset integrity in a machine-readable artifact."
    status: pending
isProject: true
---

# UltraModern SuperApp Torture Workload Data

## Execution Notes

This is the second root lane. It turns the current pilot from a representative smoke fixture into a workload source large enough to expose query, routing, serialization, cache, and state-reset problems.

The dataset should remain deterministic. Prefer generated fixtures committed as compact definitions or generator code over huge opaque data blobs. Every scenario must be reproducible by seed and tenant id.

Scenarios should cover the paths a real SuperApp stresses: cross-module dashboards, tenant switching, high-cardinality tables, chat history, optimistic writes, search/filter/sort, invalid tenant access, and idempotent retries.

## Constraints

Do not make default tests slow by loading maximum datasets unconditionally. Keep large scenarios opt-in for release/nightly torture profiles.

Do not add external databases unless a later explicit plan chooses that direction. The immediate target is framework and app-shell readiness, so deterministic in-process or fixture-backed data is acceptable.

## Operator Guidance

Suggested ownership is `tests/integration/superapp-portfolio` data, scenario definitions, and reset helpers. Avoid shared certification script changes unless they only expose the new scenario metadata.

Conflict risk is highest with browser and contract lanes consuming these scenarios. Stabilize names and fixture IDs early, then treat them as contracts.

Exit criteria: load, chaos, browser, and Effect/TanStack contract lanes can all consume the same deterministic production-like scenario catalog.
