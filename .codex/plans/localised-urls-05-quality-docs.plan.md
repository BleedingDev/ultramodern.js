---
name: Localised Urls 05 Quality Docs
overview: Finish the localisedUrls work with contract tests, documentation updates, broad regression checks, and review gates that prevent React Router-only or API-localizing regressions from returning.
todos:
  - id: add-contract-regression-tests
    content: "Add or update focused contract tests so plugin-i18n fails if TanStack navigation uses React Router signatures or if API prefixes are not skipped segment-safely."
    status: pending
  - id: update-docs-for-router-and-api-behavior
    content: "Update i18n routing docs to state TanStack and React Router support, strict localisedUrls defaults, and automatic API/BFF prefix exclusion."
    status: pending
  - id: run-focused-quality-gates
    content: "Run plugin-i18n unit tests, typecheck, build, biome for touched files, React Router localised E2E, TanStack localised E2E, and relevant existing i18n/TanStack/BFF suites."
    status: pending
  - id: audit-for-react-router-only-assumptions
    content: "Search plugin-i18n runtime for @modern-js/runtime/router imports and positional navigate assumptions; verify only intentional React Router adapter code remains."
    status: pending
  - id: audit-for-api-localisation-regressions
    content: "Search server/i18n changes and tests to verify BFF/API prefixes are excluded by default and not only through user ignoreRedirectRoutes."
    status: pending
  - id: prepare-final-handoff
    content: "Summarize implementation, test evidence, residual risks, and exact commands; close related Beads only when all gates pass."
    status: pending
isProject: true
---

# Localised Urls 05 Quality Docs

## Execution Notes

This lane runs after implementation and E2E lanes. Its job is to prevent a technically working but brittle implementation from landing. The final state should make it hard to reintroduce hidden React Router assumptions or accidental API localization.

Quality gates should include at minimum:

- `pnpm --filter @modern-js/plugin-i18n exec rstest run tests/localisedUrls.test.ts`
- `pnpm --filter @modern-js/plugin-i18n exec tsc --noEmit`
- `pnpm --filter @modern-js/plugin-i18n run build`
- Biome over touched i18n source/tests/docs/fixtures
- New React Router localisedUrls integration suite
- New TanStack localisedUrls integration suite
- Existing `routes-tanstack` regression suite when feasible
- Existing BFF/API redirect safety suite or targeted equivalent

## Constraints

Do not close this lane on partial evidence. If a broad suite is too expensive or flaky, record the exact substitute evidence and file a follow-up bead instead of pretending it passed.

Docs must match actual behavior after implementation. Do not document API prefix exclusion until the server code enforces it by default.

## References

- `packages/document/docs/en/guides/advanced-features/international/routing.mdx`
- `packages/document/docs/en/guides/advanced-features/international/api.mdx`
- `packages/runtime/plugin-i18n/tests/localisedUrls.test.ts`
- `tests/integration/i18n`
- `tests/integration/routes-tanstack`
- `tests/integration/bff-hono`
- `tests/integration/bff-runtime-parity`

## Operator Guidance

This is the review gate. It should be strict, boring, and evidence-heavy. If anything still relies on full-page reload fallback in the TanStack path, the graph is not done.
