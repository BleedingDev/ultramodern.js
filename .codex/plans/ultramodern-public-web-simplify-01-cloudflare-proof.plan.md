---
name: ultramodern-public-web-simplify-01-cloudflare-proof
overview: Deepen the Cloudflare public proof implementation by consolidating generated public-URL proof and local Worker validation behind one proof module with explicit public URL and local Worker adapters.
todos:
  - id: map-proof-interfaces
    content: Map the current generated proof script, local Cloudflare SSR validator, and Cloudflare deploy adapter response/security behavior to identify the stable proof interface and the two adapters it must support.
    status: pending
  - id: add-characterization-tests
    content: Add focused characterization coverage for the current proof assertions, including SSR HTML, security headers, preview noindex, CSS preload/assets, public surface assets, byte budgets, sourcemap policy, locale JSON, MF manifest, and Effect readiness.
    status: pending
  - id: extract-proof-module
    content: Extract reusable proof functions from generated script string code into an owned create-package proof module or generated helper source while preserving the generated script CLI and report JSON shape.
    status: pending
  - id: wire-public-url-adapter
    content: Rewire generated proof-cloudflare-version.mjs to use the shared proof module through a public URL adapter without changing CLI flags, env variables, report fields, or failure messages that tests depend on.
    status: pending
  - id: evaluate-local-worker-adapter
    content: Evaluate whether scripts/ultramodern-cloudflare-ssr-validation can reuse the same proof module through a local Worker adapter; implement only the behavior-preserving portion inside the current scope.
    status: pending
  - id: validate-proof-refactor
    content: Run create-package tests, create-ultramodern integration tests, and any local Cloudflare SSR validation tests touched by the extraction.
    status: pending
isProject: false
---

# ultramodern-public-web-simplify-01-cloudflare-proof

## Execution Notes

This is the top recommendation from the architecture review. The current public URL proof lives inside a generated script string in `packages/toolkit/create/src/ultramodern-workspace.ts`. Similar response/security evidence logic already exists in `scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js`, while the runtime behavior being proved is implemented by `packages/solutions/app-tools/src/plugins/deploy/platforms/templates/cloudflare-entry.mjs`.

The desired refactor is a deeper proof module: one interface for evidence, budgets, public surface checks, security/indexing checks, and marker checks; adapters provide either public URL fetches or local Worker fetches. The deletion test should pass: deleting the module would force proof details back into generated scripts and local validators.

## Constraints

Preserve the public generated CLI contract: `scripts/proof-cloudflare-version.mjs`, `--app`, `--out`, `--require-public-urls`, `ULTRAMODERN_PUBLIC_URL_<APP>`, report schema version, and assertion type names. Do not weaken any check added in the public website smoke gate work. Do not add a new dependency. Do not rewrite the Cloudflare deploy adapter unless a tiny reuse extraction is required and covered by tests.

ADR-0016 still applies: performance readiness stays diagnostic/proof-oriented, not a broad certification engine. CSP remains report-only dogfood unless a separate accepted decision changes that.

## Operator Guidance

Run this lane first. It creates the best seam for the other lanes and removes the highest maintenance risk: large generated proof logic inside a string template.

Suggested verification: `pnpm --dir tests exec rstest run integration/create-ultramodern-workspace/tests/index.test.ts`, `pnpm --filter @modern-js/create test`, and any touched `scripts/ultramodern-cloudflare-ssr-validation` tests. Use subagents only after this graph is validated; if used, split one worker for characterization tests and one worker for extraction, with disjoint write scopes.
