# Localised URLs High-Quality Operator Log

Graph ID: `localised-urls-high-quality`
Selection hash: `d10bb7c7ee`
Snapshot: `.codex/plan-graphs/localised-urls-high-quality/snapshot.json`
Agent limits: `max_threads=50`, `max_depth=3`
Execution bead: `modernjs-sl64`

## Launch Plan

- Runtime adapter lane: write-capable owner for `packages/runtime/plugin-i18n/src/runtime/**`; must not edit server middleware or integration fixtures.
- API prefix lane: write-capable owner for `packages/runtime/plugin-i18n/src/server/**`; must not edit runtime adapter or integration fixtures.
- React Router E2E lane: write-capable owner for `tests/integration/i18n/routes-localised-urls/**`; must not edit package runtime/server implementation.
- TanStack E2E lane: write-capable owner for `tests/integration/i18n/routes-tanstack-localised/**`; must not edit package runtime/server implementation.
- Final integration lane: primary agent owns cross-lane merge, docs, contract audit, quality gates, Beads closeout, commit, and push.

## Lane Status

- Runtime adapter lane: agent `019e6a67-d363-7533-9975-1e7bc6b1247b` (`Jason`), completed. Integrated router-native `I18nLink` adapter for React Router and TanStack without manual click interception.
- API prefix lane: agent `019e6a68-1206-7372-ae2c-b7f34e4063ec` (`Raman`), completed. API/BFF prefixes are excluded from locale detection and redirects.
- React Router E2E lane: agent `019e6a68-50c0-7523-a59d-307271b5dd88` (`Volta`), completed. Added SSR localised URL fixture and coverage.
- TanStack E2E lane: agent `019e6a68-893d-7d92-bc41-baea9263b16c` (`Beauvoir`), completed. Added TanStack localised URL fixture, link navigation, changeLanguage, optional param, and BFF coverage.
- Docs scout: agent `019e6a68-f2a4-7b91-a109-68fe6208a6f7` (`Socrates`), completed. Docs updated in English and Chinese.
- Gate scout: agent `019e6a69-08a6-7a01-a0d0-d35bc7afba58` (`Dewey`), completed. Verification commands collected and run by the primary agent.
- Strictness scout: agent `019e6a69-1df1-7673-a74b-6f3152c8f166` (`Tesla`), completed. Strict all-language localised URL validation retained.
- TanStack typegen lane: agent `019e6a74-ee3e-7b33-8ca2-671b24d70394` (`Copernicus`), completed. Localised TanStack aliases preserve typed child trees.

## Integration Notes

- The temporary manual anchor interception approach was removed. `I18nLink` delegates to router-native `Link` when a router Link is available, with a plain anchor only as the no-router fallback.
- React Router SSR initially exposed an async-module failure in `@modern-js/plugin-i18n/runtime`; backend imports now use CJS entrypoints so route modules importing i18n runtime stay synchronous.
- React Router E2E coverage is split across redirect and navigation/API files to avoid the dev-server SIGTERM seen when all browser cases shared one fixture process. Both files pass together.
