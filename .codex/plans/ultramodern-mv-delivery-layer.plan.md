---
name: Ultramodern MV Delivery Layer
overview: Capture the reference shell, remote, and service delivery model for true Micro Verticals on top of the completed single-preset core seams so teams can adopt the architecture without inventing topology or ownership rules ad hoc.
todos:
  - id: umdl-01
    content: Publish a reference micro-vertical structure that maps shell apps, MF remotes, and Effect/Hono service boundaries onto one merge-friendly presetUltramodern workflow.
    status: completed
  - id: umdl-02
    content: Document shell-to-vertical extraction workflow, including when to split routes, BFF clients, and Module Federation surfaces.
    status: completed
  - id: umdl-03
    content: Index the repo's external-remote, TanStack MF, and cross-project BFF examples as the canonical delivery references for MV adoption.
    status: completed
  - id: umdl-04
    content: Define shared design-system and module ownership guidance so design/runtime contracts stay stable across independently deployed verticals.
    status: completed
  - id: umdl-05
    content: Publish a developer-ergonomics checklist for teams adopting Micro Verticals under presetUltramodern.
    status: completed
isProject: false
---

# Ultramodern MV Delivery Layer

## Execution Notes

The earlier MV-first and single-preset plans intentionally stopped at framework capability seams. This follow-on plan captures the delivery contract that was still missing from the chat history: how teams are supposed to structure shell, remote, and service ownership once the technical seams are in place.

This plan is documentation-and-reference work, not a new runtime fork. It turns the existing working fixtures and ADRs into an explicit delivery model so downstream teams do not have to infer topology from test directories.

## Constraints

1. Keep one public preset: `presetUltramodern(...)`.
2. Do not encode product-domain taxonomy in framework core.
3. Reuse the existing repo examples rather than inventing a second demo stack.
4. Keep the guidance compatible with both TanStack-first / Effect-first preferred lanes and explicit Hono compatibility lanes.

## Operator Guidance

Treat this as the handoff from platform work to downstream adoption. The output should answer:

- what lives in the shell,
- what graduates into a remote,
- what becomes an independent service,
- how request/trace/locale context crosses those boundaries,
- and how teams keep shared UI and contracts stable without collapsing back into a monolith.

## References

- [docs/super-app-rfc-adr/DELIVERY-0001-micro-vertical-reference-delivery.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/DELIVERY-0001-micro-vertical-reference-delivery.md)
- [tests/integration/routes-tanstack-mf](/Users/satan/side/experiments/modernjs/tests/integration/routes-tanstack-mf)
- [tests/integration/bff-corss-project](/Users/satan/side/experiments/modernjs/tests/integration/bff-corss-project)
- [tests/integration/bff-runtime-parity](/Users/satan/side/experiments/modernjs/tests/integration/bff-runtime-parity)
