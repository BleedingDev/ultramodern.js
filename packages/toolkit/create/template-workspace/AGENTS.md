# UltraModern Agent Contract

This workspace is generated as an agent-ready UltraModern.js SuperApp. Agents should treat the files under `.agents/skills` as local project instructions, not optional reading.

## Quality Gates

- `pnpm lint` runs Oxlint with the Ultracite preset.
- `pnpm format` runs oxfmt.
- `pnpm typecheck` runs effect-tsgo as the TypeScript checker.
- `pnpm check` runs formatting, linting, effect-tsgo, private-skill availability checks, and the generated workspace contract.
- Generated Codex stop hooks and subagent-stop hooks run `pnpm format && pnpm lint:fix && pnpm check`.
- `postinstall` installs `lefthook` when the workspace is inside a Git worktree. Generated `lefthook.yml` runs `pnpm format`, `pnpm lint:fix`, and `pnpm check` on pre-commit; pre-push runs `pnpm check`.

## Localized Routes

Generated apps keep locale-prefixed entry routes under `src/routes/[lang]`, static language links, and canonical plus `hreflang` metadata. Runtime i18n is not enabled in the starter because the current React 19 + Module Federation streaming SSR stack must render predictably first. Production builds fail unless `MODERN_PUBLIC_SITE_URL` is set per deployed app, so canonical URLs always use the production origin.

## Required Skill Baseline

Use these skills when the task touches the matching subsystem:

- `rsbuild-best-practices`: Modern.js app build configuration, Rsbuild options, assets, type checking, and build debugging.
- `rspack-best-practices`: Rspack-level bundling, CSS, assets, profiling, and production build behavior.
- `rspack-tracing`: Rspack build failures, slow builds, crash localization, and trace analysis.
- `rsdoctor-analysis`: Evidence-based bundle analysis from `rsdoctor-data.json`, including duplicate packages, large chunks, and retained modules.
- `rslib-best-practices`: Shared packages, generated libraries, declaration output, and Rslib configuration.
- `rslib-modern-package`: Package contracts for shared libraries, exports, side effects, dependency placement, README, and release readiness.
- `rstest-best-practices`: Rstest configuration, test writing, mocking, snapshots, coverage, and CI test behavior.
- `mf`: Module Federation docs, Modern.js integration, DTS/type checks, shared dependency checks, runtime errors, and observability troubleshooting.

The public `module-federation/agent-skills` repository is installed during `pnpm install` and `pnpm skills:install`. `pnpm skills:check` fails when the required public `mf` skill is missing.

## Private Skills

ScriptedAlchemy/TechsioCZ skills are private and are cloned only when the current developer is authorized for `TechsioCZ/skills`.

```bash
pnpm skills:install
```

The installer copies only the pinned private skills from `.agents/skills-lock.json`: `plan-graph`, `dag`, `subagent-graph`, `helm`, and `debugger-mode`.

## Agent Reference Repositories

The workspace installs read-only source references under `repos/` by default during `pnpm install` using `git subtree add --squash`. These repositories are reference material for coding agents, not application source:

- `repos/effect` from `Effect-TS/effect`.
- `repos/ultramodern.js` from `BleedingDev/ultramodern.js`.

Agents may read files under `repos/` to understand upstream patterns, APIs, and project conventions. Do not edit files under `repos/`, import from them, or make production code depend on them. To skip this setup, run installs with `ULTRAMODERN_SKIP_AGENT_REPOS=1`.

## Project Priorities

- Keep `presetUltramodern` as the single preset.
- Prefer Effect for BFF/service code.
- Prefer TanStack Router for app routing.
- Keep design-system code as a normal Micro Frontend or shared package, not a special core path.
- Keep generated packages explicit and publishable: stable `exports`, correct declarations, small public APIs, and clear ownership metadata.
- Do not add migration tooling or codemods unless the project owner explicitly asks for migration work.

## Skill Provenance

The vendored Rstack skills, public Module Federation skill, and private TechsioCZ skill set are pinned in `.agents/skills-lock.json`. Do not update, remove, or replace them casually. If a skill needs updating, update the lock file and run `pnpm check`.
