---
name: Dependency refresh build and federation
overview: Upgrade the Rstack and Module Federation dependency graph and reconstruct corrected artifacts while retiring fixes absorbed upstream.
todos:
  - id: update-rstack-cohort
    content: Upgrade Rsbuild Rspack Rslib Rspress Rstest and compatible plugins with working compiler adapter and declaration output.
    status: pending
  - id: update-federation-cohort
    content: Move Module Federation packages to the frozen compatible versions and prove CSR SSR DTS lazy-loading and manifest behavior.
    status: pending
  - id: reconcile-canonical-corrections
    content: Compare exact upstream artifacts, retire absorbed fixes, refresh remaining canonical patches and sidecar recipes, and verify deterministic reconstruction.
    status: pending
isProject: false
---

# Dependency refresh build and federation

## Execution Notes

Beads `modernjs-h8xqq.4`. Depends on baseline, tooling and Effect's correction retirement proof. Targets include Rsbuild 2.2.11, Rspack 2.2.8, Rslib 1.0.3, Rspress 2.0.23, Rstest 0.12.3 and federation 2.9.2 with node 2.7.52. Match plugin peers and SWC ABI rather than giving every package the same version string. Own compiler/federation package code/configs, Rstest adapter, `scripts/rslib`, supply recipes and canonical patches. Docs content and non-build runtime fixes belong to runtime lane. Generator projections belong to generator lane.

The runtime-core ResourceLoadContext patch is already absorbed by 2.9.2. Inspect the other five federation patches individually, covering declarations, native compiler execution, lazy DTS loading, CSS ownership, SSR recovery and chunk splitting. Consume the Effect lane's retirement proof before removing its canonical patch/recipe. Preserve image and Zod hardening. Record exact tarball URL, SHA-512, patch SHA-256, license and dependency aliases for retained corrections.

## Constraints

Use existing fork extension packages for additive changes. Reviewed upstream-line edits need the same-PR ledger and canonical divergence measurement. Never weaken patch verification or supply integrity. Generated applications carry no local framework patches. No direct edit of compiled vendor artifacts; refresh through producers. Keep current React/RSC supported release identities rather than accidentally published numerically higher versions.

## Operator Guidance

Run affected package builds and compiler/federation tests. Exercise root Rstest and the Modern browser adapter before selecting new pools. Verify transform imports, loader target behavior, explicit stats fields, runtime-tools peer placement, CSS modules, RSC output, lazy compilation and declaration exports. Run `pnpm test:build-consumers`, relevant MF integration suites and `pnpm validate:mf-contracts`.

After canonical changes run `node scripts/ultramodern-supply/sync-patches.mjs --write`, then default sync verification and `verify-sidecars.mjs`. Supply mutation and installs are serialized with the coordinator. If independent work is later delegated, the supply files remain exclusively owned by this lane and semantic corrections must land before the generator join.
