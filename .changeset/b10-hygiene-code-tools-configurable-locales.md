---
'@modern-js/code-tools': minor
'@modern-js/sandpack-react': patch
---

feat(code-tools): make the workspace source check locale convention configurable

- `runWorkspaceSourceCheck` accepts new `locales` (default `['en', 'cs']`) and
  `pluralCategories` options; the `WorkspaceSourceCheckOptions` type is now
  exported. Locale JSON plural validation applies to every configured locale
  instead of silently skipping anything that is not `en`/`cs`, and required
  plural categories are resolved per locale via `Intl.PluralRules` (overridable
  through `pluralCategories`).
- the `modern.runtime.ts` resource-registration check now accepts any import
  identifier names and `resources: <expr>` property forms instead of requiring
  the literal `csResource`/`enResource` identifiers and the `resources,`
  shorthand; its failure message names the locales whose imports are missing.
- fix(sandpack-react): point `repository.directory` metadata at the package's
  real `packages/toolkit/sandpack-react` location.
