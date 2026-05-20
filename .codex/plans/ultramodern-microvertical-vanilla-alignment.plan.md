---
name: Ultramodern MicroVertical Vanilla Alignment
overview: Align UltraModern workspace generation with vanilla Modern.js and official Zephyr integration while making TanStack Router and Tailwind default-on across generated apps. Keep the work domain-neutral and avoid ERP-specific framework behavior.
todos:
  - id: dependency-baseline
    content: Update generator dependency constants and validators to current latest compatible versions: zephyr-modernjs-plugin 1.1.1, @module-federation/modern-js-v3 2.4.0, @tanstack/react-router 1.170.6, tailwindcss 4.3.0, and @tailwindcss/postcss 4.3.0.
    status: completed
  - id: tailwind-default-everywhere
    content: Make Tailwind CSS v4 default-on for generated UltraModern apps and workspaces, preserve opt-out behavior, and update generated PostCSS/Tailwind config plus package metadata consistently.
    status: completed
  - id: zephyr-vanilla-lifecycle
    content: Keep Zephyr wired only through the official zephyr-modernjs-plugin with withZephyr() in the Modern.js plugins array; validate normal modern dev/build/serve lifecycle and avoid adding zephyr-specific user commands.
    status: completed
  - id: microvertical-descriptors
    content: Refactor the hardcoded demo topology into reusable neutral MicroVertical descriptors for shell, vertical remote, horizontal remote, service, and shared package generation.
    status: completed
  - id: add-flow-design
    content: Design and implement a thin UltraModern add/subproject flow close to @modern-js/create that derives paths, package names, ports, MF names, and topology updates from a requested MicroVertical name and kind.
    status: completed
  - id: validator-and-tests
    content: Update workspace validator and integration tests to assert domain-neutral SuperApp/MicroVertical invariants, Tailwind default-on behavior, official Zephyr plugin placement, normal build lifecycle, and generated topology consistency.
    status: completed
  - id: docs-and-operator-contract
    content: Update README and ADR guidance to describe the vanilla-aligned add flow, Tailwind defaults, Zephyr validation expectations, opt-outs, and non-ERP scope boundaries.
    status: completed
isProject: true
---

# Ultramodern MicroVertical Vanilla Alignment

## Execution Notes

This plan follows the research conclusion that UltraModern.js should remain a strong SuperApp baseline, not an ERP builder. The implementation should improve universal workspace ergonomics and production readiness without adding ERP-specific concepts, auth assumptions, accounting concepts, entity registries, or MCP surfaces.

The Zephyr integration must stay close to official Zephyr and Modern.js behavior: install `zephyr-modernjs-plugin`, import `withZephyr`, place `withZephyr()` in the Modern.js `plugins` array, and let ordinary `modern dev`, `modern build`, and `modern serve` exercise the lifecycle. Live Zephyr evidence belongs in CI or release validation using normal build commands and Zephyr credentials, not in a custom `zephyr:*` command family.

The MicroVertical add flow should be thin sugar over existing Modern.js create/generation primitives. It should avoid requiring users to repeatedly pass `--router tanstack --tailwind --workspace --sub` when running through the UltraModern/BleedingDev entrypoint, and it should derive conventional paths such as `apps/remotes/remote-catalog` or `services/catalog-api` from a short name and kind.

## Constraints

- Do not resurrect `modern new`; Modern.js 3 removed it.
- Do not add user-facing Zephyr commands.
- Do not create an ERP framework or add domain-specific ERP primitives.
- Keep TanStack Router default-on for UltraModern app surfaces.
- Make Tailwind CSS v4 default-on everywhere UltraModern generates app UI, with opt-out.
- Keep Zephyr on the official `zephyr-modernjs-plugin` package.
- Prefer reusable generator descriptors over one-off string patches.
- Preserve existing generated workspace guarantees unless the validator and tests are intentionally updated.

## Operator Guidance

Suggested launch order:

1. Start with dependency-baseline and tailwind-default-everywhere because later generated files and tests depend on the version constants and Tailwind default contract.
2. Run zephyr-vanilla-lifecycle in parallel with descriptor design if desired, because it should mostly tighten validation and docs rather than touch generator topology.
3. Do microvertical-descriptors before add-flow-design; the add flow should call shared descriptor/writer logic rather than duplicate current workspace generation.
4. Finish with validator-and-tests, then docs-and-operator-contract.

Primary files expected to change include `packages/toolkit/create/src/ultramodern-workspace.ts`, `packages/toolkit/create/src/index.ts`, `packages/toolkit/create/template*`, generated workspace validator templates, integration tests under `tests/integration/create-*`, and relevant SuperApp RFC/ADR docs.
