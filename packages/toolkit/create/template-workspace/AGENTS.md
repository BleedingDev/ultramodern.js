# UltraModern Agent Contract

This workspace is generated as an agent-ready UltraModern.js SuperApp. Agents should treat the files under `.agents/skills` as local project instructions, not optional reading.

## Required Skill Baseline

Use these skills when the task touches the matching subsystem:

- `rsbuild-best-practices`: Modern.js app build configuration, Rsbuild options, assets, type checking, and build debugging.
- `rspack-best-practices`: Rspack-level bundling, CSS, assets, profiling, and production build behavior.
- `rspack-tracing`: Rspack build failures, slow builds, crash localization, and trace analysis.
- `rsdoctor-analysis`: Evidence-based bundle analysis from `rsdoctor-data.json`, including duplicate packages, large chunks, and retained modules.
- `rslib-best-practices`: Shared packages, generated libraries, declaration output, and Rslib configuration.
- `rslib-modern-package`: Package contracts for shared libraries, exports, side effects, dependency placement, README, and release readiness.
- `rstest-best-practices`: Rstest configuration, test writing, mocking, snapshots, coverage, and CI test behavior.

## Project Priorities

- Keep `presetUltramodern` as the single preset.
- Prefer Effect for BFF/service code.
- Prefer TanStack Router for app routing.
- Keep design-system code as a normal Micro Frontend or shared package, not a special core path.
- Keep generated packages explicit and publishable: stable `exports`, correct declarations, small public APIs, and clear ownership metadata.
- Do not add migration tooling or codemods unless the project owner explicitly asks for migration work.

## Skill Provenance

The vendored Rstack skills are pinned in `.agents/skills-lock.json`. Do not update, remove, or replace them casually. If a skill needs updating, update the lock file and run `pnpm ultramodern:check`.
