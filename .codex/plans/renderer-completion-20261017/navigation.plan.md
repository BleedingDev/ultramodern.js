---
name: Complete localized native navigation
overview: Finish mask, search and document navigation semantics in both native adapters using the current authenticated router cohort.
todos:
  - id: modernjs-dnpv3.58.12.1
    content: Qualify current router-core patches and both installed native localized bindings
    status: pending
isProject: false
---

# Complete localized native navigation

## Execution notes

Own Solid router-binding/link.tsx, Octane localized native router bindings, their tests, the two preserved router-core patches and scripts/ultramodern-supply/router-core-mask.test.mjs. Coordinate asset-consumers/sidecar metadata and all package requests with cohort integrator. Basic LocalizedLink already shipped; preserve that behavior while delivering the unqualified extensions.

Current Octane uses router-core1.171.34, while the old asset recipe references1.171.15. Inspect the actual installed Solid and Octane closures. Keep only patches needed by supported exact consumers. The .34 implementation already chooses maskedLocation for document reload, so do not duplicate the .15 correction there. Test search inheritance, native validation/default middleware exactly once, params, hash, basepath, relative destinations, native preload, active state and link options. Prove full-document masked navigation uses its advertised localized href and preserves expected history. Cover blocker rejection/acceptance, replace and explicit blocker bypass with native router primitives.

Use authenticated official package archives as negative controls for genuine defects. For reviewed inline dependency patches, include source, real emitted CJS/ESM, public declarations and correct source maps. Publish or stage through the existing authenticated sidecar process; a root-only patchedDependencies entry cannot prove installed generated consumers receive the fix. Prefer owning upstream fixes where suitable and keep a patch removal condition tied to a passing released version. Never add custom click interception, hidden URL transport or app-local router wrappers.

## Success criteria

Runtime and declaration tests exercise exact supported package versions. Both generated Solid and Octane consumers installed from normal lane-local packs pass real browser SPA, preload, document navigation and history/blocker checks. The tested candidate asset profile and actual package bytes agree. Cohort later publishes accepted assets; acceptance repeats these checks against the final immutable published dependencies. Old unused .15 recipes/patches are removed only after proving no supported consumer requires them. Evidence determines which preserved changes are necessary; do not preserve redundant patch size for its own sake.

## Constraints

Read `README.md` in this plan directory before execution. Beads is authoritative; update only the named task and its actual completion evidence. This plan's pending todo means its new completion pass has not started, regardless of historical parent issue status. Preserve snapshot ca61247 and all other sessions' work. Do not add app shims, manual navigation handlers, suppressed checks, generated-output edits or weaker acceptance assertions. New Modern behavior belongs in fork-owned packages; upstream-owned non-shrink changes require reviewed source and the same-PR divergence ledger and boundary gate. Never edit installed dependencies to stand in for authored source.

## Operator guidance

Work only in the assigned named branch and file ownership. Read current checks/reviews once, deduplicate active validation, then build the next consumer. Use normal hooks, focused checks and exact artifacts. A failed real consumer keeps this task open with a concrete next action. Register operation-owned outputs, use the external pnpm store and clone-or-copy, and clean only this operation's authorized resources in finally/signal paths. Do not delete other sessions' dependencies.
