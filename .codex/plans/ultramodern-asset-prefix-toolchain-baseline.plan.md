---
name: ultramodern-asset-prefix-toolchain-baseline
overview: Fix the UltraModern generator so generated apps never leak localhost asset URLs in production, keep canonical site URLs separate from asset loading, remove stale or ambiguous env-var paths, support explicit root-relative or CDN asset prefixes, prove slash-safe CSS/static URL joining, and align the generated toolchain baseline to Node 26 plus the current latest pnpm without adding Zerops or platform-specific behavior.
todos:
  - id: claim-bead-and-freeze-scope
    content: Create or claim a Beads issue for the UltraModern-owned asset-prefix and toolchain-baseline bug, recording that ZCP provisioning, runtime secrets, platform proof evidence, preview iframe behavior, and Zerops cleanup protections are out of scope.
    status: completed
  - id: define-env-contract
    content: Define the generated config contract for MODERN_ASSET_PREFIX and ULTRAMODERN_ASSET_PREFIX, including precedence, accepted values, empty-string handling, root-relative / behavior, absolute CDN URL behavior, and fallback to / when no explicit asset prefix is configured.
    status: completed
  - id: audit-and-remove-legacy-env-vars
    content: Audit generated config, generated contracts, validators, docs, README/AGENTS templates, proof scripts, and changesets for stale, ambiguous, or unused env vars; remove legacy asset-loading fallbacks instead of carrying compatibility aliases that reintroduce siteUrl/assetPrefix confusion.
    status: completed
  - id: add-red-generator-tests
    content: Add focused generator or generated-workspace validation tests that fail while assetPrefix still falls back through MODERN_PUBLIC_SITE_URL or ULTRAMODERN_PUBLIC_URL_<APP_ID> instead of the dedicated asset-prefix envs.
    status: completed
  - id: implement-asset-prefix-split
    content: Update packages/toolkit/create/src/ultramodern-workspace.ts so generated modern.config.ts derives siteUrl only from MODERN_PUBLIC_SITE_URL, per-app public URL, inferred workers.dev, or localhost, while output.assetPrefix derives only from MODERN_ASSET_PREFIX, ULTRAMODERN_ASSET_PREFIX, inferred/explicit CDN-compatible asset input if retained by contract, or /.
    status: completed
  - id: update-contract-metadata
    content: Update .modernjs/ultramodern-generated-contract.json generation and its validator assertions so assetPrefix.envFallbackOrder records the dedicated asset-prefix envs and no longer lists MODERN_PUBLIC_SITE_URL as an asset fallback.
    status: completed
  - id: prove-slash-safe-css-urls
    content: Add server/runtime tests for Module Federation CSS and static asset URL resolution with publicPath or assetPrefix values of /, /static-base, absolute CDN origins, and trailing-slash variants, proving no localhost fallback and no //static... URLs.
    status: completed
  - id: align-toolchain-baseline
    content: Update generated packageManager, engines, mise/toolchain metadata, generated validator expectations, docs, and changesets to require Node >=26 and pin the latest pnpm available at implementation time, currently pnpm 11.5.3 from npm.
    status: completed
  - id: refresh-docs-and-changesets
    content: Update create package docs, generated workspace README/AGENTS guidance, and changesets to document MODERN_PUBLIC_SITE_URL as canonical/SEO-only and MODERN_ASSET_PREFIX or ULTRAMODERN_ASSET_PREFIX as the asset-loading control.
    status: completed
  - id: validate-fresh-scaffolds
    content: Build @modern-js/create, scaffold fresh shell-only and shell-plus-vertical workspaces, inspect generated modern.config.ts and generated contracts, and run contract checks showing assets default to / and explicit asset-prefix envs are honored.
    status: completed
  - id: run-quality-gates
    content: Run focused create tests, server/core Module Federation CSS/static tests, generated workspace contract checks, and any affected lint/typecheck gates before closing the Beads issue.
    status: completed
isProject: false
---

# ultramodern-asset-prefix-toolchain-baseline

## Execution Notes

Current evidence from validation:

- `packages/toolkit/create/src/ultramodern-workspace.ts` now defaults `output.assetPrefix` to `/` and keeps `dev.assetPrefix: '/'`, which fixes the worst localhost fallback.
- The generated `assetPrefix` expression still includes `configuredSiteUrl`, so `MODERN_PUBLIC_SITE_URL` can still drive asset loading.
- No generated code, contract metadata, docs, or tests mention `MODERN_ASSET_PREFIX` or `ULTRAMODERN_ASSET_PREFIX`.
- Generated contract assertions currently expect asset fallback order to include `MODERN_PUBLIC_SITE_URL`, so the validator blesses the incomplete split.
- This fix should delete obsolete or misleading env-var references as part of the contract change. Do not preserve legacy env aliases unless a real generated workflow still needs them and the plan records why.
- `packages/server/core/src/adapters/node/plugins/moduleFederationCss.ts` uses `new URL(asset, base)` and looks likely slash-safe, but tests do not cover `publicPath: '/'`.
- `npm view pnpm version` returned `11.5.3` during planning, matching the local active pnpm. The implementation should re-check latest pnpm before pinning.

Accepted direction:

- UltraModern owns generator correctness for host-agnostic assets.
- `MODERN_PUBLIC_SITE_URL` is canonical/public site URL for SEO, absolute links, sitemap, hreflang, and robots output.
- `MODERN_ASSET_PREFIX` or `ULTRAMODERN_ASSET_PREFIX` is the explicit control for JS/CSS/static asset loading.
- Production fallback for assets must be `/`, not `http://localhost:${port}` and not the canonical site URL.
- A self-hosted deploy must be able to set `ULTRAMODERN_ASSET_PREFIX=/` and get clean `/static/...` URLs.
- The toolchain baseline should move to Node 26+ and current latest pnpm.

## Constraints

- Do not add Zerops/ZCP provisioning, per-project `ZCP_API_KEY`, runtime secrets, remote gateway or Codex bridge proof code, platform delivery evidence, screenshot/pixel proof, localhost resource validators, Zerops cleanup protections, platform UI states, workspace readiness UI, or preview iframe logic.
- Do not patch generated apps with local shims, custom navigation wrappers, manual click interception, synthetic anchor handlers, local config suppressions, generated-file edits, or hook bypasses.
- Keep the fix in the owning framework/runtime/tooling layer.
- Preserve public URL behavior for canonical/hreflang/sitemap output.
- Preserve Cloudflare worker public URL behavior for deployment/proof flows unless that behavior is explicitly asset-loading-only.
- Do not add compatibility env aliases just to avoid touching generated docs or validators; stale env names should be removed when they no longer map to an owned behavior.
- Avoid introducing a broad deployment-provider abstraction for this bug.

## Operator Guidance

Suggested implementation sequence:

1. Start with tests that encode the desired env precedence and generated contract metadata. The strongest red test is a generated `modern.config.ts` assertion that `MODERN_PUBLIC_SITE_URL` does not appear in the asset-prefix fallback expression.
2. Implement the smallest generator change that introduces dedicated asset-prefix envs and updates the generated contract.
3. Add runtime URL-join tests for `/` before touching URL helpers. If the existing helper passes, keep the implementation unchanged and let the test document the behavior.
4. Update the Node/pnpm baseline in one pass across constants, generated package JSON, `.mise.toml`, generated contract, validator assertions, README/AGENTS text, and changesets.
5. Generate fresh workspaces after the code change, because inspecting templates alone will miss contract drift.

Recommended validation:

- `pnpm --filter @modern-js/create test`
- focused `packages/server/core` test for `moduleFederationCss.test.ts` and any static helper tests added
- fresh generated shell-only workspace `node scripts/validate-ultramodern-workspace.mjs`
- fresh generated shell-plus-vertical workspace `node scripts/validate-ultramodern-workspace.mjs`
- inspect generated `modern.config.ts` for no `MODERN_PUBLIC_SITE_URL` in the asset-prefix expression
- inspect generated contract JSON for asset prefix env fallback order

Use `plan-graph` on this single plan before launching agents. If split into subagents later, natural ownership lanes are generator/config contract, runtime URL tests, and docs/toolchain baseline.

## Completion Notes

- Generated asset loading now uses `MODERN_ASSET_PREFIX` -> `ULTRAMODERN_ASSET_PREFIX` -> `/`; canonical/public URL envs remain site/proof-only and are rejected from asset-prefix expressions.
- Generated root metadata, `.mise.toml`, CI workflow, Sandpack snapshot, contracts, validators, docs, and tests now align to Node `>=26` with Node `26.3.0` and pnpm `11.5.3`.
- Removed the generated CI `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env instead of carrying an unused legacy override.
- Focused gates passed: `pnpm --filter @modern-js/create test`, `pnpm --dir tests exec rstest run -c rstest.config.mts integration/create-ultramodern-workspace/tests/index.test.ts --passWithNoTests`, `pnpm --filter @modern-js/sandpack-react build`, `pnpm --dir packages/server/core exec rstest run tests/adapters/moduleFederationCss.test.ts --passWithNoTests`, and `node --test scripts/ultramodern-production-readiness/__tests__/browser-smoke.test.js`.
