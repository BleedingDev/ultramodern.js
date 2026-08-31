---
'@modern-js/ultramodern-create': patch
---

Harden the create CLI and generated workspaces:

- `create` and the generated `postinstall` no longer install git via sudo/brew or clone GitHub repositories implicitly. Missing git fails fast with an actionable message; agent-skill and reference-repo clones are explicit opt-in steps (`pnpm skills:install`, `pnpm agents:refs:install`, or `ULTRAMODERN_AGENT_SKILLS=1`), and `pnpm skills:check` warns (instead of failing) when clone-installed skills have not been fetched.
- The documented `--workspace` flag is now honored: it forces the workspace package-source strategy and conflicts loudly with `--ultramodern-package-source=install`.
- The npm registry lookup for the BleedingDev framework cohort now has a timeout and falls back to the packaged version instead of aborting, so the default scaffold works offline.
- The generated Effect client actually forwards `locale`, `operationContext`, and `traceparent` to `makeEffectHttpApiClient` via `requestContext`, so the advertised operation-context headers are sent.
- Version pins in static templates (pnpm-workspace overrides, AGENTS.md, README) are rendered from `versions.ts` instead of being hand-duplicated.
- Removed the dead demo-topology lanes keyed on vertical names `workspace`/`records`/`actions` (which generated broken workspaces for those names), the orphan `packages/shared-effect-api` stub, the always-empty public-surface asset/content-source stubs, empty help examples, the never-printed help options, and the misbranded `--version` output (now derived from the real package name).
