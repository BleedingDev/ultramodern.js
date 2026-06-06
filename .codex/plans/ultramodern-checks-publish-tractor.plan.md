---
name: ultramodern-checks-publish-tractor
overview: Publish the shared UltraModern checks package in the BleedingDev cohort, migrate Tractor to consume it, and prove the live deployment still works.
todos:
  - id: include-checks-in-publish-cohort
    content: Add @modern-js/ultramodern-checks to the Modern workspace publish cohort with the @bleedingdev/modern-js-ultramodern-checks alias and a changeset.
    status: completed
  - id: publish-and-verify-latest
    content: Publish the next BleedingDev UltraModern cohort, verify npm latest/version/frameworkVersion, and verify @bleedingdev/modern-js-ultramodern-checks exists for that exact cohort.
    status: pending
  - id: migrate-tractor-dependency
    content: Update Tractor package-source metadata, root dependency, wrapper script, validator, package manifests, and lockfile to consume @modern-js/ultramodern-checks from the published alias.
    status: pending
  - id: remove-copied-checkers
    content: Remove copied/generated regex checker logic from Tractor once the shared dependency is wired, keeping only thin wrapper scripts if the public script contract requires them.
    status: pending
  - id: validate-tractor
    content: Run Tractor install, ultramodern:i18n-boundaries, ultramodern:check, pnpm check, build, and cloudflare:build with the pinned repo pnpm.
    status: pending
  - id: deploy-and-prove-tractor
    content: Deploy Tractor Workers, prove public CSS/style output and package cohort, capture visual/browser evidence, then commit and push Tractor.
    status: pending
  - id: close-beads
    content: Close modernjs-0rlh and modernjs-9yiv with npm, gate, deploy, and Tractor commit evidence; keep Beads synced with bd dolt push.
    status: pending
isProject: false
---

# ultramodern-checks-publish-tractor

## Execution Notes

This lane handles `modernjs-0rlh` and unblocks/closes `modernjs-9yiv`. It must run after the Oxlint AST implementation, because publishing the alias before the shared checker is source-backed and semantically correct would lock Tractor onto the wrong behavior.

The remembered release rule applies here: every BleedingDev Modern publish must update Tractor to the new latest cohort, rebuild it, deploy/prove Workers when applicable, visually check the live app, then commit and push Tractor before closing the Modern bead.

## Constraints

Do not publish to upstream `origin`; use the BleedingDev fork/remotes. Do not add Tractor app-level shims, local file/link dependencies, copied checker implementations, custom CSS injection, navigation wrappers, or local suppressions to make framework behavior look fixed.

## Operator Guidance

Use `/Users/satan/.proto/shims` first in `PATH` for Tractor commands so hooks and gates use pinned `pnpm 11.5.0`. Public proof should include npm version checks, generated metadata scans, Cloudflare deploy output, CSS link proof for `/en` and a product route, and a screenshot or browser verification.
