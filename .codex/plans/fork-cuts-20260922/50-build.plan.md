---
name: build-resolution-ownership
overview: "Replace repeated address/capability inference and private fork-package path resolution with explicit owner APIs."
todos:
  - id: build-resolution-ownership-addresses
    content: "Use surface-resolution as the shared pure remote-address owner; make generated configs pass data and preserve formatting through a thin build adapter."
    status: completed
  - id: build-resolution-ownership-targets
    content: "Verify worker entry ownership; remove private fork-package aliases only where they exist and retain upstream/external adapters where owned exports cannot replace them."
    status: completed
  - id: build-resolution-ownership-analysis
    content: "Share bounded parser/scope/diagnostic mechanics inside code-tools while preserving separate baseline and runtime policies."
    status: completed
  - id: build-resolution-ownership-capabilities
    content: "Normalize MF SSR capabilities once at composition ingress with legacy marker translation, then remove repeated plugin-shape/environment inference from execution."
    status: completed
isProject: false
---

# build-resolution-ownership

## Execution Notes

Own toolkit/surface-resolution, generator module-federation/remote-refs.ts, app-tools-extensions/{cloudflare-builder.ts,policy-defaults.ts,runtime-package-resolution.ts}, ultramodern-app-tools/native-composition/{preset.ts,ssr-integration-plugin.ts} and code-tools analysis primitives. Own worker entry wrappers and package.json export entries in runtime/{runtime-extensions,renderer-extensions,plugin-tanstack,federation-runtime} and server/runtime-extensions; baseline records exact new entry filenames and excludes these exports/wrappers from other lanes. Required exports land before this lane packed-consumer validation. No blanket license for native package changes; apply provenance and ledger review. Exclude generator model, release-envelope redesign and conditional Zephyr/declaration retirement.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.9` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. Implementation verification is recorded below.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve explicit URL precedence and version isolation; adjudicate missing production config explicitly. Test Node/Worker SSR, RSC on/off, singleton identity, optional React Router, plain appTools renderer/server defaults and false opt-outs, descriptor deduplication, app-copy priority and bare conditional exports. Do not replace bare runtime imports with resolved-file aliases. Keep .ts generic-arrow versus JSX parsing, composed APIs/clients, native combinator metadata, relative reexport/default traversal, 256-module/512-binding limits and operational-error distinctions. Probe unrelated undeclared app imports separately from legitimate generated framework plugin resolution. Final packed generator and Tractor acceptance required.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.

## Implementation evidence

The address algorithm now lives in `surface-resolution`. Generated config imports the app-tools adapter, which reads the existing environment lease API and formats Module Federation refs. Explicit configured refs retain their spelling; missing production addresses fail explicitly. Local development, public URLs, workers.dev and major isolation remain supported.

Code-tools shares parser plugins, diagnostic identity, lexical scope construction and expression unwrapping in one small internal module. Baseline and executable-runtime policies retain their independent traversal/mutation rules and budgets (256 modules/512 bindings for baseline; 64 modules/1 MB for executable runtime). SSR application capabilities are captured once at builder setup; environment-specific marker translation remains at the environment boundary. The preset reuses the existing package-host lookup instead of carrying another ancestor walker.

Worker-target review rejected the originally presumed cut: `cloudflare-builder.ts` private targets are upstream runtime/render RSC entries or external TanStack, React, Loadable and RSC packages. No private fork-package aliases exist there. Adding wrappers would move complexity and expand upstream maintenance. Existing fork worker entries remain intact, as do their bare imports and singleton identities.

Focused checks: 100 tests passed across surface resolution14, code-tools49, SSR13, plain-defaults/Cloudflare/runtime-resolution17, generated packaged address resolver4 and preset3. Code-tools, surface-resolution and ultramodern-app-tools `tsgo --noEmit` passed. The root-coordinated dependency/package rebuild completed before the packaged public resolver and optional React Router consumer tests. Biome passes changed sources.

A real Rspack resolver probe confirmed app-copy precedence and Node/workerd conditional exports. It also confirmed the existing fallback module roots expose unrelated undeclared registrar dependencies. Replacing that with a package-scoped fallback is a separate evidenced improvement: a simple file alias would bypass export conditions and is not accepted here.

Net authored source reduction:158 lines, including105 lines in the two new shared helper modules. No upstream-owned source changed. Root integrated the new app-tools-extensions dependency on surface-resolution; lockfile updates remain root-owned. Packed workspace and Tractor end-to-end acceptance remain with the final acceptance lane.

Packed-consumer acceptance found an existing boundary defect: the Effect Node bundler treated every resolved `node_modules` path as executable, including pnpm-injected workspace TypeScript. The fork-owned loader now bundles files requiring TS/JSX compilation regardless of physical installation layout, while installed executable dependencies stay external. The existing Effect identity/JSON encoding regression reproduced the Node error for both CJS and ESM injected layouts before the fix; all9 loader tests and the package no-emit typecheck pass afterward. Root must rebuild/repack plugin-bff-extensions before the final real-consumer rerun.
