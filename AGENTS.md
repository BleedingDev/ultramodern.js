# Agent Working Rules

1. Default publish/push remote is the user's fork: `bleedingdev`.
2. Do not push or publish to upstream `origin` (`web-infra-dev/modern.js`) unless the user explicitly requests it.
3. Hacks that hide framework defects in an app or demo are forbidden. Do not add app-level shims, custom navigation wrappers, manual click interception, synthetic `<a>` handlers, local config suppressions, generated-file edits, hook bypasses, or one-off patches to make a broken framework behavior look fixed. Use native framework/router primitives directly in apps, and fix broken behavior in the owning framework/runtime/tooling layer. "Owning layer" is not a licence to edit upstream files: when the owning layer is fork-owned, fix it there directly; when it is upstream-owned, Rule 5 decides how the fix lands.
4. If `/Users/satan/side/experiments/tractor-store-vertical` exists when UltraModern.js generator/runtime/tooling changes, update and validate that demo as downstream release acceptance before closing the work. Preserve its visible Tractor UI unless the user explicitly requests a design change.
5. Fork boundary — every change under `packages/**` is in exactly one of two buckets.
   - **Bucket A — additive fork behavior** (new features, subsystems, plugins, gates, instrumentation) MUST live in fork-owned packages. The reference shape is `@modern-js/server-runtime-extensions` (`packages/server/runtime-extensions`), which hosts the fork's Module Federation server logic behind the existing `ServerPlugin` extension point. Never write a new fork subsystem into a vanilla upstream package, and never grow an existing one there.
   - **Bucket B — changes to upstream-owned lines** (any file that exists at the audited base recorded in `FORK-DIVERGENCE.md`, including its identity across renames) is allowed only as one of: (1) a PR to upstream `origin`, (2) use of an existing upstream extension point, or (3) a size-capped patch. Resolution (3) has an exact hard maximum of **20 added-plus-removed PR lines per audited-base-owned file**; split anything larger into Bucket A or send it upstream instead.
   - Every accepted **non-shrink** Bucket-B change requires a same-PR `FORK-DIVERGENCE.md` entry — owner, reason, and a disposition drawn from that file's "Disposition vocabulary" table. A componentwise genuine shrink (neither cumulative metric grows and at least one falls) needs no ledger ceremony. Equal-count replacement and rename are non-shrinks.
   - The enforcing gate is `node scripts/ultramodern-boundary-check/check-fork-import-boundary.js`. Verification measures the complete canonical scope recorded in `scripts/ultramodern-boundary-check/divergence-allowlist.json` against its fixed audited base (`eded841256`, upstream's `Release v3.8.2 (#8810)` mainline commit); caller-selected roots, pathspecs, alternate allowlists, malformed budgets/totals, or unresolved refs fail closed. Plain `--write-divergence-allowlist` only locks in shrink. A raised/new budget additionally requires the explicit `--record-growth --merge-base <PR-base> --head <commit>` writer operation, an exact `<= 20`-line PR delta, and a same-PR ledger change; CI independently re-derives all three. Base/scope transitions require `--rebase-divergence-allowlist` with the same reviewed ref and ledger evidence. `allowlist.json` is separate and used only by `--mode imports`; do not confuse the two. The `v3.8.2` tag (`e642cd16`) is patch-equivalent to the audited base commit but not an ancestor of `HEAD`; measure against the mainline commit, never the tag.

# AGENTS.md - Modern.js monorepo

## Repository Shape

- Modern.js is a React-based progressive web framework; the upstream mainline is v3.
- This is a pnpm + nx monorepo. Major package areas:
  - `packages/solutions/app-tools` - app engineering solution, high-risk.
  - `packages/cli/*` - builder and CLI plugins, high-risk.
  - `packages/runtime/*` - runtime, high-risk.
  - `packages/server/*` - server and BFF, high-risk.
  - `packages/toolkit/*` - utilities, including `create`.
  - `packages/document` - Rspress documentation site, emits llms.txt.

## Common Commands

- Install dependencies: `pnpm install`
- Build one package: `pnpm --filter <pkg> build`
- Unit tests: `pnpm test:ut` from repo root, or `pnpm --filter <pkg> test` for a package.
- Framework integration tests: `pnpm test:framework`
- Builder e2e tests: `pnpm test:builder`
- Skill regressions: `node tests/skill/run.mjs` and `node tests/skill/feature-enable.mjs`
- Style: Biome via `biome.json`; run lint before submit.
- Published changes need a changeset: `pnpm change`

## Boundaries

- Do not hand-edit `pnpm-lock.yaml`, `dist/`, `node_modules/`, or package `CHANGELOG.md` unless the task explicitly requires it.
- Do not change framework runtime semantics without tests.
- Do not commit secrets or tokens.
- Prefer Modern.js docs lookup through `https://modernjs.dev/llms.txt`; use `https://modernjs.dev/llms-full.txt` only for larger targeted excerpts.
- Match answers and changes to the repository's current version, not unreleased future docs.

## Skills Routing

- User-facing Modern.js application skills live under root `skills/<name>/`.
- Maintainer-facing repository skills live under `scripts/skills/<name>/`.
- `.claude/skills`, `.agents/skills`, and `.cursor/skills` are generated mirrors from `pnpm sync:skills` and should not be hand-edited.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
