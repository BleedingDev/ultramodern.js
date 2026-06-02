---
name: ultramodern-production-02-browser-smoke
overview: Add browser-level smoke validation for freshly generated UltraModern SuperApps so the published-create proof verifies real navigation, assets, manifests, and runtime composition instead of stopping at install, check, and build.
todos:
  - id: research-generated-browser-contracts
    content: Re-read the generated workspace output from `packages/toolkit/create/src/ultramodern-workspace.ts`, the published proof harness in `scripts/ultramodern-production-readiness/run-published-create-proof.mjs`, and the existing portfolio browser tests to define the stable routes, selectors, manifests, asset URLs, and console-error rules that a generated SuperApp must satisfy.
    status: pending
  - id: extract-browser-smoke-helper
    content: Add a reusable browser smoke helper under `scripts/ultramodern-production-readiness` that can launch a generated workspace, visit the shell and vertical routes, assert localized navigation works through framework router primitives, capture console/page errors, and verify static store/assets and federation manifests load with 2xx responses.
    status: pending
  - id: wire-local-generated-proof
    content: Integrate the browser smoke helper into `run-published-create-proof.mjs` after `pnpm build`, using the generated app's own serve/start scripts and keeping failures actionable with artifacts for logs, screenshots, response failures, and the generated workspace location.
    status: pending
  - id: wire-public-url-proof
    content: Extend the optional `--deploy-cloudflare` path so `pnpm cloudflare:proof -- --require-public-urls` also runs the same browser smoke assertions against deployed shell and vertical public URLs when Cloudflare credentials are provided.
    status: pending
  - id: add-regression-coverage
    content: Add unit or integration coverage for the smoke runner contract, including success, route failure, missing asset, missing manifest, and browser-console-error cases without relying on app-level shims or generated-file edits.
    status: pending
  - id: ci-artifacts-and-docs
    content: Update `.github/workflows/ultramodern-production-readiness.yml` and generated/operator docs so browser proof artifacts are uploaded and failures point maintainers to the exact route, request, or runtime error that broke.
    status: pending
isProject: false
---

# Production Point 2: Browser Smoke

## Research Basis

- `scripts/ultramodern-production-readiness/run-published-create-proof.mjs` already resolves `@bleedingdev/modern-js-create@latest`, scaffolds a SuperApp workspace, installs dependencies, runs `pnpm check`, and runs `pnpm build`.
- `.github/workflows/ultramodern-production-readiness.yml` already runs the published-create proof after publish, on schedule, and manually; it also has an optional Cloudflare deploy/proof job when credentials are available.
- `tests/integration/superapp-portfolio/tests/browser-runtime.test.ts` and `browser-runtime-matrix.test.ts` show existing Playwright/Puppeteer-style runtime coverage for static fixtures.
- Generated workspaces include Cloudflare proof scripts and route/module contracts from `packages/toolkit/create/src/ultramodern-workspace.ts`, but current published-create proof does not open the generated app in a browser.

## Constraints

- Do not hide framework defects in generated apps. Browser proof must use generated commands and native framework/router primitives.
- Keep the smoke assertions stable enough for CI: route reachability, asset/manifests, no fatal console/page errors, and basic composition are the goal; detailed visual testing belongs elsewhere.
- The same helper should support local generated proof and deployed public URL proof so CI and operator validation do not drift.

## Done Means

- A freshly generated SuperApp is browser-smoked locally in CI before the production-readiness workflow can pass.
- Optional Cloudflare deploy proof uses the same browser contract against public URLs.
- Failures produce enough artifacts to debug without re-running blindly.
