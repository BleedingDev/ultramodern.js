---
name: patch-sidecar-provenance
overview: "Replace manually synchronized patch distribution and environment-dependent sidecar verification with pinned reproducible inputs."
todos:
  - id: patch-sidecar-provenance-patches
    content: "Define one canonical patch inventory with package/version/integrity and repo/template applicability; derive packaged generator assets and documentation/config fragments."
    status: completed
  - id: patch-sidecar-provenance-sidecars
    content: "Record pinned upstream artifact identity, licenses and allowed transformations for each sidecar; verify deterministic staging without depending on incidental pnpm-store presence."
    status: completed
  - id: patch-sidecar-provenance-verify
    content: "Prove packed generator self-containment and sidecar behavioral/artifact contracts, then remove duplicate authored copies, filename-prefix classification and skip-on-missing verification."
    status: completed
isProject: false
---

# patch-sidecar-provenance

## Execution Notes

Own patches inventory/documentation, generator shared-patches.ts and packaged patch assets, sidecar provenance/verification scripts. Do not hand-edit generated dist or lockfiles. Use reproducible tooling to update staged artifacts; root owns lockfile regeneration and shared workspace config integration. Keep existing vendored artifacts if required for offline packaging. Do not assert current upstream replacements exist without research.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.13` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. All implementation is pending.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve packed generator self-containment and current patch/cohort parity checks; patch-sync.test.ts was deleted. Preserve parser time bounds across entrypoints/module formats, valid images, real sharpening behavior, exports/CLI and licenses. rsbuild-image-core 0.1.1 intentionally raises sharp peer floor to >=0.35.4; do not blindly restore upstream manifest peers. Verify pinned artifact bytes independent of local pnpm installation. Vendor bytes are not bespoke runtime deletion savings. No sidecar/security patch retirement without a proved replacement.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.

## Implementation evidence

Canonical patch inventory now projects repository config, packaged assets, workspace patch policy and documentation without prefix classification. The pinned sidecar recipes reconstruct all three distributions independently of pnpm store state; identity, manifest contracts, complete dist/bin bytes and MIT licenses match. Sharp >=0.35.4 remains explicit. Vendor dist is unchanged. Core provenance/manifest duplication and skip paths are removed; the sharpen fixture is generated deterministically rather than borrowed from a deleted integration fixture.

Focused checks passed: generator version pins 4/4; missing/tampered input and changed runtime artifact rejection 2/2; image parser bounds/valid images 76/76; actual Sharp/libvips 7/7; core exports/browser/pack checks 12/12; all three online and explicit offline recipe reconstructions; canonical patch projection check; scoped Biome. After the coordinated rebuild, npm-packed generator extraction loaded both esm-node and CommonJS inventory/shared projections with no src tree or source links; all 7 packaged patch bytes matched their canonical SHA-256, including the conditional Drizzle patch. Inventory is a declarative TypeScript module so normal Rslib emits both formats without copy hooks.

Authored production/script change is -82 lines excluding new adversarial tests, declarative inventories, docs and vendor patch bytes. Template assets remain generated committed copies for offline source packaging; they are not independent authoring inputs.
