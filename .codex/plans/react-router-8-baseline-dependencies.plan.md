---
name: react-router-8-baseline-dependencies
overview: Establish the React Router 8 package, platform, CI, and transitive dependency baseline before touching runtime behavior.
todos:
  - id: verify-current-release-contract
    content: Verify and record the current react-router and react-router-dom npm versions plus the official v8 upgrade requirements immediately before editing.
    status: pending
  - id: raise-router-node-baseline
    content: Update Modern.js package engines and CI jobs that execute router code so every relevant path runs on Node 22.22 or newer.
    status: pending
  - id: bump-owned-router-dependencies
    content: Move owned react-router package declarations and generated app pins from 7.18.0 to the selected 8.x version and refresh the lockfile.
    status: pending
  - id: remove-v7-dom-bridge
    content: Remove the app-tools react-router-dom fallback path and update its tests once v8 is the only supported React Router package shape.
    status: pending
  - id: resolve-transitive-dom-package
    content: Update or explicitly block on Module Federation and Rspress dependency paths that still pull react-router-dom into the lockfile.
    status: pending
  - id: prove-dependency-graph
    content: Run dependency checks and pnpm why proofs showing the final react-router and react-router-dom graph state.
    status: pending
isProject: false
---

# react-router-8-baseline-dependencies

## Execution Notes

This lane owns the package and platform move for `modernjs-8854`. The current checked state before planning is: `npm view react-router version` returns `8.0.1`, `npm view react-router-dom version` returns `7.18.0`, and local direct package declarations for React Router are `packages/toolkit/runtime-utils/package.json` and `tests/integration/dev-server/package.json`.

Official React Router v8 references to keep open while executing:

- https://reactrouter.com/upgrading/v7
- https://reactrouter.com/changelog
- https://reactrouter.com/start/declarative/installation

Local facts from the planning scan:

- `pnpm why react-router-dom --recursive --depth 4` reports transitive copies through `@module-federation/modern-js-v3` or `@module-federation/bridge-react` in MF integration fixtures, and through `@rspress/core` for docs.
- Generated UltraModern workspaces already pin Node 26.3.0 in `packages/toolkit/create/src/ultramodern-workspace/versions.ts`, but root `package.json` still allows Node `>=20` and several workflows still use Node 20 or generic 22 labels.
- React and ReactDOM package pins are already at `^19.2.7` across the scanned package surface.

## Constraints

Do not push package resolution through an app-level shim. If Module Federation, Rspress, or another upstream package has no React Router 8-compatible release, stop and update `modernjs-8854` with the exact blocker instead of adding local fake packages, aliases, or generated lockfile edits.

Keep the dependency move separate from runtime behavior edits when possible. Commit after the dependency/platform lane is green enough to give later runtime failures a clean boundary.

## Operator Guidance

Start here before the runtime lane. Use `npm view`, `pnpm why`, `pnpm install --lockfile-only`, `pnpm check-dependencies`, and targeted package tests to prove the graph after each package move.

The minimum acceptable dependency proof is:

- `pnpm why react-router --recursive --depth 4`
- `pnpm why react-router-dom --recursive --depth 4`
- `pnpm check-dependencies`
- `pnpm lint:package-json`
- a lockfile diff review showing no duplicate React Router major versions on owned runtime paths

If `react-router-dom` remains only because of docs tooling, record that explicitly and prove it is not in a generated app or runtime package path. If it remains in MF integration fixtures, treat that as a runtime compatibility decision and do not proceed to final validation until resolved or accepted by the owner.
