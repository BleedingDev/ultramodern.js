---
name: Dependency refresh tooling
overview: Establish current Node, pnpm, release tooling and test runners without losing install-policy or release-cohort behavior.
todos:
  - id: update-node-pnpm-contract
    content: Update Node and pnpm pins across root policy and CI and prove install, filter, pack and policy parity on the selected versions.
    status: completed
  - id: update-release-tooling
    content: Upgrade Changesets CLI and declared libraries together and prove the existing fixed-group release and publication preparation in a dry run.
    status: completed
  - id: update-lint-test-tools
    content: Upgrade lint and test tool cohorts and repair their owning configs and active examples with passing behavioral checks.
    status: completed
isProject: false
---

# Dependency refresh tooling

## Execution Notes

Beads `modernjs-h8xqq.2`. Depends on baseline. Targets include Node 26.10.0, pnpm 12.8.1, Changesets CLI 3.0.3 with read/config/assemble libraries, Biome 2.5.15, oxfmt 0.71.0, oxlint 1.86.0, ultracite 7.12.2 and Vitest 5.0.3. Retain current stable TypeScript 7.0.2 and Nx 23.2.1. Update older active type/tool pins where their consumers are still supported.

Own root tooling manifests/configs, Node policy, toolchain CI pins, `scripts/check-changeset`, `scripts/release-note`, `scripts/release-version`, lint hooks, and test-only examples. Rstest and its Modern adapter belong to the build lane. Generator-owned version constants remain the generator lane's responsibility; supply it the frozen tooling targets. Babel/Jest, jsdom, Cypress and testing-library major updates must include compatible adapters and verified setup semantics.

## Constraints

Use the frozen matrix rather than new tags during testing. pnpm 12's Rust CLI must satisfy the settings currently used by the JavaScript CLI. Do not disable build allowlists, no-downgrade checks, release-age checks, lockfile validation, peer checks or hooks to pass. Declare Vite explicitly in the Vitest example because `autoInstallPeers` is false. Preserve Changesets fixed group and package-source remapping. Never publish during this plan.

## Operator Guidance

This lane establishes the toolchain before Effect/build/runtime lanes. The integration coordinator alone installs or rewrites the shared lockfile after each accepted checkpoint; every checkpoint uses the selected pnpm and reruns frozen install before builds. No two installs may relink the same checkout. Plan edits to root scripts and release tooling as reversible commits.

Prove `pnpm check-dependencies`, `pnpm lint:package-json`, scoped lint, hooks, filtering, pack, patch application and an independent generated install. Exercise Changesets status and version preparation in disposable owned staging so source versions and changelogs remain untouched during dry runs. Run release-script and publish-tooling tests against the resulting release plan, including one common framework version and exact internal dependencies. Preserve unrelated changes and existing stashes.
