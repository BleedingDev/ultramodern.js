# @modern-js/ultramodern-checks

Source guardrails used by UltraModern generated applications.

## API

- `runSingleAppI18nCheck(options)` validates one generated app's `src` tree for hardcoded user-visible JSX strings.
- `runWorkspaceSourceCheck(options)` validates generated workspace i18n and Module Federation boundary guardrails.
- `oxlintPlugin` exposes the AST-backed Oxlint JavaScript plugin used by both runners.

The single-app i18n runner rejects literal JSX text and literal visible attributes such as `aria-label`, `alt`, `placeholder`, and `title`. It allows localized or otherwise dynamic expressions, punctuation-only JSX whitespace, numeric content, adjacent `i18n-ignore` comments, and technical text inside `code`, `kbd`, and `samp`.
