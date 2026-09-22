---
name: canonical-route-model
overview: "Use one explicit route semantics model for locale projections, TanStack runtime and concrete type generation."
todos:
  - id: canonical-route-model-descriptor
    content: "Define the smallest canonical route descriptor by reusing current normalization; make locale expansion an explicit adapter decision and preserve non-i18n lang routes."
    status: completed
  - id: canonical-route-model-materialize
    content: "Feed React Router physical locale routes and TanStack native rewriting/runtime construction from the descriptor; remove TanStack expansion-collapse work."
    status: completed
  - id: canonical-route-model-types
    content: "Generate concrete TanStack createRoute expressions from the same descriptor; delete duplicate root, parent, pathless, index and metadata interpretation."
    status: completed
  - id: canonical-route-model-parity
    content: "Prove route matching, identity and type inference across existing fixtures and remove old conversion paths rather than retaining a third graph."
    status: completed
isProject: false
---

# canonical-route-model

## Execution Notes

Own i18n-extensions/src/localisedUrls route/identity model and plugin-tanstack/src/{runtime/routeTree,cli/tanstackTypes,cli route artifact generation}. Exclude plugin.node.tsx, router state, navigation.tsx and provider lifecycle owned by the router-state lane. Browser materializers must not import CLI or Node modules.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.5` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. Implementation and focused parity verification are complete; integrated packed/Tractor acceptance remains owned by the final acceptance lane.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve React Router physical expansion, plain non-i18n :lang routes, /_mf routes, nested localization, collision rejection, duplicate IDs, optional/splat/index/pathless routes, loader/action IDs and inference, search/staticData, canonical direct URLs, localized direct SSR and unchanged search/hash. Use current plugin-tanstack/tests/router/routeTree.test.ts and tanstackTypes.test.ts for installed declaration compilation, locale deduplication and typed params; add a focused generated/runtime parity case. Target is fewer semantic passes, not just shared type names.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.

## Implementation evidence

- TanStack entries now request canonical locale projection directly through their existing route-owner metadata. React Router retains physical variants and duplicate-ID validation. Both projections retain pattern/collision and nested-localization checks.
- Removed `canonicaliseLocalisedRoutes` and its runtime, rewrite and emitter passes. A browser-safe route descriptor owns root, parent, pathless/index identity and TanStack path conversion. Runtime and emitted concrete `createRoute` trees consume it; root/child option assembly is shared within each representation.
- Runtime projection now retains explicit root identity. Generated trees retain root siblings and give unnamed pathless siblings the same IDs as runtime trees.
- Focused verification: **52 passing tests across seven files**, including emitted TypeScript compilation against installed declarations, actual generated/runtime tree identity comparison against built runtime, localized SSR/navigation with search/hash, native i18n route-owner dispatch, nesting/collision validation and real CLI artifact generation. Scoped Biome and diff checks pass.
- Authored source delta: **107 fewer lines**, including the new 46-line shared descriptor; tests counted separately. Native `plugin-i18n/src/cli/index.ts` adds only the entrypoint argument at the existing fork helper seam; root owns same-PR divergence evidence and budget recording.

Independent review caught inherited canonical metadata dropping standalone wildcard segments. The locale projection now retains wildcard canonical paths and translated ancestor wildcard mappings. The parity test exercises localized splat SSR matching and generated-router navigation with search/hash, plain locale fallback splats, and compiled `_splat` contracts; all focused checks pass after the correction.

Headless route generation now awaits the initialized CLI context’s actual `onBeforeExit` hook before returning. This pairs with the validator lane’s static per-app process isolation, preserving native cwd/import-cache assumptions without app patches or rendered programs. Real async-hook completion and unchanged initialization/cleanup errors are verified.
