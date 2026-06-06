---
name: ultramodern-active-02-generated-proof
overview: Prove that fresh UltraModern generated apps work from the cleaned framework defaults across local source, install-backed package cohorts, browser SSR, no-JS rendering, Cloudflare output, and published-create validation without any app-local patches.
todos:
  - id: regenerate-clean-reference-workspaces
    content: "Generate clean shell-only and shell-plus-vertical UltraModern workspaces, plus the relevant single-app variants, from the current local source after the blocker plan is green; remove stale generated fixtures before regenerating so evidence cannot pass because of old files."
    status: pending
  - id: run-generated-quality-gates
    content: "Run generated format, lint, typecheck, build, ultramodern validation, BFF routes, route metadata checks, package-source assertions, and MF topology checks for the regenerated apps."
    status: pending
  - id: prove-browser-ssr-mf-css
    content: "Run browser smoke with JavaScript enabled and disabled for shell and vertical routes, verify SSR content and styles are present before hydration, and prove shell composition has no remoteEntry page errors or runtimeContext ReferenceError."
    status: pending
  - id: prove-cloudflare-output
    content: "Run Cloudflare build/output validation and wrangler-based checks where available, including Worker SSR shape, asset serving, public URL enforcement, Effect BFF readiness routes, and no local Worker shim dependencies."
    status: pending
  - id: prove-published-create-cohort
    content: "After a trusted BleedingDev npm cohort exists, run the published-create proof against that exact @bleedingdev/modern-js-create version and confirm generated metadata, package-source records, lockfile dependencies, and validation scripts agree with the published cohort."
    status: pending
  - id: capture-evidence-and-close-generated-umbrella
    content: "Archive command outputs, browser artifacts, Cloudflare proof files, and scaffold comparison notes; update Beads with the evidence and close modernjs-41je only after all blockers and generated proof are green."
    status: pending
isProject: false
---

# ultramodern-active-02-generated-proof

## Execution Notes

Beads issue: `modernjs-41je`.

This plan replaces the stale assumption that generated validation is merely in progress. Current evidence says it is still blocked by `modernjs-3z51`, `modernjs-zhaq`, `modernjs-zum6`, and `modernjs-41je.1`; do not run this as a closeout gate until the blocker plan has landed.

The proof target is a fresh scaffold, not Tractor. A generated app must work with the same framework-owned capabilities Tractor needs before the demo cleanup begins.

## Constraints

- Do not weaken generated lint, typecheck, package-source, route, or browser-smoke validators to make the proof pass.
- Do not validate runtime behavior by source-code string search when browser or server evidence is available.
- Do not keep stale generated output, stale `.output`, stale `dist`, `.mf`, or `@mf-types` artifacts between proof runs.
- Do not publish or deploy from upstream `origin`; use BleedingDev-owned package and remote flows only.

## Operator Guidance

Prefer local-source proof first, then install-backed proof, then published-create proof. If Cloudflare or wrangler validation fails because the framework output is wrong, route the fix back into Modern app-tools/runtime rather than adding generated app aliases or Worker shims.

Successful completion should make `modernjs-41je` closable and unblock the Tractor cleanup umbrella. Keep `modernjs-a6d4` deferred; resilience/performance certification is a separate later graph.
