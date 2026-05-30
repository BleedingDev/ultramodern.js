# UltraModern Agent Contract

This project is generated for Codex-first UltraModern.js work.

## Quality Gates

- `pnpm lint` runs Oxlint with the Ultracite preset.
- `pnpm format` runs oxfmt.
- `pnpm typecheck` runs effect-tsgo as the TypeScript checker.
- `pnpm i18n:check` rejects hardcoded user-visible JSX text.
- `pnpm ultramodern:check` verifies the generated contract.
- Generated Codex stop hooks and subagent-stop hooks run `pnpm format && pnpm lint:fix && pnpm ultramodern:check`.
- `postinstall` installs `lefthook` when the app is inside a Git worktree. Generated `lefthook.yml` runs `pnpm format`, `pnpm lint:fix`, and `pnpm ultramodern:check` on pre-commit; pre-push runs `pnpm ultramodern:check`.

## Internationalization

Runtime i18n is enabled by default. Agents must put user-visible UI copy in `config/public/locales/<lang>/translation.json` and render it through `react-i18next` or `@modern-js/plugin-i18n/runtime`. Do not add hardcoded JSX text, `aria-label`, `title`, `alt`, or `placeholder` strings unless the value is a non-translatable technical token.

Routes are locale-prefixed by default through `localePathRedirect: true`. Keep localized pages under `src/routes/[lang]`, use links for language switching, and preserve canonical plus `hreflang` metadata. Production builds fail unless `MODERN_PUBLIC_SITE_URL` is set, so deployed canonical URLs always use the production origin.

## Private Skills

Private orchestration skills are installed automatically during `pnpm install` when the current developer is authorized for `TechsioCZ/skills`. The installer clones that private repository and copies only the allowlisted skills from `.agents/skills-lock.json`; unauthorized developers get a warning and can continue with the public contract.
