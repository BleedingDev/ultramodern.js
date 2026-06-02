---
name: ultramodern-production-04-framework-polish
overview: Remove framework-owned rough edges that still leak into generated SuperApps or operator flows, starting with the open `bridgeRouterAlias` debug output and Cloudflare proof/deploy diagnostics, without adding app-level workarounds.
todos:
  - id: triage-open-polish-defects
    content: Inspect bead `modernjs-muza`, recent generated build logs, and `rg bridgeRouterAlias` owners to identify exactly where debug output or noisy warnings originate and whether the fix belongs in module federation runtime, router integration, generator code, or release tooling.
    status: completed
  - id: remove-bridge-router-debug-leak
    content: Fix the owning framework/runtime/tooling layer so `bridgeRouterAlias` and related router bridge internals are not printed during normal generated app build or proof runs, preserving useful diagnostics behind an explicit debug flag if needed.
    status: completed
  - id: improve-cloudflare-env-diagnostics
    content: Rework generated Cloudflare deploy/proof diagnostics in `packages/toolkit/create/src/ultramodern-workspace.ts` so missing environment, account, route, or secret configuration errors are concise, ordered, and tell operators what to set without masking deployment failures.
    status: pending
  - id: normalize-proof-log-noise
    content: Review `scripts/ultramodern-production-readiness/run-published-create-proof.mjs`, generated proof scripts, and release workflows for non-actionable log noise, duplicate warnings, or stale version text, then simplify the output contract.
    status: pending
  - id: add-log-regression-tests
    content: Add regression tests that fail if normal scaffold/build/proof output contains known debug dumps, local suppressions, app-level shims, or generated-file patches used to hide framework behavior.
    status: completed
  - id: close-polish-beads-with-evidence
    content: Update and close the related beads only after local proof and CI evidence show the noisy output is gone and the generated operator errors remain actionable.
    status: pending
isProject: false
---

# Production Point 4: Framework Polish

## Research Basis

- Bead `modernjs-muza` tracks the remaining `bridgeRouterAlias` debug output follow-up.
- `packages/toolkit/create/src/ultramodern-workspace.ts` owns generated Cloudflare deploy/proof scripts and generated validation contracts.
- `scripts/ultramodern-production-readiness/run-published-create-proof.mjs` is now the main operator-facing proof harness for published packages.
- Project instructions forbid demo/app shims, generated-file edits, synthetic navigation handlers, and local suppressions. Fixes must land in the framework/runtime/tooling owner.

## Constraints

- Do not reduce diagnostic value by swallowing real errors; polish means concise and actionable, not silent.
- Do not customize Tractor or generated demo apps to hide framework behavior.
- Keep any debug logging opt-in and test that normal generated proofs stay clean.

## Done Means

- The open router/debug-output issue is fixed in its owner and covered by regression tests.
- Cloudflare/generated proof failures are understandable without reading source code.
- The generated SuperApp proof output is quiet enough for humans to scan in CI.
