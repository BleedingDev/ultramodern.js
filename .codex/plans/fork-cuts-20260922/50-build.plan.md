---
name: build-resolution-ownership
overview: "Replace repeated address/capability inference and private fork-package path resolution with explicit owner APIs."
todos:
  - id: build-resolution-ownership-addresses
    content: "Use surface-resolution as the shared pure remote-address owner; make generated configs pass data and preserve formatting through a thin build adapter."
    status: pending
  - id: build-resolution-ownership-targets
    content: "Add supported worker entry points for fork-owned runtime targets and remove corresponding private-path aliases; retain version-tested adapters for unsupported dependency exports."
    status: pending
  - id: build-resolution-ownership-analysis
    content: "Share bounded parser/scope/diagnostic mechanics inside code-tools while preserving separate baseline and runtime policies."
    status: pending
  - id: build-resolution-ownership-capabilities
    content: "Normalize MF SSR capabilities once at composition ingress with legacy marker translation, then remove repeated plugin-shape/environment inference from execution."
    status: pending
isProject: false
---

# build-resolution-ownership

## Execution Notes

Own toolkit/surface-resolution, generator module-federation/remote-refs.ts, app-tools-extensions/{cloudflare-builder.ts,policy-defaults.ts,runtime-package-resolution.ts}, ultramodern-app-tools/native-composition/{preset.ts,ssr-integration-plugin.ts} and code-tools analysis primitives. Own worker entry wrappers and package.json export entries in runtime/{runtime-extensions,renderer-extensions,plugin-tanstack,federation-runtime} and server/runtime-extensions; baseline records exact new entry filenames and excludes these exports/wrappers from other lanes. Required exports land before this lane packed-consumer validation. No blanket license for native package changes; apply provenance and ledger review. Exclude generator model, release-envelope redesign and conditional Zephyr/declaration retirement.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.9` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. All implementation is pending.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve explicit URL precedence and version isolation; adjudicate missing production config explicitly. Test Node/Worker SSR, RSC on/off, singleton identity, optional React Router, plain appTools renderer/server defaults and false opt-outs, descriptor deduplication, app-copy priority and bare conditional exports. Do not replace bare runtime imports with resolved-file aliases. Keep .ts generic-arrow versus JSX parsing, composed APIs/clients, native combinator metadata, relative reexport/default traversal, 256-module/512-binding limits and operational-error distinctions. Probe unrelated undeclared app imports separately from legitimate generated framework plugin resolution. Final packed generator and Tractor acceptance required.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.
