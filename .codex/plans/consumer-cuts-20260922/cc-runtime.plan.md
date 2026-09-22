---
name: cc-runtime
overview: "Implement API-only release identity and artifact verification natively, eliminating the app-tools and proof-script consumer workarounds."
todos:
  - id: cc-runtime-native-api-envelope
    content: "Emit and consume the normal release envelope using actual declared API-only surfaces."
    status: pending
  - id: cc-runtime-runtime-negative-controls
    content: "Preserve identity, absent-surface, and Cloudflare builtin behavior with focused positive and negative tests."
    status: pending
isProject: false
---

# cc-runtime

## Execution Notes

Use the three reviewed OntOS .12 patches as evidence of required behavior, not code to transplant blindly. app-tools-extensions currently needs API-only guards in release-envelope/plugin.ts and cloudflare/index.ts, an absent-surface correction in cloudflare-output-verifier/identity.ts, and https support in cloudflare-output-contract.ts. The generator patch constructs a synthetic API-only binding in proof-node-backend-federation.mjs. That synthetic proof envelope must disappear.

Implement the actual API-only release contract in framework-owned envelope production. The ordinary envelope represents only declared and emitted surfaces; UI/SSR lists may be empty. Bind API output, backend manifest/container, build identity and hashes to one real build. Node and Cloudflare packaging and proof should consume that same contract. Do not solve headless deployment by skipping all release verification. Preserve full-stack checks unchanged. An undeclared AND absent surface is valid; a declared-but-missing surface, unexpected stamped surface, swapped identity or changed artifact must fail. Retain capability policy for Node builtins and explicitly validate https for the supported Cloudflare compatibility mode.

Provide cc-integration the updated proof-consumption call shape and remove the need for readApiOnlyReleaseBinding. Do not add a second API-only envelope schema or compatibility branch.

## Constraints

Own packages/solutions/app-tools-extensions/src/release-envelope/**, src/cloudflare/index.ts, src/cloudflare-output-verifier/**, src/cloudflare-output-contract.ts and their tests. If types already live in another fork-owned package, request an explicit ownership transfer before editing. Do not edit templates/workspace-scripts/proof-node-backend-federation.mjs: cc-integration owns it after this lane. No upstream-owned behavior growth without Rule 5 disposition and same-PR ledger evidence through the root owner.

## Operator Guidance

Independent at the initial frontier; run alongside cc-contract using existing source contracts. Route any proposed shared-config change to root. Prove API-only Node and Cloudflare artifacts and full-stack regression controls in existing suites. Negative controls must cover missing artifact, tampered hash, wrong revision, and declared-but-missing surface. One real fix may need a few meaningful tests; do not duplicate identical checks across every emitter format. Build all published formats and inspect packed behavior. Stop with no need for the app-tools consumer patch and an exact proof-script handoff.
