---
name: cc-dependencies
overview: "Deliver corrected third-party dependencies through published package dependencies instead of generated consumer patches."
todos:
  - id: cc-dependencies-dependency-closure
    content: "Map framework-required patch consumers and prepare corrected packages through the existing sidecar mechanism."
    status: pending
  - id: cc-dependencies-packed-dependency-proof
    content: "Verify direct and transitive package resolution, exports, peers, types and runtime identity without consumer patches."
    status: pending
isProject: false
---

# cc-dependencies

## Execution Notes

Use src/ultramodern-workspace/patch-inventory.ts as the inventory, not just the two patches changed in PR #886. Scope includes the four workspace-required Module Federation packages, msgpackr and zod, conditional generated-database declaration fixes, and the repository-only MF manifest/rspack fixes wherever they remain necessary in the shipped dependency closure. Preserve OntOS-only Effect, Better Auth, lint-plugin, NFT, and unrelated application patches unless separate evidence shows they are now redundant.

For each required correction prefer a released upstream package with verified equivalent behavior. Otherwise publish corrected fork-owned packages through the existing sidecar staging/publication mechanism. Plan against immutable exact source versions and preserve license/NOTICE/provenance. Do not fabricate unpublished versions or depend on a pending upstream PR. Sidecar names/versions must preserve bin names, package exports, type identities and supported peer constraints. Existing image sidecars are the reference mechanism; extend their concrete records rather than building a second generic patch service.

Redirect every actual dependency edge that needs the correction, including direct consumer MF entries and internal dependency/peer resolution. A patch in a published dependency's pnpm-workspace.yaml does not propagate. No install hooks, consumer overrides hiding bad dependency edges, postinstall mutation, vendored node_modules, or facade packages. Avoid duplicate React, Effect, federation-runtime or Zod identities. Keep development dependencies and published manifests aligned. Compare tarball behavior to the original patch semantics, including native compiler paths with spaces, ESM createRequire, manifest recovery, SSR/CSS behavior, portable declarations and CSP-safe decoding.

Report vendored third-party source separately from first-party implementation in cut statistics. Do not hide large source additions by only reporting deleted patch files.

## Constraints

Own new corrected sources under packages/sidecar/** and scripts/ultramodern-supply sidecar records; scripts/ultramodern-publish/lib/prepare-bleedingdev-packages/sidecars.mjs and sidecar-publication.mjs plus their dedicated tests. Root owns all existing package.json, pnpm files, changesets, patch-inventory.ts and central publication orchestration. Hand those exact manifest/pin/deletion changes to cc-integration. Do not edit generator policy or consumers concurrently. Respect Rule 5 for existing upstream-owned manifest edges.

## Operator Guidance

Independent at the initial frontier; run alongside cc-contract using existing source contracts. Route any proposed shared-config change to root. Stop after producing verified corrected tarballs and a complete dependency-edge change list. Test clean temporary consumer installs with no framework-required patchedDependencies and inspect actual resolved modules, not only manifest strings. Validate pnpm consumer behavior and the existing published-package npm checks. No registry publication in this lane. If an upstream version removes a patch, prove equivalent behavior before choosing it. A missing corrected transitive edge is a release blocker.
