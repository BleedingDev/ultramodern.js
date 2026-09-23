---
name: cc-tractor
overview: "Validate the same candidate in Tractor without preserving generated framework metadata or changing its visible UI."
todos:
  - id: cc-tractor-tractor-native-adoption
    content: "Update the persistent Tractor acceptance app to canonical configuration and patch-free framework dependencies."
    status: in_progress
  - id: cc-tractor-tractor-acceptance
    content: "Run the existing published-consumer-equivalent acceptance and verify the visible Tractor UI."
    status: pending
isProject: false
---

# cc-tractor

## Execution Notes

Inspect /Users/satan/side/experiments/tractor-store-vertical if it exists, as required by Modern.js AGENTS.md. Preserve its UI and user changes. Use an isolated owned checkout for validation and integrate only the reviewed task changes back to the required persistent acceptance target. Also reconcile the existing published acceptance repository BleedingDev/tractor-store-vertical-demo, whose last known accepted commit is 659aa49a524d2d3769cf2b733f80827c7559946c; verify the current target before work. Do not assume the historical /tmp clone is durable or current.

Apply the exact same candidate used by OntOS. Delete retired JSON metadata and framework-required patch registrations/files; preserve app-authored topology, localization, styling and operational choices in canonical sources. Replace only pass-through framework script launchers with direct CLI calls. Use the consumer's actual pinned toolchain; do not force OntOS's pnpm version onto Tractor. Keep framework defects in the owning source lane.

Run the existing Tractor downstream acceptance matrix and UI/runtime checks. Retain coverage of SSR, navigation/localization, MF loading/recovery, BFF behavior, Node/Cloudflare and applicable degraded states. Do not invent a new demo or replace its visual design to make validation easier.

Fresh candidate or published installs use command-scoped exact package@version release-age exceptions derived from the authenticated bundle, through the existing acceptance helpers. Qualify this invocation with the consumer's pinned pnpm. Commit only canonical manifests/catalog and the package-manager-generated lockfile, with no localhost registry configuration or exception list. Check that the committed lock contains no temporary registry/tarball paths. Prove a normal frozen install without transient exceptions after the release has aged; if a fresh frozen install still enforces age, wait for that policy rather than weaken it.

## Constraints

One writer owns only isolated Tractor checkout(s) and the reviewed updates to the explicit persistent demo target. No OntOS, Modern.js source/workflow edits, unrelated demo work, live service deployment, or user stashes. Root updates Modern.js tractor_ref only after the downstream commit actually exists.

## Operator Guidance

Depends on cc-package-proof; parallel with cc-ontos. Stop with validated adaptation commit(s) pushed to the established demo remote, exact consumer identity, existing acceptance results and concise UI evidence. Root must be able to fetch the immutable SHA before freezing both workflow pins. cc-release reruns published-package adoption after publication and owns any workflow pin update. If the required persistent directory is absent, record absence and still validate the established demo repository; do not manufacture that path.
