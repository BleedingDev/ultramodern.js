---
name: ultramodern-opinionated-defaults-01-template-security
overview: Add strict UltraModern security defaults and typed escape hatches while integrating with the separate starter-correctness lane instead of duplicating generated-template accessibility work.
todos:
  - id: audit-security-default-owners
    content: Audit server, app-tools, create templates, Cloudflare deployment templates, and runtime header paths to identify the correct owner for each accepted security default.
    status: pending
  - id: define-security-header-contract
    content: Define the strict default security header contract for Referrer-Policy, X-Content-Type-Options, Permissions-Policy, frame-ancestors, CSP starter policy, secure cookie production behavior, and non-production noindex.
    status: pending
  - id: add-security-header-defaults
    content: Implement the framework-owned security header defaults in the correct server/deploy/template owners without adding app-level shims or broad webSpec/profile config.
    status: pending
  - id: implement-security-escape-hatches
    content: Add typed escape hatches for valid embedding, CSP report-only/disable, third-party script origins, legacy widgets, enterprise SSO, and viewport zoom exceptions with explicit documented reasons.
    status: pending
  - id: integrate-with-starter-correctness
    content: Coordinate with ultramodern-starter-web-correctness so generated starters use the security defaults and document viewport/a11y exceptions without duplicating template correctness implementation in this lane.
    status: pending
  - id: add-security-default-tests
    content: Add focused server/header/deploy/template tests proving defaults are present, escape hatches work, and production behavior does not leak unsafe defaults into new apps.
    status: pending
  - id: document-template-security-defaults
    content: Document which security items are framework defaults, which starter items live in ultramodern-starter-web-correctness, and how teams opt out without app-level shims or click interception.
    status: pending
isProject: false
---

# ultramodern-opinionated-defaults-01-template-security

## Execution Notes

Beads issue: `modernjs-fikq`.

This lane covers strict security defaults and their integration with the starter-correctness lane. It intentionally avoids the rejected broad `webSpec` config idea.

Starter correctness details belong in `ultramodern-starter-web-correctness.plan.md` under Beads issue `modernjs-5dic`. This lane should not duplicate that work, but security defaults and documented dangerous opt-outs must line up with it.

## Constraints

- Do not enforce arbitrary heading hierarchy, color contrast, or complex app UI accessibility as a default build blocker.
- Do not duplicate the starter correctness implementation covered by `ultramodern-starter-web-correctness`.
- Do not add app-level wrappers, generated-file hacks, or local config suppressions.
- Keep security escape hatches explicit and reviewable.
- Preserve existing Modern.js config compatibility where possible.

## Operator Guidance

Depends on `ultramodern-opinionated-defaults-00-contract`.

Useful local starting points:

- `packages/solutions/app-tools/src/config/default.ts`
- `packages/solutions/app-tools/src/plugins/analyze/templates.ts`
- server/header ownership in `packages/server` and app-tools server config

Run generated starter validation and focused server/header tests before broad integration tests.
