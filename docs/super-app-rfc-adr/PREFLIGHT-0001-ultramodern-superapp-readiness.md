# PREFLIGHT-0001: UltraModern SuperApp Readiness

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

The local control plane intentionally produces a deterministic dry-run process
plan in this preflight profile. Real dev-server startup belongs in the heavier
SuperApp certification path after package installation and deployment topology
are available.
