---
name: Ultramodern Module Federation Patch Removal
overview: Remove local Module Federation manifest and rspack patches once upstream lazy DTS loading is merged and released in a consumable Module Federation version, while preserving mandatory DTS in Ultramodern generated workspaces.
todos:
  - id: poll-upstream-pr-and-release
    content: "Check module-federation/core PR 4755 state, merged_at, release tags, and NPM package versions to confirm the lazy DTS loading fix is available upstream."
    status: pending
  - id: compare-local-patches-to-upstream
    content: "Compare patches/@module-federation__manifest@2.5.0.patch and patches/@module-federation__rspack@2.5.0.patch against the released upstream package code to confirm both changes are redundant."
    status: pending
  - id: update-module-federation-dependencies
    content: "Update @module-federation packages to the first released version containing PR 4755 and regenerate the pnpm lockfile without the local patch hashes."
    status: pending
  - id: remove-patch-configuration
    content: "Remove patchedDependencies entries from pnpm-workspace.yaml and delete the obsolete patch files."
    status: pending
  - id: run-mf-dts-regression-gates
    content: "Run Module Federation DTS, Ultramodern generator, and generated workspace build/type assertion gates to prove mandatory DTS still works without local patches."
    status: pending
  - id: update-bead-and-doc-context
    content: "Close or update the upstream-patch Beads with the exact upstream release, commit or PR, package versions, and validation commands."
    status: pending
isProject: true
---

# Ultramodern Module Federation Patch Removal

## Execution Notes

Source Bead: `modernjs-8qw9`.

This plan is upstream-gated and can run independently from the full-stack vertical work. It should not block the one-package implementation unless the current patches break new builds. It exists because the repo currently carries local patches for Module Federation packages at version `2.5.0`.

Current repo evidence:

- `pnpm-workspace.yaml:57` declares `patchedDependencies`.
- `pnpm-workspace.yaml:58` patches `@module-federation/manifest@2.5.0`.
- `pnpm-workspace.yaml:59` patches `@module-federation/rspack@2.5.0`.
- `patches/@module-federation__manifest@2.5.0.patch` lazy-loads `@module-federation/dts-plugin/core`.
- `patches/@module-federation__rspack@2.5.0.patch` lazy-loads `@module-federation/dts-plugin`.
- `pnpm-lock.yaml:38` records the patch hashes.

External API evidence to re-check during execution:

- GitHub API: `gh api repos/module-federation/core/pulls/4755 --jq '{number,title,state,draft,merged_at,html_url}'`.
- Planning pass data on 2026-05-26: PR `4755` was open, draft, not merged, and titled `fix: lazy load DTS plugin modules`.
- NPM registry: `pnpm view @module-federation/modern-js-v3 version --json`, `pnpm view @module-federation/manifest version --json`, `pnpm view @module-federation/rspack version --json`.
- GitHub release API: `gh api repos/module-federation/core/releases/latest --jq '{tag_name,published_at,html_url}'`.

## Constraints

- Do not remove the patches before the upstream fix is actually released and available in the package versions consumed by this repo.
- Do not disable DTS to make builds pass. DTS remains mandatory for Ultramodern.
- Do not leave stale patch hashes in `pnpm-lock.yaml`.
- Do not update unrelated dependencies in the same patch-removal change unless the package manager requires it.

## Operator Guidance

The first todo may remain pending for a while. If PR 4755 is still draft or unreleased, stop after recording current API output and leave the plan open.

Once upstream is released, inspect the installed package contents rather than trusting the PR title. The local patch removal is safe only when the published package already lazy-loads the DTS modules in both `@module-federation/manifest` and `@module-federation/rspack`.

Suggested verification:

```bash
gh api repos/module-federation/core/pulls/4755 --jq '{state,draft,merged_at,html_url}'
gh api repos/module-federation/core/releases/latest --jq '{tag_name,published_at,html_url}'
pnpm view @module-federation/manifest version --json
pnpm view @module-federation/rspack version --json
pnpm install --lockfile-only
pnpm --filter @modern-js/create tests -- tests/integration/create-ultramodern-workspace/tests/index.test.ts
```
