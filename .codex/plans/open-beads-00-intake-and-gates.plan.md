---
name: Open Beads 00 Intake And Gates
overview: Reconfirm the current Beads state, repo baseline, external blockers, and execution inputs before finishing the remaining open/in-progress work.
todos:
  - id: refresh-beads-state
    content: "Run bd list/show for modernjs-fjk5, modernjs-hjgv, and modernjs-8qw9; record which work is actionable, blocked, or dependent on live credentials/platform state."
    status: completed
  - id: verify-clean-baseline
    content: "Verify the current branch, pushed commit state, and working tree before starting new edits so follow-up work does not mix with unrelated changes."
    status: completed
  - id: verify-mf-upstream-release
    content: "Check module-federation/core PR 4755 and current npm releases for @module-federation/manifest, @module-federation/rspack, and @module-federation/modern-js-v3; decide whether modernjs-8qw9 is now actionable or still externally blocked."
    status: completed
  - id: verify-zephyr-live-inputs
    content: "Confirm local Zephyr auth/token state and identify the generated workspace, app names, environment selector, and evidence output paths for the live v1/v2 full-stack switching proof."
    status: completed
  - id: lock-execution-constraints
    content: "Write the execution constraints into the operator log: no source-content tests, mandatory DTS, mandatory i18n, one-package micro-vertical FE+SSR+BFF ownership, no corepack, and push-to-bleedingdev completion."
    status: completed
isProject: true
---

# Open Beads 00 Intake And Gates

## Execution Notes

Source beads:

- `modernjs-fjk5`: ready P1 cleanup of remaining UltraModern source-content generator assertions.
- `modernjs-hjgv`: P1 live full-stack vertical version switching proof on Zephyr, with later Zerops path.
- `modernjs-8qw9`: P3 removal of Module Federation local patches after upstream release.

This plan is the execution gate. It should finish quickly and should not make production code changes except for a small operator log if needed.

## Constraints

Do not assume upstream Module Federation state from prior sessions. Verify it against GitHub/npm before deciding whether `modernjs-8qw9` can close.

Do not start live Zephyr mutation until the local auth/environment target and evidence paths are known.

Do not create new source-content tests or rely on source-string assertions as proof.

## Operator Guidance

If `modernjs-8qw9` remains blocked by upstream, update that bead with fresh evidence and do not let it block the actionable P1 work. If it is actionable, execute plan 03.

If Zephyr auth is missing, use the Zephyr flow and let the user authenticate; do not commit secrets.
