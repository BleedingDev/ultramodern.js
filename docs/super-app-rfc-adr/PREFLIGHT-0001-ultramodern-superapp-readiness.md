# PREFLIGHT-0001: UltraModern SuperApp Readiness

- Status: Retired (2026-06-12) — machinery removed in fork cleanup, see `docs/research/fork-audit-2026-06-12-findings.md`. Everything this doc documents was deleted: `pnpm run validate:ultramodern-preflight`, `scripts/ultramodern-preflight/run-preflight.js`, `scripts/ultramodern-contract-doctor`, and `scripts/superapp-local-control-plane` (dry-run and live modes). The chain was broken against the current workspace generator (the doctor pinned tanstack 1.170.8 vs generated 1.170.15 and expected a retired remotes topology), failing 15 checks on every fresh workspace with no CI consumer. The surviving validation is `tests/integration/create-ultramodern-workspace` plus each generated workspace's own `scripts/validate-ultramodern-workspace.mjs` (`pnpm ultramodern:check`). The commands below are retained for historical reference only and no longer run.

## Goal

Prove the framework entrypoint before a team writes business-domain SuperApp
code. The preflight path validates the current UltraModern foundation:

- one public preset, `presetUltramodern`
- TanStack Router through `@modern-js/plugin-tanstack/runtime`
- Effect BFF service shape
- shell, vertical remotes, design-system remote, and shared packages
- topology, ownership, local overlays, and template manifest evidence
- typed Module Federation SSR fallback plus client hydration contract

This is not a migration guide, codemod, AI runtime, MCP runtime, or production
release certification.

## Greenfield Flow

Generate a workspace directly:

```bash
node packages/toolkit/create/bin/run.js my-super-app --ultramodern-workspace --lang en
cd my-super-app
pnpm ultramodern:check
```

Or run the repo preflight profile, which generates a temporary workspace and
validates it end to end:

```bash
pnpm run validate:ultramodern-preflight
```

The preflight command runs these gates:

- generated scaffold validator from `scripts/validate-ultramodern-workspace.mjs`
- contract doctor from `scripts/ultramodern-contract-doctor/run-contract-doctor.js`
- local control-plane dry-run from `scripts/superapp-local-control-plane/run-local-control-plane.js`
- smoke checks for shell, two vertical remotes, design-system remote, and Effect service

## Readiness Evidence

The command emits JSON by default through the package script. Use `--out` when a
release gate needs a persisted artifact:

```bash
node scripts/ultramodern-preflight/run-preflight.js --json --out .tmp/ultramodern-preflight.json
```

The expected passing result has:

- `status: "pass"`
- doctor `status: "pass"`
- five planned local-control-plane processes
- process roles `shell`, `remote`, `design-system-remote`, and `effect-service`

## Current Boundary

The local control plane defaults to a deterministic dry-run process plan in this
preflight profile. The default is intentionally cheap and does not launch dev
servers.

Live local startup is available only through explicit opt-in:

```bash
node scripts/superapp-local-control-plane/run-local-control-plane.js \
  --workspace my-super-app \
  --mode live \
  --json
```

Live mode reuses the dry-run descriptors, then launches each planned process,
wires descriptor environment variables such as `PORT`, captures stdout/stderr
under `.modern/superapp-local-control-plane/<process-id>/`, probes health URLs,
classifies precondition/readiness failures, and tears down tracked processes
before returning. Generated workspaces must be installed first when descriptors
use the default `pnpm --filter <package> dev` commands; otherwise live mode
returns a `missing-install` failure instead of attempting a partial startup.
For controlled local tests, `topology/local-overlays/development.json` may
provide per-process command overrides through `commands.<process-id>` or
`processes.<process-id>.command`; live mode still owns logs, readiness, failure
classification, and teardown for those commands.
