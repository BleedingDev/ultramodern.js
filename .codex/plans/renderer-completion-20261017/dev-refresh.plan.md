---
name: Complete retained native development refresh
overview: Finish actual federated native HMR and fresh SSR ownership after remote changes while preserving host application state.
todos:
  - id: modernjs-dnpv3.58.11.6
    content: Pass real remote rebuild refresh without document reload or stale SSR
    status: pending
isProject: false
---

# Complete retained native development refresh

## Execution notes

Own federation-runtime/src/module-federation/native-dev-refresh-runtime-plugin.ts, its regression tests, the existing native Node publisher in ultramodern-app-tools, and tests/ultramodern-renderers/octane-federation/dev.mjs. Coordinate shared composition files with the Worker owner and integrator. Native runtime/compiler ownership fixes belong in the Octane fork source, not Modern application code. Use the same named Octane source owner as native-snapshots. Historical PR4 on ultramodern/signal-owner-0.7.1 contains native-hot-owner.ts, signals/hot-declarations.ts, publisher-boundary-protocol.ts and compiler changes absent from current main; PR2 is its snapshot base. The native owner ports snapshot contracts first, then refresh admission/declaration changes through reviewed commits. Modern dev refresh tests may proceed in parallel, but do not schedule simultaneous native file writes. Prove both behaviors after integration.

The latest prior full dev proof passed initial streamed SSR, retained hydration, CSS, shared context/counters and reactive props. Remote edits then forced a document reload and fresh SSR lost the active native server signal owner. The subsequent 115-test provider-refresh regression is useful input, not whole-browser completion. Reproduce the original failures on the current cohort. Correct compiler/module revision admission, declaration rebinding, native provider identity and isolated remote remount only where needed.

Run the actual host and remote dev servers, perform compatible component and dependency edits, burst/concurrent edits, incompatible remote changes, remote outage/recovery and remote removal. Assert the document identity and navigation count do not change; host DOM, router location, context, props and counters survive. Any required isolated remote remount may reset that remote's own state, with exactly-once cleanup, and must preserve siblings/host. Fetch fresh SSR from the same running host after each admitted update and verify current remote code plus valid native signal/context scope. Stale graphs and cross-host revisions must never win races. Prove watchers, sockets, process groups and pending loads clean up on failure and shutdown.

## Success criteria

The original browser dev proof passes repeatedly on real native runtime/compiler output with no reload fence bypass or synthetic event handling. Assert native signal ownership in fresh SSR and retained provider identity through update. Add this active passing proof to the blocking ultramodern:renderer-release matrix and canonical CI, using authenticated installed-cohort execution. The source proof is currently not invoked by the release matrix; do not confuse that omission with a literal skip in this source file. Any separately skipped integration case covering the same supported behavior must become active. Record CPU/byte or timing regressions with cause and explicit supported semantics; a prior provider unit pass cannot close this task.

## Required CI and publication gate

Create `installed-renderer-features`, named `Installed renderer feature acceptance`, in `.github/workflows/native-compatibility.yml`. It must consume the authenticated immutable candidate from `pack-candidate` and run the installed dev-refresh, prebuilt Worker and separately generated Worker rows through `ultramodern:renderer-release`. Add it to the `native-compatibility` aggregate's `needs` and explicit success-result list so missing, skipped and failed execution block the existing required check. Preserve the existing ERP and Tractor gates. In `.github/workflows/publish-bleedingdev.yml`, run the same three rows on the exact bundle inside `accept-release` and again against registry-resolved bytes in `accept-published`; bind their evidence to the corresponding acceptance receipts. A manual script entry alone is insufficient.

## Constraints

Read `README.md` in this plan directory before execution. Beads is authoritative; update only the named task and its actual completion evidence. This plan's pending todo means its new completion pass has not started, regardless of historical parent issue status. Preserve snapshot ca61247 and all other sessions' work. Do not add app shims, manual navigation handlers, suppressed checks, generated-output edits or weaker acceptance assertions. New Modern behavior belongs in fork-owned packages; upstream-owned non-shrink changes require reviewed source and the same-PR divergence ledger and boundary gate. Never edit installed dependencies to stand in for authored source.

## Operator guidance

Work only in the assigned named branch and file ownership. Read current checks/reviews once, deduplicate active validation, then build the next consumer. Use normal hooks, focused checks and exact artifacts. A failed real consumer keeps this task open with a concrete next action. Register operation-owned outputs, use the external pnpm store and clone-or-copy, and clean only this operation's authorized resources in finally/signal paths. Do not delete other sessions' dependencies.
