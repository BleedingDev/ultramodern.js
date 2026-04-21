---
name: Ultramodern Single Preset MV Program
overview: Drive the remaining work needed to support true Micro Verticals under one public presetUltramodern, using core capability seams for router, Module Federation SSR, and service contracts instead of letting the preset hide framework gaps.
todos:
  - id: uspmv-01
    content: Capture the dependency order and execution graph for the single-preset MV program by combining the completed MV-first framework hardening foundation with the current single-preset architecture direction.
    status: completed
  - id: uspmv-02
    content: Execute the router, Module Federation SSR, BFF contract, and preset rollout plans in dependency order.
    status: completed
  - id: uspmv-03
    content: Publish final merge-safety, compatibility, and rollout evidence for the one-preset MV direction.
    status: completed
isProject: true
---

# Ultramodern Single Preset MV Program

## Execution Notes

This plan is the rollup created from the current chat history plus the older completed `MV-First Framework Hardening` plan. It replaces hand-wavy architecture discussion with a concrete execution graph centered on one public preset and a small set of required core seams.

The current conclusion is:

1. We can keep one public preset.
2. We cannot rely on preset policy alone for true Micro Verticals.
3. Router, MF SSR, and service-contract capability seams must exist in core.
4. The preset then becomes the public hardening and adoption surface for large super-apps.

The older MV-first hardening plan is treated as completed prerequisite groundwork:

1. product-taxonomy purge and boundary hardening
2. initial TanStack parity and MV-first SSR contract work
3. Effect-first and compatibility evidence groundwork
4. release-gate and stronger-default governance setup

## Constraints

1. Keep the public surface to one preset.
2. Do not let the project drift into an unmergeable fork.
3. Preserve compatibility lanes without promoting them as the default direction.
4. Keep business taxonomy downstream-owned.

## Operator Guidance

Use this as the graph entrypoint for future execution. The project plan itself should stay a downstream rollup node; real implementation begins in the dependency plans upstream of it.

When this program advances, keep updating only the specific child plans rather than re-writing the umbrella plan into a giant checklist.

## References

- [docs/super-app-rfc-adr/ARCH-0001-effect-tanstack-target-architecture.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/ARCH-0001-effect-tanstack-target-architecture.md)
- [docs/super-app-rfc-adr/BOUNDARY-0001-framework-core-vs-module-vs-external-matrix.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/BOUNDARY-0001-framework-core-vs-module-vs-external-matrix.md)
- [docs/super-app-rfc-adr/ADR-0002-app-level-mf-ssr-strategy.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/ADR-0002-app-level-mf-ssr-strategy.md)
- [docs/super-app-rfc-adr/ADR-0005-cross-project-bff-hardening.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/ADR-0005-cross-project-bff-hardening.md)
