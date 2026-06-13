---
name: open-beads-fast-03-create-command-contract
overview: "Finish modernjs-tnpa by making the published create command invocation contract explicit and covered by a clean-cache smoke."
todos:
  - id: reproduce-pnpm-dlx-behavior
    content: "Reproduce pnpm 11 scoped-package dlx behavior in a clean temporary cache without running pnpm install inside fixtures."
    status: completed
  - id: choose-supported-command
    content: "Decide the supported command form, preferring an explicit package invocation such as pnpm dlx --package @bleedingdev/modern-js-create@latest modern-js-create myapp if bare scoped dlx remains ambiguous."
    status: completed
  - id: update-docs-and-smoke
    content: "Update docs, create publish proof scripts, and smoke coverage to assert the exact supported command with clean-cache behavior."
    status: completed
  - id: verify-publish-command-contract
    content: "Run focused published-create proof tests and any affected script tests to prove npx and pnpm command forms behave as documented."
    status: completed
  - id: close-tnpa
    content: "Update and close modernjs-tnpa with the chosen command contract, reproduction notes, and validation output."
    status: completed
isProject: false
---

# open-beads-fast-03-create-command-contract

## Execution Notes

This is a user-facing install-path contract, not a framework runtime bug unless reproduction proves otherwise. The goal is to stop ambiguous `pnpm dlx` behavior from surprising users after publish.

2026-06-13: pnpm 11.5.3 clean-cache reproduction with temporary `XDG_CACHE_HOME`, npm cache, and pnpm store showed `pnpm dlx @bleedingdev/modern-js-create --version` succeeds and resolves `@bleedingdev/modern-js-create@3.2.0-ultramodern.120`; bare `pnpm dlx modern-js-create --version` 404s because no unscoped package exists. The supported command contract is `pnpm dlx @bleedingdev/modern-js-create <target>`.

2026-06-13: Added command-contract-only published-create proof mode and docs coverage. Focused proof passed with `node scripts/ultramodern-production-readiness/run-published-create-proof.mjs --project-name command-contract-proof --vertical-count 0 --command-contract-only --out .modern/production-readiness/published-create-command-contract-proof.json`.

2026-06-13: Clean-cache npx comparison passed with `npx --yes @bleedingdev/modern-js-create --version`, resolving `3.2.0-ultramodern.120`.

2026-06-13: Full zero-vertical proof without `--command-contract-only` reached clean-cache create, cohort assertion, and install, then failed at generated `pnpm check` because `packages/shared-contracts/src/index.ts` violates Oxlint `typescript(consistent-type-definitions)`. This is outside this command-contract lane.

Primary Bead: `modernjs-tnpa`. Likely files live under publish/create proof scripts, create docs, and package command metadata.

## Constraints

Do not run `pnpm install` or `pnpm exec` inside fixture directories. Use clean temporary caches/workspaces for command reproduction. Keep command docs honest; do not document a command that only works because of local link cache state.

## Operator Guidance

Assign one subagent to this lane. It is independent and can start immediately with the route metadata, MF fixture, proof-helper, resilience, and Tractor lanes.
