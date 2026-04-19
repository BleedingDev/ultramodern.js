---
name: MV-First Framework Hardening
overview: Recover the previously proposed "next order" for Ultramodern and encode it as an executable plan graph. This plan hardens the framework around MV-first composition with TanStack-first routing, Effect-first server/runtime contracts, and Module Federation-compatible SSR boundaries. It is intentionally limited to framework and platform work. It does not represent full Micro Verticals completion, and it does not include any compatibility facade for unpublished previous Ultramodern.js versions.
todos:
  - id: mvfh-01
    content: Finish the product-taxonomy purge and make the boundary enforcement irreversible in framework contracts and certification gates.
    status: completed
  - id: mvfh-02
    content: Open the post-44t MV-first framework hardening epic and split this plan into concrete Beads child issues owned by framework workstreams.
    status: completed
  - id: mvfh-03
    content: Reach TanStack plugin parity for exported hooks, SSR ownership, hydration and dehydrate paths, and route creation or mutation hooks.
    status: completed
  - id: mvfh-04
    content: Define the MV-first SSR contract for shell-to-vertical composition, including request propagation, trace and locale flow, fallback semantics, and independently deployed vertical compatibility rules.
    status: completed
  - id: mvfh-05
    content: Make Effect a true first-class path across runtime context, client generation, server adapters, MF boundary contracts, and coverage, rather than only a partial BFF-generation lane.
    status: completed
  - id: mvfh-06
    content: Add Modern.js compatibility tests and migration notes for the new MV-first, TanStack-first, and Effect-first defaults without introducing any unpublished-Ultramodern legacy facade.
    status: completed
  - id: mvfh-07
    content: Update release gates, docs, and certification evidence so the framework ships as stronger-default Modern.js rather than an ungoverned fork.
    status: pending
isProject: true
---

# MV-First Framework Hardening

## Execution Notes

This plan is derived from the previously proposed "next order" recovered from the local Codex session on 2026-04-17 for `main-ultramodern`.

The governing order is:

1. Lock in the product-taxonomy purge.
2. Create the post-`44t` hardening epic and child work items.
3. Treat TanStack parity as the next real framework blocker.
4. Formalize the MV-first SSR contract.
5. Complete Effect-first parity across the full stack.
6. Close with explicit upstream Modern.js compatibility proof and migration notes.
7. Wire the whole thing into gates and release evidence.

`mvfh-03` is marked `completed` after the TanStack router subpath export was published and the create-routes contract coverage passed. `mvfh-04` is marked `completed` after its SSR-contract doc/test bundle landed and targeted verification passed. `mvfh-05` is marked `completed` after the Effect-first generator, create-request, and policy contract coverage passed. `mvfh-06` is marked `completed` after canonical Modern.js migration notes landed in the public docs and the superapp contract suite gained explicit app-level MF SSR compatibility coverage. `mvfh-07` is now the next frontier for stronger-default Modern.js gate, docs, and certification evidence work.

## Constraints

1. Scope is framework and platform hardening only.
2. This plan is not full Micro Verticals completion. It does not cover module-specific business workflows, vertical templates, or shipping a finished MV product layer.
3. Do not introduce a compatibility layer or facade for unpublished previous Ultramodern.js versions.
4. Preserve intentional Modern.js ecosystem power where it matters, especially Module Federation capability, external remote loading, and explicitly supported upstream compatibility lanes.
5. Domain and product taxonomy remain downstream-owned, not framework-core encoded.
6. New defaults may be opinionated, but evidence for compatibility and migration must stay explicit.

## Operator Guidance

Use this as the prerequisite framework lane before any separate "full Micro Verticals" delivery plan.

If `mvfh-01` reveals more domain leakage, keep deleting it from framework core before moving on. The point of the first lane is to make business taxonomy drift structurally hard to reintroduce.

The compatibility todo is intentionally narrow. It means proving that the stronger defaults still interoperate with the Modern.js ecosystem where that is a stated product goal. It does not mean preserving internal pre-release Ultramodern behavior through shims or facades.

Once this plan is complete, the next separate plan should cover full MV delivery concerns such as reference vertical structure, shell-to-vertical extraction workflow, external remote integration examples, shared design-system module strategy, and end-to-end developer ergonomics for vertical ownership.

## References

- Product taxonomy must stay downstream-owned: [SDK-0001](</Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/SDK-0001-module-sdk-contracts.md:36>)
- Default architecture is Effect + TanStack + MF with compatibility lanes preserved rather than promoted: [ARCH-0001](</Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/ARCH-0001-effect-tanstack-target-architecture.md:19>)
- Current public TanStack export surface is thin: [tanstack-router.ts](</Users/satan/side/experiments/modernjs/packages/runtime/plugin-runtime/src/exports/tanstack-router.ts:1>)
- Current TanStack SSR and route hooks still live in runtime internals: [plugin.node.tsx](</Users/satan/side/experiments/modernjs/packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.node.tsx:112>)
- Existing contract test shape worth preserving: [modern.runtime.tsx](</Users/satan/side/experiments/modernjs/tests/integration/routes-tanstack-create-routes/src/modern.runtime.tsx:1>)
