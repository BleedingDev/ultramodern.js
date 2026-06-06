---
name: ultramodern-active-02-generated-proof
overview: Prove that fresh UltraModern generated apps work from the cleaned framework defaults across local source, install-backed package cohorts, browser SSR, explicit no-JS rendering, Cloudflare output, and published-create validation without any app-local patches.
todos:
  - id: regenerate-clean-reference-workspaces
    content: "Generate clean references from current local source into fresh temp dirs only: single-app tanstack/effect, react-router/hono, --no-tailwind, --sub, workspace source mode, install-backed alias mode, workspace shell-only, and workspace shell-plus-vertical; remove stale .output, dist, .mf, @mf-types, lockfile, and generated artifacts before each proof run."
    status: pending
  - id: run-generated-quality-gates
    content: "Run repo-level pnpm validate:tsgo and focused create integration suites, then run mise install, pnpm install, generated pnpm ultramodern:check or pnpm check, and MODERN_PUBLIC_SITE_URL=http://localhost:8080 pnpm build inside each regenerated app/workspace."
    status: pending
  - id: prove-browser-ssr-mf-css
    content: "Run run-browser-smoke local proof for shell and vertical routes, add an explicit javaScriptEnabled=false no-JS SSR browser check, verify SSR content/styles before hydration, and prove shell composition has no remoteEntry page errors, failed same-origin responses, bridgeRouterAlias output, or runtimeContext ReferenceError."
    status: pending
  - id: prove-cloudflare-output
    content: "Run generated Cloudflare build/output validation and wrangler-based checks where credentials and public URL envs are available: Worker SSR shape, asset serving, public URL enforcement, Effect BFF readiness routes, cloudflare:proof -- --require-public-urls, and no local Worker shim dependencies."
    status: pending
  - id: prove-published-create-cohort
    content: "After a trusted BleedingDev npm cohort exists, run run-published-create-proof.mjs against the exact @bleedingdev/modern-js-create version, at least erp-10 and broader erp-25/erp-50 when time allows, and confirm generated metadata, package-source records, lockfile dependencies, topology evidence, and validation scripts agree with the published cohort."
    status: pending
  - id: capture-evidence-and-close-generated-umbrella
    content: "Archive command outputs, browser artifacts, Cloudflare proof files, and scaffold comparison notes; update Beads with the evidence and close modernjs-41je only after all blockers and generated proof are green."
    status: pending
isProject: false
---

# ultramodern-active-02-generated-proof

## Execution Notes

Beads issue: `modernjs-41je`.

This plan is now the active `modernjs-41je` lane. The former blockers `modernjs-3z51`, `modernjs-zhaq`, `modernjs-zum6`, `modernjs-41je.1`, and `modernjs-9kxf` are closed; do not wait on the old blocker note.

The proof target is a fresh scaffold, not Tractor. A generated app must work with the same framework-owned capabilities Tractor needs before the demo cleanup begins. Treat this as a three-layer proof: generator contract tests, generated app self-checks/builds, then runtime/browser/Cloudflare/published proof.

Concrete codebase entrypoints:

- Single-app generation and package-source metadata: `packages/toolkit/create/src/index.ts` and `packages/toolkit/create/src/ultramodern-package-source.ts`.
- Workspace generation, generated validators, and add-vertical flow: `packages/toolkit/create/src/ultramodern-workspace.ts`.
- Single-app generated contracts: `packages/toolkit/create/template/package.json.handlebars` and `packages/toolkit/create/template/scripts/validate-ultramodern.mjs.handlebars`.
- Repo integration gates: `tests/integration/create-tailwind/tests/index.test.ts`, `tests/integration/create-bff-runtime/tests/index.test.ts`, and `tests/integration/create-ultramodern-workspace/tests/index.test.ts`.
- Runtime proof scripts: `scripts/tsgo-critical.mjs`, `scripts/ultramodern-production-readiness/run-browser-smoke.mjs`, and `scripts/ultramodern-production-readiness/run-published-create-proof.mjs`.

## Constraints

- Do not weaken generated lint, typecheck, package-source, route, or browser-smoke validators to make the proof pass.
- Do not validate runtime behavior by source-code string search when browser or server evidence is available.
- Do not keep stale generated output, stale `.output`, stale `dist`, `.mf`, or `@mf-types` artifacts between proof runs.
- Do not publish or deploy from upstream `origin`; use BleedingDev-owned package and remote flows only.

## Operator Guidance

Prefer local-source proof first, then install-backed proof, then published-create proof. Useful repo commands are `pnpm validate:tsgo`, `pnpm --dir tests exec rstest run integration/create-tailwind/tests/index.test.ts integration/create-bff-runtime/tests/index.test.ts integration/create-ultramodern-workspace/tests/index.test.ts`, `node scripts/ultramodern-production-readiness/run-browser-smoke.mjs --project-dir <workspace> --mode local --out <report>`, and `node scripts/ultramodern-production-readiness/run-published-create-proof.mjs --create-package @bleedingdev/modern-js-create@<exact> --scale-profile erp-10 --out <proof.json>`.

If Cloudflare or wrangler validation fails because the framework output is wrong, route the fix back into Modern app-tools/runtime rather than adding generated app aliases or Worker shims. Do not close `modernjs-41je` from integration tests alone; close it only after command output, generated app artifacts, browser reports, Cloudflare/public proof where applicable, and published-create evidence are archived and linked in Beads.

Successful completion should make `modernjs-41je` closable and unblock the Tractor cleanup umbrella. Keep `modernjs-a6d4` deferred; resilience/performance certification is a separate later graph.
