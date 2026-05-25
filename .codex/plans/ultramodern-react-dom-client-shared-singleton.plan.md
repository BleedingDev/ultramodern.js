---
name: Ultramodern React DOM Client Shared Singleton
overview: Add react-dom/client to every generated Ultramodern Module Federation shared config so React 19 app-level remotes cannot bypass the react-dom singleton through subpath imports.
todos:
  - id: verify-upstream-react-dom-client-risk
    content: "Confirm the current upstream issue, reproduction shape, and recommended workaround through the GitHub API for module-federation/core issue 4727."
    status: completed
  - id: inspect-generated-shared-config
    content: "Inspect createSharedModuleFederationConfig and generated shell/remote module-federation.config.ts files to confirm react-dom is shared but react-dom/client is missing."
    status: completed
  - id: update-shared-config-generator
    content: "Add react-dom/client as an explicit singleton with the same requiredVersion and treeShaking policy as react-dom in the Ultramodern shared config generator."
    status: completed
  - id: update-generator-tests-and-validator
    content: "Update create-ultramodern-workspace tests and the generated validator to assert react-dom/client is present for both shell and remote Module Federation configs."
    status: completed
  - id: run-focused-quality-gates
    content: "Run the focused create-ultramodern-workspace integration test plus any generated workspace validation needed to prove the shared config output is stable."
    status: completed
isProject: true
---

# Ultramodern React DOM Client Shared Singleton

## Execution Notes

Source Bead: `modernjs-m5d4`.

This is the smallest high-signal fix and should be executable before the full-stack package pivot. It affects the generated Module Federation shared contract only; it should not change runtime routing, Zephyr dependency mapping, Effect service wiring, or workspace topology.

Current repo evidence:

- The generated shared config is produced by `createSharedModuleFederationConfig` in `packages/toolkit/create/src/ultramodern-workspace.ts:1094`.
- The current config shares `react` and `react-dom`, but not `react-dom/client`, at `packages/toolkit/create/src/ultramodern-workspace.ts:1111` and `packages/toolkit/create/src/ultramodern-workspace.ts:1116`.
- Generated Ultramodern tests already assert Module Federation and Zephyr config shape in `tests/integration/create-ultramodern-workspace/tests/index.test.ts:612` and `tests/integration/create-ultramodern-workspace/tests/index.test.ts:927`.
- The generated workspace validator checks generated config content in `packages/toolkit/create/template-workspace/scripts/validate-ultramodern-workspace.mjs.handlebars:619`.

External API evidence to re-check during execution:

- GitHub API: `gh api repos/module-federation/core/issues/4727 --jq '{number,title,state,created_at,html_url,body}'`.
- Expected current data from the 2026-05-26 planning pass: issue `4727`, state `open`, title about `react-dom/client` bypassing shared module resolution with React 19.
- Upstream workaround in the issue is to explicitly add `react-dom/client` to shared config on host and remote.

## Constraints

- Keep DTS mandatory. This task must not disable or loosen the generated `dts` config.
- Do not introduce a bridge-specific workaround. The generated config must be general for host and remotes.
- Use the same `reactDomVersion` source as `react-dom`; do not add a new package lookup unless implementation requires it.
- Keep generated config deterministic so snapshot/string assertions remain stable.

## Operator Guidance

Implement the generator change first, then regenerate or inspect generated output through the existing integration test helpers. The acceptance condition is simple: every generated host and remote Module Federation config includes all three singleton entries: `react`, `react-dom`, and `react-dom/client`.

Suggested verification commands:

```bash
gh api repos/module-federation/core/issues/4727 --jq '{number,title,state,created_at,html_url}'
pnpm --filter @modern-js/create tests -- tests/integration/create-ultramodern-workspace/tests/index.test.ts
```

If the package test command differs in this repo, inspect the nearest package scripts before substituting. Do not run repo-wide gates until the focused test passes.
