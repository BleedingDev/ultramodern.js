---
name: cc-contract
overview: "Freeze canonical configuration ownership and the behavior-preservation contract before parallel writes."
todos:
  - id: cc-contract-field-ownership
    content: "Inventory every retired metadata field and freeze its canonical source, derivation, or deletion."
    status: pending
  - id: cc-contract-shared-contract
    content: "Define the internal workspace input contract and hand off non-overlapping file ownership."
    status: pending
isProject: false
---

# cc-contract

## Execution Notes

Own the integration checkout and the initial shared interface. Read README.md in this plan directory first. Baseline Modern.js at a0ae288f342aa1394a87298cda398eb63b19855a and OntOS at e1690997ba67ba2e19ee0efc3cf2b51e6c65ea62, then record actual execution bases if they advanced. Preserve unrelated work. Resolve OntOS PR #886 state before selecting its base; do not reapply its commits if already merged.

Inventory leaf fields, not just the 13 root keys, from OntOS and a freshly generated shell/UI/API-only workspace. For each field record its current readers, actual nondefault values, final owner, and derivation. Put the small disposition table in this plan's execution evidence, not in a new runtime manifest. Resolve any unique application choice before deleting its only storage location. No unexplained field may fall into a generic extra/config bag.

Canonical decisions are fixed:
- A named UltraModern catalog in pnpm-workspace.yaml owns requested framework versions; package.json uses native catalog references and owns other dependency requests. The lockfile owns resolved versions. The installed framework owns release expectations. No application release-cohort.json.
- package.json packageManager/engines and the existing mise configuration own toolchain settings. Validation may compare them, never add another stored copy.
- topology/reference-topology.json owns logical app membership, supported surfaces, and composition relationships. topology/ownership.json retains ownership policy; do not duplicate package identity that can be read from package.json. Extend these existing contracts only for indispensable logical choices absent everywhere else.
- modern.config.ts and existing native framework plugin options own bundler, runtime, bridge, security, and deployment settings. Actual emitted deployment configs/artifacts serve verification of build results. Do not execute arbitrary app configuration merely to discover a workspace or install dependencies.
- existing delivery-unit records own logical unit identity. Build output owns the actual source revision and artifact hashes. Preserve ADR-0019 unified delivery and independently deployed units.
- installed framework policy owns defaults, command definitions, framework-required fixes, and generated-template behavior. CLI flags own one invocation. Existing skills lockfiles own skill pins.
- .modernjs/ultramodern.json is deleted, not renamed, split into replacement registries, or serialized under a package.json mega-object.

Define the minimal typed input consumed by the existing readUltramodernWorkspaceInputs/normalization path. Preserve one internal resolved representation when commands need it; remove the public compact format and source-dispatch discriminator. Existing commands should call the owning reader directly. Do not introduce a public adapter or generic configuration framework.

Add a read-mode column to the leaf disposition table: declarative, build-time, or emitted-artifact. Name the check that consumes each field and when it runs. Before releasing cc-metadata, resolve every lightweight validate/add/MF-types input without executing app configuration. Logical composition belongs in existing topology; runtime-only option checks run through native config loading at build time and emitted-output verification. Do not move arbitrary plugin options into topology merely to preserve a static reader. Preserve each check at the correct phase. Existing topology/local-overlays/development.json owns local port assignments, as createDevelopmentOverlay already models; generated config consumes that choice rather than storing an independent editable port. Collision preflight uses those declarative assignments.

Enumerate retired-path and compact-type consumers across src, templates and release scripts, including indirect normalized readers. Assign every file to one writer before handoff. Generated workspaces remain pnpm workspaces: qualify the pinned framework/Tractor pnpm 11.24.0 and OntOS pnpm 12.4.2, rechecking current pins at execution. npm checks cover published-package install/peer compatibility, not an additional npm-based workspace generator. No catalog compatibility layer is required.

## Constraints

Write only the existing config types/interface declarations under packages/toolkit/ultramodern-create/src/ultramodern-tooling/config/ and the source-owner decision in this plan. During this lane metadata-reader and generator writers remain blocked. Runtime, analyzer and corrected-dependency lanes use existing independent contracts and may run immediately. Transfer these files explicitly to cc-metadata after the interface commit. No production implementation, publishing, or consumer edits in this lane.

## Operator Guidance

Root-owned. Stop when every leaf has a destination or deletion reason, the internal contract is concrete, and each downstream lane has a fixed file allowlist. Unknown fields require local evidence resolution here, not speculation delegated to five workers. Check CONTEXT.md and docs/super-app-rfc-adr/ADR-0019-federated-loading-unified-delivery.md. Reconcile the generic external-compatibility language with the user's explicit no-compatibility scope: current features survive; old framework config formats do not. Record baseline first-party LOC, generated consumer LOC, copied metadata bytes, wrapper count, patch count and upgrade touch points once.
