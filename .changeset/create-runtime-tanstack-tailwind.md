---
'@modern-js/ultramodern-create': minor
---

feat(create): scaffold TanStack Router and Tailwind CSS projects

- new projects scaffold TanStack Router via `@modern-js/plugin-tanstack` (the original `--router` flag was superseded by the UltraModern workspace default)
- add Tailwind CSS v4 scaffolding (default on, `--tailwind`/`--no-tailwind` flags) with `postcss.config.mjs` and `tailwind.config.ts`
- update create template output and docs for combined TanStack + Tailwind initialization

Note: the `@modern-js/runtime` TanStack entrypoint originally introduced alongside this work was consolidated into `@modern-js/plugin-tanstack` before release; see the `tanstack-single-source-consolidation` changeset for the runtime story that actually ships.
