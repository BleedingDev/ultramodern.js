---
name: cc-ontos
overview: "Adopt the candidate in OntOS and delete framework-owned metadata, patches and redundant tooling while preserving business behavior."
todos:
  - id: cc-ontos-ontos-native-adoption
    content: "Update OntOS dependencies and canonical choices, then remove retired metadata and framework-required patches/wrappers."
    status: pending
  - id: cc-ontos-ontos-acceptance
    content: "Run full OntOS checks and runtime proofs against the candidate and deliver a focused committed downstream diff."
    status: pending
isProject: false
---

# cc-ontos

## Execution Notes

Resolve the canonical OntOS checkout through TraceDecay registry context before scanning. Known primary root is /Users/satan/workspace/techsio/projects/ontos/code/ontos; existing update worktree is /Users/satan/workspace/techsio/projects/ontos/worktrees/ultramodern-12. Use a new isolated worktree based on current main plus PR #886 only if still unmerged. Read root/app AGENTS.md and app/README.md. Never read .env. Run package commands in app with mise exec -- pnpm, preserving its pinned toolchain and unrelated dependencies.

Delete app/.modernjs/release-cohort.json and app/.modernjs/ultramodern.json after transferring any unique settings to cc-contract's canonical existing files. Remove all three @bleedingdev/modern-js-* consumer patches and their YAML registrations; remove framework-required MF/CSP/declaration patches only when the exact replacement package is installed. Preserve unrelated app-specific fixes. Use native catalog references and direct CLI commands where generated wrappers were only forwarding. OntOS's Effect wrapper layer must not be kept merely to preserve framework launch mechanics; retain app-owned work such as route metadata generation when it does actual app work. Do not add source shims, synthetic click/router handlers, config suppressions, or monkeypatches.

Retain exact i18n aliases and native generated router output from .12. Preserve API-only commerce/payment-term behavior, Party UI, shell behavior, strict diagnostics, DB schema/migrations, owner boundaries, and all security/provenance checks. Remove tooling tests that only demand obsolete file representations; keep/repoint tests proving business behavior or meaningful framework integration.

Fresh candidate or published installs use command-scoped exact package@version release-age exceptions derived from the authenticated bundle, through the existing acceptance helpers. Qualify this invocation with the consumer's pinned pnpm. Commit only canonical manifests/catalog and the package-manager-generated lockfile, with no localhost registry configuration or exception list. Check that the committed lock contains no temporary registry/tarball paths. Prove a normal frozen install without transient exceptions after the release has aged; if a fresh frozen install still enforces age, wait for that policy rather than weaken it.

## Constraints

One writer owns this OntOS worktree, including package manifests/lockfile, canonical config, removed metadata/patches and affected app tooling tests. No Modern.js, Tractor, primary checkout, closed issues, deployed services or secrets. Do not regenerate business source. Report framework defects to root; do not repair them in OntOS.

## Operator Guidance

Depends on cc-package-proof. Can run in parallel with cc-tractor. Validate frozen install, pnpm check, relevant existing scripts tests, complete unit/component tests, Node build/federation proof, Cloudflare build/workerd proof and existing service integration CI. Commit before provenance-sensitive builds; dirty checkouts intentionally produce workspace identity. No concurrent test fixtures during clean-commit envelope builds. Deliver commit, exact candidate identity, check results and deletion stats. Do not deploy or merge merely to run acceptance. Stop at a validated candidate adoption commit; cc-release coordinates final published package adoption.
