---
name: cc-generator
overview: "Generate only canonical app configuration and direct commands; retire metadata emitters and update-time copy machinery."
todos:
  - id: cc-generator-canonical-generation
    content: "Rewrite workspace and add operations to maintain each application choice in exactly one canonical source."
    status: pending
  - id: cc-generator-direct-tooling
    content: "Generate direct installed CLI commands and centralized dependency declarations; remove retired metadata and redundant wrappers."
    status: pending
isProject: false
---

# cc-generator

## Execution Notes

Start only after cc-metadata's reader contract is stable. Change generation, add-shell, add-vertical, delivery-unit synchronization and preview/apply planning together so none emits, copies or expects the retired files. Use the existing atomic operation pipeline; do not introduce migrations, old-format readers, dual writes or a new upgrade engine. Preserve idempotence, no-change previews and preflight failure before mutation. Files that are required build artifacts may still be generated from canonical source, but are not editable authorities.

Remove framework-version duplication in generated package manifests with the package manager's native catalog facilities where supported by the declared package-manager contract. Prefer named UltraModern catalog entries and ordinary catalog references. Keep explicitly needed direct dependencies; do not hide them behind an umbrella package or wildcard alias. Framework upgrade edits belong in one native catalog location plus its generated lockfile, with no separate generator-version/cohort/config update. Registry authentication stays in native package-manager configuration; do not store credentials. Preserve minimum-release-age and trust policy. Normal upgrades use sufficiently aged releases. Immediate release acceptance supplies command-scoped exact exceptions from verified producer metadata through the existing harness; do not commit a second per-release version list in every application. No wildcard exclusions or blanket policy weakening.

Replace generated pass-through scripts with package scripts that invoke the installed UltraModern CLI directly and rely on standard exit/signal behavior. Eliminate the copied tooling command/wrapper registry. Keep application-authored orchestration only where it implements real app behavior. Move any framework-owned wrapper behavior needed for cwd, arguments, Windows execution, cancellation or errors into its existing CLI implementation, not another adapter. Do not regenerate business source or erase application customizations.

Delete obsolete compact emitters, format parsers, copyCreateReleaseCohort callers, duplicated metadata snapshots, and docs/tests preserving those implementation details. Leave current command help and behavior-level tests.

After the metadata handoff, own direct-command behavior in src/ultramodern-tooling/commands.ts, commands/**, context.ts and options.ts, and the tooling dispatch call site in src/index.ts. Keep this transfer sequential. Prove local cwd/arguments/status/cancellation behavior here; actual Windows execution belongs to cc-package-proof and the existing CI runner. Source reader and generator commits are dependency-ordered work in progress, not separately releasable framework versions.

## Constraints

Own packages/toolkit/ultramodern-create/src/ultramodern-workspace/{write-workspace,generation-result,descriptors,package-json,workspace-script-plan,workspace-validation-contract,tooling-command-catalog,delivery-unit-sync,add-shell}.ts, add-vertical/**, producer-side metadata builders found by the bounded inventory, and dedicated generation tests. No config reader/validation writes after handoff without coordination. Integration alone owns policy.ts, patch-inventory.ts, template patch deletion and shared package manifests. Do not edit templates/workspace-scripts/proof-node-backend-federation.mjs; hand direct-command/template deletions there to integration.

## Operator Guidance

Root-owned successor to cc-metadata. Verify fresh shell/UI/API-only workspaces, a second shell, add-vertical twice, and nondefault security/deployment settings. The generated outputs must contain neither retired JSON file and must execute with no pass-through script dependency. Verify catalog support with the actual supported pnpm versions before adopting syntax. Hand the Windows argument/path cases to cc-package-proof for execution through existing platform acceptance. Stop when generators write only the agreed sources and produce a deletion list for integration.
