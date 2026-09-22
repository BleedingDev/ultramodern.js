---
name: bff-contracts-clients
overview: "Finish producer identity and policy consolidation around the already-native Effect client, and simplify batch/entry state."
todos:
  - id: bff-contracts-clients-producer
    content: "Compile explicit producer identity and operation descriptors once for Effect and Hono instead of 32-level, 10-level and app-root metadata lookups."
    status: completed
  - id: bff-contracts-clients-policy
    content: "Share browser-safe canonical operation serialization/hash construction between native client middleware and server policy while preserving precise native contract inference."
    status: completed
  - id: bff-contracts-clients-entries
    content: "Centralize discriminated app-source, built-output and external-SDK entry resolution; remove duplicated extension/output mapping while retaining consumer-specific restrictions."
    status: completed
  - id: bff-contracts-clients-batch
    content: "Normalize current client/server batch defaults once and simplify assembly/settlement ownership after auth, cancellation, deduplication and ambiguous-outcome behavior parity."
    status: completed
isProject: false
---

# bff-contracts-clients

## Execution Notes

Own bff-effect native effect-client policy/batch code, plugin-bff-extensions effect-source-loader operation-contracts/paths/built-entry and effect-adapter entry/producer policy, plus plugin-bff-build-extensions Hono artifact metadata. Native client inference and generator retirement already landed in modernjs-0nj1y. Do not recreate a generator or compatibility types. Exclude federation security and manifest/identity decoding owned by federation. Use published contract exports rather than cross-vertical internal source imports.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.7` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. Implementation and focused verification are complete; integrated packed and Tractor acceptance remain owned by the final acceptance plan.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve current native encoding and request/response/error inference, composed APIs, Effect group combinators, producer request IDs, operation versions/hashes, context, custom transport, batching, uploads, mounted prefixes and Hono optional Effect peer. Retained tests include native-http-api-client, effect-operation-contracts, effect batch queue/cancellation/byte-limits/fallback and effect-built-entry. Preserve auth/cookie partitions, safe dedup, independent deadlines, one settlement, no mutation replay after uncertain outcomes and source-removed/external-SDK production.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.

## Implemented result

One `resolveOperationProducer` owns package discovery and major-version derivation. Effect compiles the loaded entry's producer once across mount prefixes, including external prebuilt SDKs; Hono uses its API-directory owner and retains the local `default` request ID. Browser and Node hashes share canonical operation serialization without importing Node schema discovery into the client. Entry classification and emitted-extension mapping now have one owner. Client/server batch limits and method defaults share one normalizer; immutable auth partitions are assembled once, redundant bucket byte state is removed, and flush completion has one owner.

Focused verification passed 19 files and 78 tests, including native request/response/error inference, browser/Node hash parity, Hono default identity, 35-level producer discovery, source-removed production entry selection, external SDK major 7 versus consumer major 99 with mounted batches, auth partitions, independent cancellation, no mutation replay, byte limits, optional Zod, and published exact public types. No tests were deleted. Root owns final package builds and packed/downstream acceptance.
