---
name: ultramodern-opinionated-defaults-01-template-security
overview: Harden UltraModern Cloudflare Module Federation SSR security defaults with a typed Cloudflare-first policy contract, response-header adapter, CSP/MF compatibility proof, production cookie/noindex boundaries where owned, and explicit escape hatches. Node, Netlify, and other deployment platforms are out of scope for this lane.
todos:
  - id: inspect-cloudflare-security-surfaces
    content: Map generated Cloudflare SSR output, Worker response paths, Module Federation manifests/assets, locale JSON/public assets, proof scripts, and existing security.nonce config to identify exactly where the framework/deploy layer owns security headers and where it must not mutate app behavior.
    status: completed
  - id: define-cloudflare-security-policy-contract
    content: Define the Cloudflare MF SSR security policy and typed escape hatches for Referrer-Policy, X-Content-Type-Options, Permissions-Policy, CSP including frame-ancestors, non-production noindex, secure production cookie handling where owned, report-only/disable modes, embedded apps, enterprise SSO, legacy widgets, and additional script/connect origins.
    status: completed
  - id: implement-cloudflare-security-adapter
    content: Implement a Cloudflare-focused adapter that renders the policy into Worker SSR/static/MF response headers without app-level shims, preserving remote manifest/script/style/connect loading and existing trust/telemetry behavior.
    status: completed
  - id: wire-generated-cloudflare-defaults
    content: Wire the Cloudflare security policy into UltraModern generated workspace config/contracts/proof metadata for MODERNJS_DEPLOY=cloudflare, keeping Node, Netlify, and other deployment platforms unchanged and out of scope.
    status: completed
  - id: add-cloudflare-mf-ssr-security-tests
    content: Add tests/proofs for Worker SSR headers, MF manifest/assets, locale JSON, CSP allowances, frame embedding escape hatches, non-production noindex, report-only/disable behavior, explicit reasons for escape hatches, and no breakage of Cloudflare MF SSR remote loading.
    status: completed
  - id: document-cloudflare-security-boundary
    content: Document the Cloudflare-only scope, defaults, escape hatches, unsupported platform boundary, and validation commands without introducing webSpec/profile config or generated app suppressions.
    status: completed
isProject: false
---

# ultramodern-opinionated-defaults-01-template-security

## Execution Notes

Beads issue: `modernjs-fikq`.

Accepted narrowed scope: Cloudflare Module Federation SSR is the only implementation target for this lane. Node, Netlify, and other Modern.js-supported deployments are intentionally out of scope until a later issue/plan explicitly adds platform adapters for them.

The goal is to harden the framework/deploy/template-owned Cloudflare path without claiming universal platform support. Current repo context shows Cloudflare-specific generation and proof code in `packages/toolkit/create/src/ultramodern-workspace.ts`, including `MODERNJS_DEPLOY=cloudflare`, Worker deploy metadata, MF manifest checks, locale JSON checks, CORS checks, CSS preload link-header checks, and the generated `scripts/proof-cloudflare-version.mjs`. Existing server security config is still minimal and nonce-only, so the first implementation step must map ownership before adding policy surface.

This plan should coordinate with `modernjs-04jb` only at the boundary where non-production noindex/disallow behavior intersects generated public-surface output. It should not implement robots, sitemap, manifest, `llms.txt`, API catalog, JSON-LD, or broader starter correctness.

## Constraints

- Cloudflare MF SSR is the compatibility target. Do not modify Node, Netlify, or other platform behavior in this lane.
- Do not block Module Federation remote manifests, remote scripts, remote styles, asset loading, locale JSON, CORS behavior required by generated workspaces, or existing trust/telemetry contracts.
- Do not add app-level wrappers, generated-file hacks, synthetic event interception, local config suppressions, hook bypasses, or demo-only shims.
- Do not introduce a broad `webSpec`, profile, certification, or agent-readiness engine.
- Keep escape hatches typed, explicit, and reviewable. Dangerous opt-outs should require a reason string or similarly auditable intent.
- Prefer report-only and additive policy hardening while proving compatibility before enforcing strict CSP on generated Cloudflare MF SSR output.
- Do not claim support for unsupported platforms. Documentation must say this lane is Cloudflare-only.

## Operator Guidance

Depends on `ultramodern-opinionated-defaults-00-contract`.

Useful local starting points:

- `packages/toolkit/create/src/ultramodern-workspace.ts`
- `packages/server/core/src/types/config/security.ts`
- `scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js`
- `scripts/ultramodern-zephyr-ssr-upload/upload-zephyr-ssr.js`
- `scripts/ultramodern-production-readiness/run-browser-smoke.mjs`

Recommended first frontier: start with `inspect-cloudflare-security-surfaces`. Do not implement headers until the Worker response ownership, generated config surface, and MF asset/CSP allowances are mapped. After implementation, expected validation should include generated workspace contract tests, Cloudflare SSR proof-script assertions, focused policy/adapter unit tests, and regression coverage proving MF SSR remotes still load.
