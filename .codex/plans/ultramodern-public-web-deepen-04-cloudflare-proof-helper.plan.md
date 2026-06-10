---
name: ultramodern-public-web-deepen-04-cloudflare-proof-helper
overview: Deepen the generated Cloudflare proof helper by separating evidence mechanics and assertion families internally while keeping `proof-cloudflare-version.mjs` CLI, env vars, report JSON, and assertion names stable.
todos:
  - id: map-proof-helper-responsibilities
    content: Map current generated proof helper responsibilities across fetch evidence, security assertions, public-surface assertions, SSR head assertions, CSS/MF/i18n checks, Effect readiness, and report assembly.
    status: completed
  - id: characterize-proof-helper
    content: Add or confirm tests that pin the generated helper import, CLI behavior, skipped reports, assertion names, fallback budgets, and public URL env behavior.
    status: completed
  - id: group-proof-assertions
    content: Refactor the generated proof helper into clearer internal assertion groups or evidence helpers without changing its exported interface or generated CLI adapter.
    status: pending
  - id: validate-proof-helper
    content: Run create integration tests, `@modern-js/create` tests, and any touched Cloudflare validation tests.
    status: pending
isProject: false
---

# ultramodern-public-web-deepen-04-cloudflare-proof-helper

## Execution Notes

The existing extraction makes `ultramodern-cloudflare-proof.mjs` a useful generated module, but its implementation is still monolithic. This lane should improve locality inside that generated helper while preserving its external seam.

## Constraints

Do not change `scripts/proof-cloudflare-version.mjs`, `--app`, `--out`, `--require-public-urls`, `ULTRAMODERN_PUBLIC_URL_<APP>`, report schema, stdout prefix, skipped behavior, or assertion type names. Do not import Cloudflare runtime implementation in a way that could hide Worker defects.

## Operator Guidance

This lane can run after research in parallel with policy only if write scopes are serialized in `ultramodern-workspace.ts`. A checker lane should verify generated proof output rather than trusting source-only refactors.
