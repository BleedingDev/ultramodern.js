---
name: Ultramodern MV Extraction Governance
overview: Codify the ownership, extraction, dependency, and module-governance rules that let teams split shell-local work into remotes and services without reintroducing monolith drift or framework-domain leakage.
todos:
  - id: umeg-01
    content: Define an extraction rubric for when a feature stays shell-local, when it graduates into an MF remote, and when it must become an independent service.
    status: pending
  - id: umeg-02
    content: Extend module and ownership metadata so routes, remotes, services, and shared packages can be certified and reviewed as vertical boundaries instead of ad hoc code moves.
    status: pending
  - id: umeg-03
    content: Publish shared design-system and shared-package governance rules that keep tokens, primitives, and feature composites from collapsing vertical boundaries.
    status: pending
  - id: umeg-04
    content: Publish a migration and review playbook for extracting existing Modern.js apps into Micro Verticals while preserving upstream mergeability and compatibility lanes.
    status: pending
isProject: false
---

# Ultramodern MV Extraction Governance

## Execution Notes

The missing problem is no longer technical capability. It is governance: teams need a repeatable way to decide when to split code, how to keep ownership visible, and how to avoid recreating a distributed monolith through shared-package abuse.

This plan should stay downstream-usable and merge-friendly. The rules belong in governance, manifests, review checklists, and certification overlays, not in framework-core product taxonomy.

## Constraints

1. Preserve the boundary matrix: framework core remains domain-neutral.
2. Avoid hardcoding product-family taxonomies into module SDK contracts.
3. Keep Hono and React Router as explicit compatibility lanes, not hidden default escape hatches.
4. Prefer auditable manifests, checklists, and certification overlays over tribal knowledge.

## Operator Guidance

The work should produce:

- a clear extraction decision tree,
- ownership metadata that reviewers and gates can read,
- shared package rules that stop vertical drift,
- and a migration playbook for teams moving from one app to shell + remotes + services.

## References

- [docs/super-app-rfc-adr/BOUNDARY-0001-framework-core-vs-module-vs-external-matrix.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/BOUNDARY-0001-framework-core-vs-module-vs-external-matrix.md)
- [docs/super-app-rfc-adr/SDK-0001-module-sdk-contracts.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/SDK-0001-module-sdk-contracts.md)
- [docs/super-app-rfc-adr/ADR-0007-module-certification-gates.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/ADR-0007-module-certification-gates.md)
- [docs/super-app-rfc-adr/DELIVERY-0001-micro-vertical-reference-delivery.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/DELIVERY-0001-micro-vertical-reference-delivery.md)
- [scripts/boundary-guards/profile.json](/Users/satan/side/experiments/modernjs/scripts/boundary-guards/profile.json)
- [docs/super-app-rfc-adr/contracts/module-sdk-contracts.json](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/contracts/module-sdk-contracts.json)
