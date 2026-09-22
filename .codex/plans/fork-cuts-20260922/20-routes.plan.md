---
name: canonical-route-model
overview: "Use one explicit route semantics model for locale projections, TanStack runtime and concrete type generation."
todos:
  - id: canonical-route-model-descriptor
    content: "Define the smallest canonical route descriptor by reusing current normalization; make locale expansion an explicit adapter decision and preserve non-i18n lang routes."
    status: pending
  - id: canonical-route-model-materialize
    content: "Feed React Router physical locale routes and TanStack native rewriting/runtime construction from the descriptor; remove TanStack expansion-collapse work."
    status: pending
  - id: canonical-route-model-types
    content: "Generate concrete TanStack createRoute expressions from the same descriptor; delete duplicate root, parent, pathless, index and metadata interpretation."
    status: pending
  - id: canonical-route-model-parity
    content: "Prove route matching, identity and type inference across existing fixtures and remove old conversion paths rather than retaining a third graph."
    status: pending
isProject: false
---

# canonical-route-model

## Execution Notes

Own i18n-extensions/src/localisedUrls route/identity model and plugin-tanstack/src/{runtime/routeTree,cli/tanstackTypes,cli route artifact generation}. Exclude plugin.node.tsx, router state, navigation.tsx and provider lifecycle owned by the router-state lane. Browser materializers must not import CLI or Node modules.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.5` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. All implementation is pending.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve React Router physical expansion, plain non-i18n :lang routes, /_mf routes, nested localization, collision rejection, duplicate IDs, optional/splat/index/pathless routes, loader/action IDs and inference, search/staticData, canonical direct URLs, localized direct SSR and unchanged search/hash. Use current plugin-tanstack/tests/router/routeTree.test.ts and tanstackTypes.test.ts for installed declaration compilation, locale deduplication and typed params; add a focused generated/runtime parity case. Target is fewer semantic passes, not just shared type names.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.
