---
name: Ultramodern TanStack Latest Dependencies
overview: Refresh every UltraModern TanStack dependency to the current registry versions, align generated workspaces and fixtures, and make stale TanStack versions fail fast before deeper SuperApp preflight work starts.
todos:
  - id: utsdep-01
    content: Re-check npm registry latest versions for TanStack Router, TanStack History, and any TanStack tooling used by the plugin or generated apps before editing package files.
    status: pending
  - id: utsdep-02
    content: Update @modern-js/plugin-tanstack, create templates, TanStack fixtures, Module Federation shared-version metadata, and pnpm-lock.yaml so they agree on the latest supported TanStack stack.
    status: pending
  - id: utsdep-03
    content: Add or update tests that fail when generated UltraModern apps emit stale TanStack dependency versions or mismatched MF shared requiredVersion values.
    status: pending
  - id: utsdep-04
    content: Run the focused plugin, create-template, routes-tanstack, and routes-tanstack-mf validation set and record the refreshed dependency evidence.
    status: pending
isProject: false
---

# Ultramodern TanStack Latest Dependencies

## Execution Notes

The current local baseline is inconsistent: `@modern-js/plugin-tanstack` and the TanStack MF fixtures use `@tanstack/react-router` `1.168.26`, while `@modern-js/create` still emits `1.158.1` in generated apps.

At planning time on 2026-05-15, `npm view` reported:

```text
@tanstack/react-router 1.169.2
@tanstack/history 1.161.6
@tanstack/router-plugin 1.167.35
```

Do not trust these values blindly when executing the plan. Re-run the registry check first, then update all package and fixture surfaces coherently.

Primary implementation hotspots are `packages/runtime/plugin-tanstack/package.json`, `packages/toolkit/create/template/package.json.handlebars`, create integration tests under `tests/integration/create-*`, `tests/integration/routes-tanstack*`, `tests/integration/routes-tanstack-mf/**`, and `pnpm-lock.yaml`.

## Constraints

This lane updates TanStack dependencies only. It must not introduce a second preset, broad create-template redesign, unrelated React dependency churn, or upstream-only PR scope changes.

Keep the dependency policy explicit: generated UltraModern apps should start from the same TanStack stack that the plugin and MF contract fixtures validate.

## Operator Guidance

Start with dependency discovery and lockfile update before runtime edits. If a latest TanStack version changes APIs used by `@modern-js/plugin-tanstack`, capture the breakage in this lane before starting runtime polish.

Suggested focused verification:

```bash
pnpm --filter @modern-js/plugin-tanstack test
pnpm --filter @modern-js/plugin-tanstack build
pnpm --dir tests exec vitest run -c vitest.framework.config.mjs integration/create-tailwind/tests/index.test.ts integration/create-bff-runtime/tests/index.test.ts
pnpm --dir tests exec rstest run -c rstest.superapp-contracts.config.mts integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts
```
