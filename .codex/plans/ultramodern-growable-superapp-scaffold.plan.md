---
name: ultramodern-growable-superapp-scaffold
overview: Transform UltraModern scaffolding and documentation so users start with a simple production-ready app by default, opt into a SuperApp workspace only when needed, and can grow into real business MicroVerticals through an explicit add-vertical command that wires the existing repository correctly.
todos:
  - id: define-product-modes
    content: Define the supported scaffold modes and command contract: simple UltraModern app by default, explicit SuperApp workspace mode, optional example/demo mode outside the default path, and in-place `--vertical` mutation for real business domains.
    status: completed
  - id: update-create-cli-defaults
    content: Update `@modern-js/create` detection and CLI help so the BleedingDev UltraModern create entrypoint creates a simple app by default instead of forcing a multi-vertical workspace, while preserving explicit workspace and package-source flags.
    status: completed
  - id: simplify-workspace-generator
    content: Change the UltraModern workspace generator so a new workspace does not force placeholder `workspace`, `records`, and `actions` verticals; provide either shell-only or one explicitly named starter vertical, with topology, package scripts, CSS isolation, i18n, Effect BFF, and validation still coherent.
    status: completed
  - id: harden-add-vertical-flow
    content: Re-validate and tighten `create <domain> --vertical` as the human-facing growth path, proving it creates a full-stack MicroVertical and updates topology, ownership, overlays, shell Module Federation, package dependencies, generated contracts, ports, i18n, CSS isolation, and Effect clients.
    status: completed
  - id: document-human-workflow
    content: Rewrite public docs and generated READMEs around the human workflow: create a simple app, decide when a SuperApp workspace is warranted, add domains such as transportation, food-delivery, payments, or maps as MicroVerticals, and understand what the command changes.
    status: completed
  - id: remove-stale-reference-language
    content: Remove or quarantine stale Tractor/remotes/explore-decide-checkout/service-oriented language from public docs, generated templates, ADR indexes, and adoption material unless it is clearly labeled as historical evidence or an external demo repository.
    status: completed
  - id: validate-fresh-adoption-paths
    content: Validate the complete adoption paths from scratch: simple app create/build/check, SuperApp workspace create/check, add two or more business verticals/check, SSR/i18n/CSS/boundary debug behavior, and docs commands copy-pasted in a clean directory.
    status: completed
isProject: false
---

# ultramodern-growable-superapp-scaffold

## Execution Notes

The accepted direction is that UltraModern.js should be a strong SuperApp framework without forcing every new user to start with multiple fake MicroVerticals. The default path should be a simple production-ready UltraModern app: SSR, Tailwind v4, i18n, Effect BFF, quality gates, and deploy basics. SuperApp workspace mode remains first-class, but it must be explicit and should not require deleting placeholder verticals before a real product exists.

The add-vertical command is the growth path. A team building a Grab-like app should be able to start simple, then add real domains such as `transportation`, `food-delivery`, `payments`, and `maps`. The command should mutate the existing repository and wire the vertical into topology, ownership, shell Module Federation, local overlays, package dependencies, generated contracts, i18n, CSS isolation, and Effect BFF/client surfaces.

Key current drift to fix:

- Public UltraModern docs still describe Tractor and old `apps/remotes/remote-*` shapes.
- The single-app generated README still calls itself the Tractor reference SuperApp and documents `explore`, `decide`, and `checkout` verticals.
- The workspace README currently documents forced neutral verticals, which is still too opinionated for a clean SuperApp starter.
- CLI help mentions `--vertical`, but docs do not explain that it is an in-place repository mutation and what it wires.

## Constraints

- Do not reintroduce legacy `remote` terminology as the user-facing architecture; use `verticals`.
- Do not add separate generated service types. A MicroVertical owns UI/routes/components plus its Effect BFF/API by default.
- Do not hide demos in the framework repository as default scaffold output. If a Tractor-style demo is useful, keep it opt-in or publish it as a separate demo repository.
- Keep UltraModern close enough to the Modern.js mental model that normal app creation still feels like a framework starter, not a mandatory distributed system.
- Keep package publishing through GitHub Actions trusted publishing only.
- Any generated CSS should continue to use Tailwind v4 where possible, app-local prefixes, SSR-safe CSS, and no cross-vertical override assumptions.

## Operator Guidance

Start by making the command contract explicit before editing generators. The highest-risk choice is the SuperApp workspace shape: decide whether the explicit workspace starts shell-only or with one user-named starter vertical. After that, update the generator and tests together.

Validation should use fresh directories, not source-code string checks as proof. At minimum, run the generated validators, package build for `@modern-js/create`, and copy-paste docs commands in temporary directories. For the visual/runtime path, use browser-based validation for SSR/no-JS/i18n/CSS once implementation work starts.

When splitting into subagents, good lanes are CLI/generator implementation, documentation rewrite, stale-reference audit, and fresh-scaffold validation. The validation lane depends on the generator/docs lanes being ready enough to exercise.
