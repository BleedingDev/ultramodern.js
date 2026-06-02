---
name: ultramodern-production-05-erp-scale-topology
overview: Prove UltraModern SuperApps can scale from demo-sized compositions to ERP-like topologies with many verticals, shared runtime dependencies, and measurable build/runtime budgets.
todos:
  - id: define-scale-profiles
    content: Define source and published package scale profiles for 10, 25, and 50 verticals, including expected route count, module federation remote count, shared dependency policy, generated package names, and time/resource budgets for install, check, build, and browser smoke.
    status: completed
  - id: generalize-vertical-generation
    content: Extend the generated SuperApp proof path beyond the current fixed ten vertical names in `run-published-create-proof.mjs` so it can generate deterministic ERP-like vertical sets without hand-written fixture code.
    status: completed
  - id: connect-existing-erp-fixtures
    content: Reuse lessons and utilities from `tests/integration/superapp-erp` and `tests/integration/superapp-portfolio` to validate large topology contracts, avoiding a parallel bespoke test framework.
    status: pending
  - id: add-scale-certification-script
    content: Add a scale certification script that records topology size, install/build/check/browser timings, memory-sensitive failures, remote-manifest status, and shared-version cohort assertions as structured evidence.
    status: completed
  - id: schedule-heavy-ci
    content: Wire small scale proof into regular production readiness and larger ERP-scale proof into scheduled or manually triggered CI so normal publishing remains practical while release candidates get deeper coverage.
    status: completed
  - id: document-scale-envelope
    content: Publish the current supported SuperApp scale envelope, known budgets, and escalation path for tens-of-modules ERP adopters in main docs and generated workspace guidance.
    status: pending
isProject: false
---

# Production Point 5: ERP Scale Topology

## Research Basis

- `scripts/ultramodern-production-readiness/run-published-create-proof.mjs` currently scaffolds a generated SuperApp with ten fixed vertical names.
- `tests/integration/superapp-erp` already contains ERP-oriented fixtures, soak/stress tests, and metrics helpers.
- `tests/integration/superapp-portfolio` already covers runtime/build matrix, load, stress, security, and chaos-style portfolio scenarios.
- Existing scripts such as `validate:superapp-certification:*`, `load:superapp-erp`, and `validate:superapp-erp-effect-load` indicate there is already certification vocabulary to build on.

## Constraints

- Scale proof should measure actual generated workspaces and published package behavior, not only static fixtures.
- Keep heavy tests out of every publish path unless budgets prove they are fast enough.
- Preserve the shared-version policy: large topology generation must not normalize mismatched package cohorts.

## Done Means

- UltraModern has a reproducible ERP-like generated topology proof.
- Regular CI checks a practical scale floor; scheduled/manual CI checks a larger ceiling.
- The documented supported envelope matches measured evidence.
