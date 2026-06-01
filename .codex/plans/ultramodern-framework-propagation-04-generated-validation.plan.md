---
name: ultramodern-framework-propagation-04-generated-validation
overview: Prove that the strengthened framework defaults work by scaffolding fresh UltraModern apps and validating SSR, JS-disabled rendering, i18n, boundaries, CSS isolation, Cloudflare deploy output, and Effect BFF behavior without Tractor-specific patches.
todos:
  - id: regenerate-reference-workspaces
    content: "Create fresh UltraModern reference workspaces from local framework code for shell-only and shell-plus-vertical configurations."
    status: pending
  - id: validate-monolith-start-path
    content: "Verify users can start with a simple shell app without being forced into multiple verticals from day one."
    status: pending
  - id: validate-add-vertical-flow
    content: "Verify the add-vertical command modifies an existing repository, wires topology, MF remotes, i18n, Effect BFF, scripts, and validation correctly."
    status: pending
  - id: run-quality-gates
    content: "Run generated format, lint, typecheck, build, ultramodern validation, and targeted framework tests for the changed defaults."
    status: pending
  - id: run-js-disabled-ssr-proof
    content: "Use browser automation to verify SSR pages render full styled content with JavaScript disabled, including language routes and vertical content."
    status: pending
  - id: run-cloudflare-output-proof
    content: "Validate Cloudflare build output, Wrangler config, route workers, public asset serving, and Effect BFF readiness for generated apps."
    status: pending
  - id: capture-evidence
    content: "Save screenshots, command outputs, and scaffold comparison notes showing no app-local patches are required."
    status: pending
isProject: false
---

# ultramodern-framework-propagation-04-generated-validation

## Execution Notes

This plan starts only after the framework lanes have landed locally. It is the gate that prevents Tractor from becoming another source of hidden patches. The validation target is not "Tractor works"; it is "a freshly scaffolded app works with the same capabilities Tractor needs."

## Constraints

Do not weaken lint rules or add local overrides in generated apps. Do not validate by searching source code for content; use build/runtime/browser evidence. Keep generated apps close to vanilla Modern.js shape while applying the UltraModern preset.

## Operator Guidance

This plan depends on the Cloudflare SSR deploy, federated CSS, and i18n/boundary lanes. Use it as the merge gate before touching Tractor cleanup. If validation requires a new framework change, send the issue back to the responsible upstream lane rather than patching the generated fixture.
