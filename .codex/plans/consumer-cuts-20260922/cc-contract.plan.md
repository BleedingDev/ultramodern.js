---
name: cc-contract
overview: "Freeze canonical configuration ownership and the behavior-preservation contract before parallel writes."
todos:
  - id: cc-contract-field-ownership
    content: "Inventory every retired metadata field and freeze its canonical source, derivation, or deletion."
    status: completed
  - id: cc-contract-shared-contract
    content: "Define the internal workspace input contract and hand off non-overlapping file ownership."
    status: completed
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

## Execution evidence — 2026-09-23

Execution base: `4031db83e38aae6f05c380c4343e9df5f923aeb9`. OntOS PR #886 remains open at `e1690997ba67ba2e19ee0efc3cf2b51e6c65ea62`; acceptance must include it. Fresh shell, UI-only and API-only fixtures plus OntOS were inspected at leaf level: 268 distinct paths (array indices normalized). The following prefix disposition covers every leaf; nested copies inherit their owner's disposition, not another serialization.

| Retired fields | Canonical owner / deletion | Read mode and check |
| --- | --- | --- |
| schemaVersion, profile, generator.* | Delete consumer copies; installed framework owns format/defaults | Declarative reader validates topology's own schema |
| workspace.packageScope | Root package.json name | Declarative add/validate |
| workspace.packageManager.*, workspace.node.* | packageManager/engines and mise | Declarative toolchain check |
| packageSource.* | Named pnpm catalog requests; lockfile resolves; native registry config | Declarative add and installed-manifest validation |
| features.tailwind | App's actual Tailwind dependencies/native plugin configuration | Declarative generation choice; build checks plugin |
| topology.source | Existing fixed reference topology | Declarative discovery |
| topology.apps[].id/kind/path/domain/displayName/surfaceProfile/deliveryUnitKind | Existing topology app records; add explicit primary shell path | Declarative identity/surface checks |
| topology.apps[].package/packageSuffix | App package.json; topology identity references must agree | Declarative identity check |
| topology.apps[].port/portEnv | Overlay ports; topology may retain named environment interface | Declarative collision check; native config consumes overlay port |
| topology.apps[].moduleFederation.* | Topology composition; native MF config owns exposes/shared/dts; overlay owns local URLs | Declarative composition and AST expose discovery; build/runtime verifies MF |
| topology.apps[].deliveryUnit.* | Existing topology delivery record; package manifest owns version; output owns actual revision/hash | Declarative identity agreement; emitted artifact binding |
| topology.apps[].api.* | Existing topology API declaration and app API/native BFF config | Declarative API membership; build/API proof |
| topology.apps[].backendFederation.* and backendFederation.apps[] | Existing topology declaration/overlay endpoints; installed runtime derives protocol defaults | Declarative discovery; runtime envelope/artifact identity |
| topology.apps[].deploy.cloudflare.* | Native plugin options and existing topology proof routes; deployment output for actual bindings/security | Build configuration plus emitted worker/security proof; never execute config during discovery |
| deploy.worker.* | Native Cloudflare plugin options/emitted deployment config | Build and emitted-artifact checks |
| moduleFederation.apps[] | Delete duplicate index; derive from topology and native MF config | Declarative MF tooling |
| bridge.workspacePackages[].pattern/packageNames, bridge.dependencies | pnpm workspace patterns and app package.json workspace deps | Declarative link discovery; add retains external workspace deps |
| bridge.gates[].name/command/cwd | Existing root scripts including bridge:* and bridge:check | Existing command execution; preserve script text |
| bridge.enabled/parentRoot/lockfilePolicy/reactSingletons/testAliases | Delete inert metadata: no operational readers beyond validation. Actual singleton/test settings remain native MF/test configuration | Native build/test; no new bridge topology object |
| agentSkills.* | Installed command defaults and existing skills lock | Skills command/lock verification |
| tooling.command/wrappers.* | Installed CLI and ordinary package scripts | Direct command exit/argument acceptance |
| optional shells[] | Existing reference topology.shells[]; overlay ports; app manifests | Declarative additional-shell identity/composition |

Observed nondefaults preserved: OntOS shell port 3020, party-registry port 4102, API ports 4101/4103, `./PageContacts` expose, party-only primary composition, API-only profiles, app-authored `ontosModuleManifests`, proof route `/en/contacts`, delivery-unit markers and custom backend endpoints. Do not replace authored URLs with generated defaults. Security/CSP is checked from real build configuration/output, not from a duplicate compact snapshot.

Concrete internal input: `{topology, overlay}`. `readUltramodernWorkspaceInputs(root)` resolves actual app manifests and native catalog and returns `{raw, config, apps, primaryShell, verticals, additionalShells}`. `config` contains only resolved package scope/source, Tailwind presence, native inherited workspace dependencies and app descriptors; no compact format, source discriminator or replacement persistent registry. Existing bridge input remains a one-time generation option; operations retain native links/scripts/patterns.

Ownership adjustment: root owns canonical config readers and generator. Sol Medium `cc_validation` owns validation/cohort modules and workspace-validation-contract; `cc_analyzer` owns focused reader acceptance after completing analyzer work. Runtime worker owns native envelope and then only proof-node-backend-federation integration. Dependency worker owns sidecar artifacts/recipes; root owns central manifests, lock, policy and release integration. Reader tests gate generator handoff; these are dependency-ordered changes within one unreleased implementation.

Baseline physical source LOC at execution base (Git objects, src only; .ts/.tsx/.mts/.js/.jsx/.mjs): ultramodern-create 24,517 in 121 files, app-tools-extensions 11,839 in 54, code-tools 4,147 in 20; total 40,503 in 195. Generated fixture source/script LOC excluding skills caches, patches, dependencies and builds: shell 1,737; UI-only 2,737; API-only 2,565. Pure forwarding wrappers: 9/337 LOC, 11/411 LOC, 13/485 LOC respectively. Retired compact JSON: 7,311 / 12,463 / 19,349 bytes. Source fixtures have no release cohort copy. Each has 7 consumer patch files. Framework dependency sites: 27/37/41 across 3/4/4 manifests, all workspace:* in source fixtures (not literal upgrade edits). Repeat these same scopes after generation; report newly vendored third-party bytes separately from authored code.
