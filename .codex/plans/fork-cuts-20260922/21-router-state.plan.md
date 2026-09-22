---
name: router-capabilities-lifetime
overview: "Remove i18n router introspection, repeated SSR snapshot state and scattered cleanup through explicit provider contracts."
todos:
  - id: router-capabilities-lifetime-capability
    content: "Add a provider-owned typed navigation capability with stable location/params, native Link, target conversion and navigation; migrate i18n and remove internal store/framework guessing."
    status: completed
  - id: router-capabilities-lifetime-snapshot
    content: "Keep one immutable prepared SSR snapshot apart from live state and update current consumers atomically; remove repeated fields, double normalization and reader fallback ladders."
    status: completed
  - id: router-capabilities-lifetime-lifetime
    content: "Acquire an idempotent router disposer when resources are attached and transfer lifetime to response termination only after successful preparation; remove branch cleanup duplication."
    status: completed
  - id: router-capabilities-lifetime-verify
    content: "Verify standalone and federated navigation, provider replacement, string/stream/RSC lifecycle and every preparation failure before retiring old paths."
    status: completed
isProject: false
---

# router-capabilities-lifetime

## Execution Notes

Own i18n-extensions/src/router-navigation/adapter.tsx and capability exports, the thin i18n-integration re-export, runtime-extensions router state/provider contracts and plugin-tanstack/src/runtime/plugin.node.tsx. Global legacy registry fallback is already deleted. Exclude route-tree/type-generation algorithms. Worker wrappers and package export metadata are build-lane-owned; agree interfaces at baseline. Neutral native cleanup changes require provenance/ledger review.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.6` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. Implementation and lane verification are complete; integrated packed/Tractor acceptance is owned by the final acceptance plan.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve delayed provider installation/publication, native Link/navigation shapes, history/state, hash scroll, preload, params, standalone fallback and realm isolation. Retained tests: plugin-i18n navigation and runtime-extensions routerState; TanStack router/ssrPreload covers once-only preload. Add focused failure injection for load/preload/dehydrate, abort/redirect/CSR fallback and delayed stream termination; cleanup exactly once. The current serverPlugin and routerCleanup suites exist and must retain coverage; the earlier audit incorrectly described them as deleted.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.


## Implementation evidence

The i18n seam now consumes an explicit provider capability. React Router publishes positional navigation, subscriptions and native Link through the existing fork policy hook; TanStack owns its object-shaped navigation, stable snapshots and native target conversion. Slot installation and provider replacement remain reactive. Framework-name and internal-store guessing is deleted.

Prepared SSR metadata lives in one immutable snapshot, with copied/frozen metadata containers and application-owned loader values. Live state contains only provider identity, instance, navigation and disposal. Removed singular hydrationScript, live snapshot duplicates, fallback readers and createRouterRuntimeState normalization. Native renderer fixtures use the prepared-snapshot writer.

TanStack acquires an idempotent disposer before SSR attachment; one finally covers partial attachment, load, missing results, preload, dehydrate, redirect, CSR fallback, abort and lifecycle-hook failure. Successful preparation retains the existing native response-body termination policy. Both Modern loader bridges now combine incoming request and native match cancellation signals; an active-loader abort regression test proves disposal completes.

Validation: 17 retained/extended suites, 90 tests passed, covering navigation, replacement, native React Router history, real TanStack state/history, string/stream cleanup, SSR status/assets/scripts, RSC payload and client hydration. Two additional loaderBridge/routeTree suites passed 21 tests. Changed files pass Biome. No tests deleted. Production reduction before final integration is approximately 327 lines including the new provider implementation. The root-coordinated full prerequisite build passed all 47 tasks with the final snapshot, capability and cancellation changes. Independent runtime review found no remaining blocker. Packed/Tractor release acceptance remains owned by the final acceptance plan.
