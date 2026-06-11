# UltraModern Agent Contract

This workspace is generated as an agent-ready UltraModern.js SuperApp shell.
Agents should treat the files under `.agents/skills` as local project
instructions, not optional reading.

## Quality Gates

- `pnpm lint` runs Oxlint with the Ultracite preset.
- `pnpm format` runs oxfmt.
- `pnpm typecheck` runs effect-tsgo as the TypeScript checker.
- `pnpm i18n:boundaries` verifies workspace source boundaries through `@modern-js/code-tools`.
- `pnpm contract:check` verifies the generated workspace contract.
- `pnpm mf:types` verifies Module Federation type outputs after builds.
- `pnpm check` is a local convenience aggregate for the primitive gates.
- Generated CI runs primitive gates as separate matrix jobs instead of calling `pnpm check`.
- Generated Codex stop hooks and subagent-stop hooks run `pnpm format && pnpm lint:fix && pnpm check`.
- `postinstall` formats the generated tree, initializes Git when needed, prepares agent skills and reference repos, then installs `lefthook`. Generated `lefthook.yml` runs separate format and lint-fix commands on pre-commit; pre-push runs read-only primitive gates in parallel.

## Localized Routes

Generated apps keep locale-prefixed entry routes under `src/routes/[lang]`,
static language links, and canonical plus `hreflang` metadata. A new workspace
starts shell-only; `create <domain> --vertical` adds route-owned metadata,
localized resources, and Effect BFF surfaces for that domain. Runtime i18n is
not enabled in the starter because the current React 19 + Module Federation
streaming SSR stack must render predictably first. Canonical and hreflang URLs
use `MODERN_PUBLIC_SITE_URL` (falling back to per-app `ULTRAMODERN_PUBLIC_URL_<APP_ID>`),
while asset URLs prefer the per-app `ULTRAMODERN_PUBLIC_URL_<APP_ID>`. Without
any configured public URL, builds emit origin-relative asset paths so pages work
behind tunnels and reverse proxies.

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

The public `module-federation/agent-skills` repository is installed during `pnpm install` and `pnpm skills:install`. Postinstall mode skips unavailable clone sources instead of blocking dependency installation; `pnpm skills:install` remains strict for required public skills. Use `ULTRAMODERN_SKIP_AGENT_SKILLS=1` when an install must avoid external skill repositories completely. `pnpm skills:check` fails when the required public `mf` skill is missing unless that skip flag is set.

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
- Keep the initial workspace shell-only unless a user explicitly asks for a
  starter vertical.
- Use `create <domain> --vertical` as the growth path for real business
  MicroVerticals.
- Prefer Effect for BFF code.
- Prefer TanStack Router for app routing.
- Keep UI-kit or design-system code as ordinary vertical or shared package code, not a special core path.
- Keep generated packages explicit and publishable: stable `exports`, correct declarations, small public APIs, and clear ownership metadata.
- Do not add migration tooling or codemods unless the project owner explicitly asks for migration work.

## Skill Provenance

The vendored Rstack skills, public Module Federation skill, and private TechsioCZ skill set are pinned in `.agents/skills-lock.json`. Do not update, remove, or replace them casually. If a skill needs updating, update the lock file and run the affected primitive gate plus `pnpm check`.
