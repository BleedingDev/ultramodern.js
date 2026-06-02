---
name: ultramodern-production-06-golden-path-docs
overview: Make the human golden path clear and executable: initialize UltraModern apps and SuperApps, add verticals, run local checks, deploy/prove Cloudflare, and understand common failures without reading framework internals.
todos:
  - id: audit-current-docs-vs-generated-output
    content: Compare `packages/toolkit/create/README.md`, `packages/document/main-doc/docs/en/guides/get-started/ultramodern.mdx`, generated workspace README templates, and current `.82` generated package scripts to identify stale commands, missing environment variables, and duplicated explanations.
    status: completed
  - id: define-golden-path-command-set
    content: Define the minimal command sequence for app, SuperApp, add-vertical, local install/check/build, local browser smoke, Cloudflare deploy, Cloudflare proof, and published package verification.
    status: completed
  - id: update-main-docs
    content: Update the main UltraModern docs so the first-run and SuperApp flows are linear, version-accurate, and focused on what a human operator should run in order.
    status: completed
  - id: update-generated-readmes
    content: Update generated workspace and vertical README templates so every generated project carries the same command vocabulary, environment variable names, proof expectations, and troubleshooting entry points as the main docs.
    status: completed
  - id: add-troubleshooting-matrix
    content: Add a concise troubleshooting matrix for common proof failures: package cohort mismatch, install failure, build failure, browser smoke route failure, missing public URL, missing Cloudflare credential, asset 404, and federation manifest failure.
    status: completed
  - id: validate-doc-commands
    content: Add or extend docs/snippet validation so the documented golden-path commands exist in generated package scripts and do not drift from the actual proof harness.
    status: pending
isProject: false
---

# Production Point 6: Golden Path Docs

## Research Basis

- `packages/toolkit/create/README.md` already documents UltraModern app, workspace, vertical, Cloudflare, Zephyr, and monorepo testing workflows.
- `packages/document/main-doc/docs/en/guides/get-started/ultramodern.mdx` already includes human workflow and release/module certification concepts.
- Generated workspace docs and scripts are emitted from `packages/toolkit/create/src/ultramodern-workspace.ts`, including `cloudflare:deploy` and `cloudflare:proof`.
- Recent production-readiness work made `run-published-create-proof.mjs` the most accurate executable statement of the current golden path.

## Constraints

- Docs must describe official template behavior, not Tractor-specific customizations.
- Generated README guidance and website docs should share command vocabulary.
- Avoid turning docs into an architecture essay; make the path executable first, then link deeper references.

## Done Means

- A human can initialize, run, extend, deploy, and prove a generated UltraModern SuperApp from docs alone.
- Documented commands are validated against generated scripts.
- Troubleshooting points to framework/tooling owners instead of app-level hacks.
