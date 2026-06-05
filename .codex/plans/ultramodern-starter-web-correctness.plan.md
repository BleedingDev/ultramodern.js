---
name: ultramodern-starter-web-correctness
overview: Fix the UltraModern single-app starter so newly generated apps begin with correct document metadata, local assets, semantic markup, responsive CSS, focus-visible treatment, and reduced-motion defaults without introducing a broad webSpec/profile system or unrelated public-surface generation.
todos:
  - id: define-starter-correctness-contract
    content: Define the exact starter correctness contract for this slice: document title and description, root language/direction metadata, viewport behavior, local icon/logo assets, semantic main content, responsive layout, focus-visible styles, and reduced-motion defaults.
    status: pending
  - id: audit-template-metadata-ownership
    content: Audit the create template, app-tools HTML defaults, Helmet support, and generated runtime layout to identify which owner should set title, description, viewport, html lang, html dir, canonical, and alternate links for the starter.
    status: pending
  - id: replace-remote-default-assets
    content: Replace the starter's remote favicon/logo URLs with repository-owned template assets and update generated references so a new app does not depend on third-party CDN assets at first render.
    status: pending
  - id: add-document-metadata-defaults
    content: Update the starter to emit meaningful localized title and description metadata, preserve existing canonical and hreflang behavior, and set html lang/dir through the existing head/Helmet mechanism where supported.
    status: pending
  - id: correct-starter-markup-semantics
    content: Replace the visual title container with semantic starter markup, including a real h1, main landmark structure, accessible language navigation, and no extra wrapper elements that exist only for styling.
    status: pending
  - id: harden-starter-css-defaults
    content: Update starter CSS to avoid fixed-width overflow, provide clear focus-visible treatment, keep hover/focus motion modest, add reduced-motion handling, and preserve Tailwind compatibility in the handlebars template.
    status: pending
  - id: update-i18n-and-copy-fixtures
    content: Add or adjust localized starter strings needed for title, description, logo alt text, language navigation, and any semantic headings without hard-coded per-language UI branches.
    status: pending
  - id: add-template-validation-checks
    content: Extend the generated starter validator and contract tests to catch remote default assets, missing metadata tokens, missing semantic h1/main structure, fixed-width starter grid regressions, and missing focus/reduced-motion CSS.
    status: pending
  - id: validate-generated-starter-output
    content: Generate a fresh UltraModern starter and run the focused generated-project checks to prove the template materializes correctly in the supported option combinations touched by this plan.
    status: pending
  - id: document-template-defaults
    content: Update starter documentation to describe the defaults and their escape hatches without presenting them as a broad Website Spec compliance layer.
    status: pending
isProject: false
---

# ultramodern-starter-web-correctness

## Execution Notes

Accepted direction:

- This plan covers item 3 from the prioritized list: starter/template web correctness.
- Do not add a broad `webSpec`, quality profile, route indexing policy, public-surface generator, JSON-LD layer, or navigation warmup implementation in this slice.
- Prefer preconfigured template defaults over framework magic checks.
- Keep enforcement focused on generated starter regressions, not arbitrary user-authored app UI.
- Track this work under Beads issue `modernjs-5dic`.

Current local evidence:

- `packages/toolkit/create/template/src/routes/layout.tsx.handlebars` renders only a wrapper and `Outlet`, so it does not provide starter landmarks or skip-link structure.
- `packages/toolkit/create/template/src/routes/[lang]/page.tsx.handlebars` uses remote favicon/logo assets, has canonical/hreflang links, but does not provide starter title/description metadata or html language/direction attributes.
- `packages/toolkit/create/template/src/routes/[lang]/page.tsx.handlebars` renders the main visual title as a `div` instead of a semantic `h1`.
- `packages/toolkit/create/template/src/routes/index.css.handlebars` uses a fixed `1100px` grid width and hover/focus transform without a reduced-motion guard.
- `packages/toolkit/create/template/scripts/validate-ultramodern.mjs.handlebars` validates internal UltraModern contract tokens but not the starter correctness details in this plan.
- `docs/super-app-rfc-adr/ADR-0013-mv-ds-platform-contract.md` supports focus-visible, reduced-motion, contrast-safe token, and SSR-safe rendering expectations for platform-owned defaults.
- `docs/super-app-rfc-adr/ADR-0014-mv-template-supply-chain-policy.md` treats starter templates as executable supply-chain inputs, so removing remote default assets belongs in the template layer.

## Constraints

- Do not add app-level shims, custom navigation wrappers, synthetic click handlers, generated-file edits, local suppressions, or hook bypasses.
- Do not enforce arbitrary heading hierarchy, color contrast, or component-level accessibility rules against user-authored product UI in this slice.
- Do not generate `robots.txt`, `sitemap.xml`, `/llms.txt`, JSON-LD, API catalogs, or agent discovery endpoints here.
- Do not change route indexability defaults here.
- Do not remove existing canonical/hreflang behavior unless replacing it with an equivalent or better template-owned implementation.
- Keep all starter text localizable through the existing i18n template path.
- If the correct viewport cannot be fixed purely in the create template, scope any app-tools default change narrowly to generated-starter correctness and document why the template owner cannot solve it alone.

## Operator Guidance

Start with a generated-output contract test before editing the starter. The most useful first proof is a test that materializes the template and asserts the generated source contains local asset references, title/description metadata, semantic `h1`, responsive CSS guards, focus-visible treatment, and reduced-motion handling.

Recommended files to inspect and update:

- `packages/toolkit/create/template/src/routes/layout.tsx.handlebars`
- `packages/toolkit/create/template/src/routes/[lang]/page.tsx.handlebars`
- `packages/toolkit/create/template/src/routes/index.css.handlebars`
- `packages/toolkit/create/template/src/modern.runtime.ts.handlebars`
- `packages/toolkit/create/template/scripts/validate-ultramodern.mjs.handlebars`
- `packages/toolkit/create/template/tests/ultramodern.contract.test.ts.handlebars`
- `packages/solutions/app-tools/src/config/default.ts` only if viewport correctness cannot be made reliable from the template layer

Run focused validation first:

- `pnpm --filter @modern-js/create test`
- generated starter `pnpm ultramodern:check`
- `pnpm run validate:ultramodern-preflight` only if the touched template behavior affects the workspace preflight path

Keep review focused on generated app output. The success condition is that a new UltraModern starter begins in a polished, accessible, local-asset, responsive state without requiring a user to configure anything before first run.
