---
name: TanStack Upstream Review Branch
overview: Prepare and force-push the polished TanStack Router plugin work to the existing PR #8317 branch for ByteDance review, keeping the branch rebased onto upstream main and limited to necessary mergeable changes.
todos:
  - id: tpreview-01
    content: Audit the final TanStack hook/plugin/SSR branch diff against upstream main and remove unrelated Micro Vertical, Effect, local fixture, or planning artifacts that are not required for upstream review.
    status: pending
  - id: tpreview-02
    content: Rebase or rebuild the review branch on the latest upstream origin/main and ensure it contains only the generic core hooks, @modern-js/plugin-tanstack package, docs/tests, and minimal verified fixtures.
    status: pending
  - id: tpreview-03
    content: Run the upstream-facing verification suite and prepare a concise PR update explaining the hook architecture, plugin extraction, SSR requirements, and remaining explicit limitations.
    status: pending
  - id: tpreview-04
    content: Force-push the polished branch to bleedingdev/feat/tanstack-router-tailwind-first-class for PR #8317 review after final confirmation that the diff is minimal and clean.
    status: pending
isProject: false
---

# TanStack Upstream Review Branch

## Execution Notes

This plan is intentionally last. It should run only after the core hooks, `@modern-js/plugin-tanstack`, and SSR/MF contract work are complete enough for upstream review.

The review branch is the existing PR #8317 branch: `bleedingdev/feat/tanstack-router-tailwind-first-class`. The target base is upstream `origin/main` from `web-infra-dev/modern.js`.

The goal is not to push the whole Micro Verticals fork upstream. The goal is a polished, mergeable Modern.js contribution that matches ByteDance feedback: TanStack as a plugin, generic core hooks, and only necessary tests/docs.

## Constraints

Do not push to upstream `origin`.

Do not include `presetUltramodern`, Effect-first fork policy, Micro Vertical topology, local plan files, Beads state, or internal reports in the upstream PR branch unless explicitly needed for the PR.

Do not force-push until the branch has been audited against `origin/main` and verification has run.

Keep the final PR description focused on architecture, hook surfaces, plugin package, SSR support, and verification.

## Operator Guidance

Primary commands should be non-interactive: `git fetch origin main`, create or update a local work branch from `origin/main`, cherry-pick or rebuild only necessary commits, compare with `git diff --stat origin/main...HEAD`, run focused tests, then `git push --force-with-lease bleedingdev HEAD:feat/tanstack-router-tailwind-first-class`.

If the branch contains any fork-only Micro Verticals scope, stop and split it out before pushing.
