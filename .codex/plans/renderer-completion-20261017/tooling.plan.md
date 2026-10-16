---
name: Integrate required generator and tooling support
overview: Carry the preserved supporting changes that the renderer features need and verify their public generator, package and process behavior.
todos:
  - id: modernjs-dnpv3.58.15
    content: Qualify supporting generator, tracing, package identity and CI changes
    status: pending
isProject: false
---

# Integrate required generator and tooling support

## Execution notes

Own the supporting generator formatting/process code and its focused tests, lazy NFT tracing changes, asset consumer identity helpers and CI resource changes from the 160-path inventory. This is not permission to reopen the separate generator architecture, deployment portability or broad NFT investigations. Already-carried fixes, such as the debugger RuntimePlugin import, should be recognized rather than recreated.

For each retained change, state the required feature dependency and an executable oracle. Verify bounded Oxfmt workers, fresh configuration child pair lifecycle, draining both children, failure/cancellation cleanup, deterministic output and public generated syntax/formatting. Verify lazy NFT tracing preserves original invocation inputs through the asynchronous import and supports advertised public CJS/ESM entrypoints. If a preserved change is independent from completing the requested renderer behavior, keep its source safe and file a specific follow-up issue, with the reason it is outside this release. Do not silently turn incomplete features into future research.

Keep CI shard parallelism and unchanged semantic/timing assertions when using maxWorkers=1 inside each shard. Validate changed workflows with actionlint. Integrator owns shared manifests/config exports/profile changes requested by this lane. No large build/dependency tree is needed merely to classify source changes.

## Success criteria

Every supporting path has a tested retained change, an already-carried disposition, a justified supersession or a named independent follow-up. Public generator/process/trace regressions pass against the current baseline. Operation-owned child processes and resources clean up on early failures. No blanket formatting churn, bypassed checks or restored obsolete release producer is included.

## Constraints

Read `README.md` in this plan directory before execution. Beads is authoritative; update only the named task and its actual completion evidence. This plan's pending todo means its new completion pass has not started, regardless of historical parent issue status. Preserve snapshot ca61247 and all other sessions' work. Do not add app shims, manual navigation handlers, suppressed checks, generated-output edits or weaker acceptance assertions. New Modern behavior belongs in fork-owned packages; upstream-owned non-shrink changes require reviewed source and the same-PR divergence ledger and boundary gate. Never edit installed dependencies to stand in for authored source.

## Operator guidance

Work only in the assigned named branch and file ownership. Read current checks/reviews once, deduplicate active validation, then build the next consumer. Use normal hooks, focused checks and exact artifacts. A failed real consumer keeps this task open with a concrete next action. Register operation-owned outputs, use the external pnpm store and clone-or-copy, and clean only this operation's authorized resources in finally/signal paths. Do not delete other sessions' dependencies.
