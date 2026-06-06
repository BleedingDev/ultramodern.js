---
name: ultramodern-active-01-generated-blockers
overview: Remove the current blockers to fresh UltraModern generated-app validation by consolidating duplicated package policy, making effect-tsgo the primary checker, aligning install-backed package cohorts, settling the generated Effect dependency contract, and fixing the shell MF browser smoke failure in the owning framework/runtime layer.
todos:
  - id: consolidate-generated-package-policy
    content: "Map package-source, generated dependency, and proof-script policy across packages/toolkit/create/src/ultramodern-workspace.ts, packages/toolkit/create/src/index.ts, packages/toolkit/create/template/package.json.handlebars, packages/toolkit/create/template-workspace, and scripts/ultramodern-production-readiness/run-published-create-proof.mjs; extract or reuse a single policy source where it removes drift, and delete duplicate constants or assertions instead of adding another special case."
    status: pending
  - id: make-effect-tsgo-primary
    content: "Fix modernjs-zum6 by making tsgo/effect-tsgo the create-package source of truth: remove tsconfig options rejected by the active native checker, align @effect/tsgo versions where required, and avoid legacy TypeScript 6 compatibility shims, suppressions, or fallback check paths."
    status: pending
  - id: align-install-backed-cohort
    content: "Fix modernjs-3z51 by making install-backed single-app and workspace generation use a published, installable BleedingDev cohort consistently in generated manifests, dependency specifiers, package-source metadata, and published-create proof expectations."
    status: pending
  - id: settle-effect-dependency-contract
    content: "Fix modernjs-zhaq by tracing generated Effect BFF imports through @modern-js/plugin-bff/effect-* and the plugin-bff package boundary; add a direct generated effect dependency only if generated app packages own that runtime import, keep the version aligned with framework policy, and validate both single-app and workspace output."
    status: pending
  - id: fix-shell-mf-browser-smoke
    content: "Fix modernjs-41je.1 by reproducing the shell-super-app page errors from remoteEntry.js and the runtimeContext ReferenceError, then landing the fix in the Modern MF/runtime/template owner rather than browser-smoke suppressions, generated-app shims, custom navigation wrappers, or demo-local patches."
    status: pending
  - id: run-blocker-gates
    content: "Run the targeted blocker gates: pnpm validate:tsgo; node --test scripts/ultramodern-production-readiness/__tests__/browser-smoke.test.js scripts/ultramodern-production-readiness/__tests__/published-create-proof.test.js; node --test scripts/ultramodern-publish/__tests__/source-create-proof.test.js scripts/ultramodern-publish/__tests__/prepare-bleedingdev-packages.test.js; and the focused create/BFF/MF integration suites touched by the fixes."
    status: pending
isProject: false
---

# ultramodern-active-01-generated-blockers

## Execution Notes

Beads issues: `modernjs-3z51`, `modernjs-zhaq`, `modernjs-zum6`, `modernjs-41je.1`.

This lane exists to make the generated-validation lane boring. Do not start by widening generated proof scripts or relaxing validators. First remove policy drift: package-source mapping currently appears in generator code, CLI code, templates, and proof scripts; checker policy is also split between root scripts, create package config, and generated template scripts.

`modernjs-zum6` follows the explicit owner decision: prefer `tsgo` or `effect-tsgo` over legacy TypeScript 6 behavior. Do not add compatibility shims, generated suppressions, or fallback-to-legacy lanes.

`modernjs-41je.1` is a real browser/runtime failure, not only stale smoke evidence. Treat `should have __webpack_require__.f.consumes` and `runtimeContext is not defined` as framework or MF/runtime ownership until proven otherwise.

## Constraints

- Do not push or publish to upstream `origin`.
- Do not add app-level shims, local validation suppressions, demo-only aliases, synthetic click handlers, route wrappers, or one-off generated patches.
- Do not add another duplicated package version map if an existing one can be centralized or deleted.
- Do not make generated app authors install extra packages unless the generated code actually owns the import boundary.
- Keep source and generated validation aligned; tests should fail when metadata and dependency cohorts drift.

## Operator Guidance

Suggested order: consolidate policy first, then make `effect-tsgo` authoritative, then align install-backed package cohorts, then settle the `effect` dependency, then fix the MF browser failure. If the MF fix uncovers a lower-level runtime bug, file or update the owning Bead rather than masking it in the generated app.

Use narrow gates after each blocker and rerun the complete blocker gate set before moving to generated proof. Successful completion should unblock `modernjs-41je` but should not close it until the next plan proves the full generated matrix.
