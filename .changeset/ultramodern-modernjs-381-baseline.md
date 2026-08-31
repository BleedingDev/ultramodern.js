---
'@modern-js/ultramodern-create': patch
'@modern-js/plugin-i18n': patch
---

Align the UltraModern release identity and generated application surface with the incorporated Modern.js 3.8.1 baseline.

- Published BleedingDev cohorts now fail closed unless their prerelease base exactly matches the source `@modern-js/ultramodern-create` version, with revisions restarting at `.1` for each upstream base.
- Generated application TypeScript projects include `server/`, preserving Modern.js 3.8 behavior for custom server files after the UltraModern generator redesign.
- `@modern-js/plugin-i18n` restores the upstream React 18 and i18next 25 compatible peer ranges while continuing to test against the current React 19/i18next 26 development cohort.
