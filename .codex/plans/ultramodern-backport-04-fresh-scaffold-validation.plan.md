---
name: ultramodern-backport-04-fresh-scaffold-validation
overview: Validate the backports from the point of view of a human scaffolding a brand-new repository, adding verticals, deploying, and testing SSR visually instead of relying on source-code content checks.
todos:
  - id: scaffold-new-repository
    content: Scaffold a completely new repository using the UltraModern preset and the documented human workflow, without copying the Tractor Store demo from the framework repository.
    status: pending
  - id: add-new-verticals
    content: Add at least one new MicroVertical through the supported tooling and verify the generated vertical includes UI, route integration, BFF/API capability, i18n, and CSS isolation.
    status: pending
  - id: verify-ssr-no-js
    content: Build and run the generated app, disable JavaScript in the browser, and verify full styled page content renders without fallback warnings.
    status: pending
  - id: verify-language-switching
    content: Test language switching across routes, reloads, and hydration, including debug boundary persistence and complete localized copy.
    status: pending
  - id: verify-boundary-debugger
    content: Test the native boundary debugger off and on with screenshots, confirming it stays fixed in the viewport and draws non-overlapping meaningful ownership regions.
    status: pending
  - id: verify-cloudflare-deploy
    content: Deploy the fresh scaffold to Cloudflare Workers or a preview equivalent, capture the deployed URL, and validate routing, SSR, assets, and styles from the deployed environment.
    status: pending
  - id: produce-visual-proof
    content: Capture browser screenshots for desktop and a narrower viewport using agent-browser or webwright, and record what was visually compared against expected behavior.
    status: pending
isProject: false
---

# ultramodern-backport-04-fresh-scaffold-validation

## Execution Notes

This lane proves the framework changes in the same workflow a user will follow: create a new project, work on it, add verticals, run it, disable JavaScript, switch languages, inspect boundaries, and deploy. It should not validate by searching source code for product text.

The validation app can be simple, but it must exercise the important framework capabilities: shell plus verticals, SSR, i18n, CSS isolation, BFF/API capability, Cloudflare deployment, and native boundary debugging.

## Constraints

Do not keep the validation app inside the Modern.js repository as product demo pollution. Use temporary workspace output or a separate demo repository when a persistent artifact is needed. Do not publish packages locally.

## Operator Guidance

Depends on `ultramodern-backport-01-css-i18n-routing`, `ultramodern-backport-02-cloudflare-packages`, and `ultramodern-backport-03-native-boundaries`. This lane is the release gate before trusted package publishing.
