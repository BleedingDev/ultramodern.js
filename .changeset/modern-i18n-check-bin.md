---
'@modern-js/code-tools': minor
'@modern-js/ultramodern-create': patch
---

feat(code-tools): ship the `modern-i18n-check` bin

- `modern-i18n-check [--workspace-root <path>]` runs `runWorkspaceSourceCheck`
  for a workspace. It reads `sourceRoots`, `locales` and `pluralCategories`
  from `package.json#modernjs.i18nCheck` and names the field when it is invalid.
- Generated workspaces run `modern-i18n-check` for `i18n:boundaries` instead of
  copying `scripts/check-ultramodern-i18n-boundaries.mts`. Existing workspaces
  can delete that script and point `i18n:boundaries` at the bin.
