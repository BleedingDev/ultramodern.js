---
name: packaged-validator
overview: "Replace executable validation templates and per-invocation temporary programs with one packaged typed validator."
todos:
  - id: packaged-validator-package
    content: "Extract validator logic into ordinary typed modules with explicit workspace root, immutable expected contract and bounded dependency inputs; preserve diagnostics and CLI exit behavior."
    status: completed
  - id: packaged-validator-invoke
    content: "Invoke typed validation directly or through one static packaged entrypoint; preserve thin current consumer wrappers and remove obsolete template execution paths."
    status: completed
  - id: packaged-validator-remove
    content: "Remove current validator executable templating, temporary command creation and template-induced dependency discovery after packed-consumer and adversarial validation parity."
    status: completed
isProject: false
---

# packaged-validator

## Execution Notes

Own ultramodern-create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars, src/ultramodern-workspace/workspace-scripts.ts, src/ultramodern-tooling/commands/{validate.ts,context.ts} and new validator modules in this existing fork package. Preserve other commands using context.ts; remove runRenderedModule only when all callers have a replacement. Coordinate expected-contract signatures with the workspace owner.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.3` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. Typed validator extraction and direct CLI invocation are implemented. Focused source, CLI mutation and packed source-unavailable validator checks pass; route worker end-to-end acceptance is coordinated with integrated acceptance.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve installed-template expectations, patch parity, installed-cohort provenance parity, authored proof routes, profile-specific artifacts, operational diagnostics and exit codes. Expected values must not come solely from untrusted consumer projections. Retained tests: workspace-validation-structured-contract, patch-parity, cohort-parity and workspace-integration. Run packed consumers with repository source unavailable. Moving 4,046 template lines is not itself a cut; count removed rendering, temporary-program and dependency-discovery plumbing.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.

## Execution evidence

The packaged validator now directly consumes the installed generator's expected contract. Architecture evidence, JSON assertions and artifact validation are ordinary TypeScript modules. The deleted template's synthetic reconstruction of retired generated-contract metadata and comparisons of its own constants were removed; real compact policy, topology, manifests, delivery identity, public source artifact, profile, patch/cohort and compiler checks remain. Native compiler lookup is bounded to the consumer root, runs with that root as cwd, and closes on success or failure.

All three temporary program callers were converted: validation and Cloudflare verification run directly; routes-generate uses one static packaged per-app entrypoint to isolate the native CLI's process-global state and import-time working directory. Each path resolves the consumer's installed provider and preserves diagnostics. The shared temporary file runner and the obsolete embedded-validator ownership artifact are gone. Consumer wrappers remain thin stable CLI entrypoints.

Verification: package source type-check and targeted Biome pass; 18 focused normalization/patch/cohort/Cloudflare command tests pass; 15 CLI/profile tests pass including structured mutation matrices, compiler bridge/thin-shell gates and REST/RPC/profile preservation. Final structured drift matrix also passes after direct SSR, primary-shell identity and compact federation checks were added; source-relative TypeScript import contracts and invocation from outside the workspace pass. Packed source-unavailable validator proof passed: the actual workspace-installed CLI validated a generated consumer with all first-party framework source directories removed and NODE_PATH cleared (tests owner evidence: /tmp/modernjs-fork-cuts-packed-validator.log). The retained structured drift matrix provides adversarial parity. Natural successful route worker termination remains an integrated acceptance check while the supply owner repairs the independently exposed Module Federation ESM patch defect.
