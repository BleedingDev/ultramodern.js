---
name: ultramodern-active-03-tractor-cleanup
overview: Update the Tractor demo to the proven UltraModern npm cohort and remove remaining demo-local framework patches so only product-specific UI, content, routes, worker names, domains, data, and translations remain.
todos:
  - id: refresh-demo-to-proven-cohort
    content: "Update the Tractor demo dependencies, lockfile, .modernjs package-source metadata, workspace template manifest, generated contract, and topology records to the exact proven BleedingDev npm cohort from generated proof, not a guessed version."
    status: pending
  - id: delete-worker-shims-and-aliases
    content: "Remove demo-local Cloudflare Worker shims and bundler aliases for fs/promises, path, and @loadable/component only after Modern app-tools Cloudflare output proves those imports are framework-owned."
    status: pending
  - id: remove-css-boundary-workarounds
    content: "Delete hardcoded remote CSS links, shellStylesheetPlugin-style plumbing, filenameHash=false, legacy data-mf-* validation, and local boundary overlay code when generated MF CSS SSR and current data-modern-* contracts prove the framework covers them."
    status: pending
  - id: reconcile-i18n-and-contracts
    content: "Replace duplicated inline i18n runtime resources with the current generated-style JSON resource pattern while preserving Tractor translations, then reconcile generated contracts and topology with actual SSR, public URL, Cloudflare, route, and vertical metadata."
    status: pending
  - id: run-demo-local-gates
    content: "Run Tractor pnpm install, format:check, lint, typecheck, skills:check, ultramodern:check, check, build, and browser/no-JS proof against the cleaned demo with no bridgeRouterAlias output and no restored app-level shims."
    status: pending
  - id: deploy-and-proof-tractor
    content: "Run Cloudflare build, wrangler deploy where credentials and public URL envs are available, cloudflare:proof, security probes, and public URL proof; archive the logs and proof JSON for the cleaned cohort."
    status: pending
  - id: push-demo-and-close-tractor-issues
    content: "Commit and push the Tractor demo cleanup to the correct BleedingDev remote, update Beads with proof locations, close modernjs-u3xw.1 after cleanup proof is green, then close modernjs-u3xw once generated validation remains green."
    status: pending
isProject: false
---

# ultramodern-active-03-tractor-cleanup

## Execution Notes

Beads issues: `modernjs-u3xw.1`, then `modernjs-u3xw`.

This lane must wait for generated proof. Tractor should validate framework-owned behavior on a real app, not carry framework patches that make the demo look healthier than the generator.

Known cleanup targets in `/Users/satan/side/experiments/tractor-store-vertical-demo-publish-clean` include `tools/cloudflare-worker-shims/*`, Worker aliases and `filenameHash=false` in shell and vertical `modern.config.ts` files, local boundary overlay files, legacy `data-mf-*` validation and components, duplicated runtime i18n resources, stale `.modernjs` metadata, stale topology/contract files, and ignored build artifacts such as `.output`, `dist`, `.mf`, and `@mf-types`.

Framework-owner references to check before deleting demo patches:

- Cloudflare-compatible `@loadable/component`, `fs`, and `path` handling belongs in `packages/solutions/app-tools/src/builder/generator/getBuilderEnvironments.ts`.
- Generated MF CSS ownership starts in `packages/toolkit/create/src/ultramodern-workspace.ts`; server/runtime collection and injection live in `packages/server/core/src/adapters/node/plugins/resource.ts` and `packages/runtime/plugin-runtime/src/core/server/string/loadable.ts`.
- Generated JSON i18n resources belong in `packages/toolkit/create/src/ultramodern-workspace.ts`; locale serving belongs in `packages/runtime/plugin-i18n/src/cli/index.ts`.
- Boundary/debug markers should follow generated/runtime `data-modern-*` contracts, not demo-local legacy `data-mf-*` validation.

## Constraints

- Do not restore demo-local aliases, hardcoded CSS preload links, synthetic navigation wrappers, validation suppressions, generated-file edits, or local Worker shims if cleanup exposes a framework defect.
- Demo-owned differences are product UI, routes, content, translations, public domains, Worker names, assets, data, and business readiness behavior.
- Framework-owned differences must be fixed in Modern.js first, then consumed by Tractor through the proven package cohort.
- Wrangler deploy requires public URL envs; do not claim deploy proof if required subdomain or app-specific public URLs are missing.

## Operator Guidance

Run this from the Tractor repository after the Modern package cohort has been published and generated proof is green. Compare the cleaned demo against a fresh scaffold to justify any remaining config differences. If a removal step fails because generated defaults are incomplete, return to the Modern plan and remove the demo patch only after the framework fix is proven. Close the parent `modernjs-u3xw` only after `modernjs-41je` stays green and `modernjs-u3xw.1` is closed with evidence.
