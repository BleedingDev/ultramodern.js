---
name: Ultramodern Readiness 05 Add Flow Hardening
overview: Harden the UltraModern MicroVertical add flow so remote, horizontal remote, service, and shared package generation are consistently tested, validator-clean, Tailwind-default, Zephyr-compatible, and close to vanilla Modern.js expectations.
todos:
  - id: inventory-add-flow-variants
    content: Inventory every supported add-flow kind and the generated files, package names, ports, scripts, topology entries, ownership entries, and local overlays each one should produce.
    status: pending
  - id: expand-integration-tests
    content: Add integration coverage for remote, horizontal-remote, service, shared, duplicate names, invalid names, and validation after add.
    status: pending
  - id: verify-tailwind-defaults
    content: Ensure every generated app UI surface from the add flow receives Tailwind v4 by default and honors opt-out behavior where supported.
    status: pending
  - id: verify-zephyr-compatibility
    content: Ensure generated remotes keep official Zephyr plugin compatibility and do not introduce custom Zephyr commands or hardcoded deployment assumptions.
    status: pending
  - id: verify-effect-service-contracts
    content: Ensure service add-flow output follows the strict Effect HttpApi contract pattern from the point 2 plan.
    status: pending
isProject: true
---

# Ultramodern Readiness 05 Add Flow Hardening

## Execution Notes

The generator is the front door. This plan is not about adding more framework surface; it is about proving the surface already created behaves consistently for every supported MicroVertical kind.

## Constraints

- Do not add extra low-level flags when the generator can derive safe defaults.
- Do not drift away from vanilla Modern.js create conventions.
- Do not add ERP-specific names or concepts.
- Keep Tailwind default-on for generated UI.

## Operator Guidance

Treat this as a generator QA pass. The most valuable outcome is a small, fast test matrix that catches broken generated paths before users do.
