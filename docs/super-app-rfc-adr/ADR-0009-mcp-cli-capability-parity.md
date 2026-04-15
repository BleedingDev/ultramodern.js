# ADR-0009: MCP Capability Parity via CLI

- Status: In Progress
- Date: 2026-02-26
- Decision Type: Tooling and operational contract
- Depends on:
  - `ADR-0004-telemetry-standardization-and-exporters.md`
  - `GATES-0001-ticket-execution-gates.md`

## 1. Context

Modern.js is adding richer MCP-oriented operational capabilities. If MCP and CLI diverge, teams get brittle automation, inconsistent incident workflows, and hard-to-debug agent behavior differences.

We need one parity rule:

1. every capability available via MCP must also be available via CLI.

The fastest bootstrap path is an adapter bridge (for example, MCPorter by Steipete), but bridge-only parity can hide edge-case incompatibilities in shells, streaming, auth, and exit-code semantics.

## 2. Decision

Adopt a unified capability contract and dual-surface adapters.

1. Define a canonical capability registry:
   - `capabilityId`
   - `inputSchema`
   - `outputSchema`
   - `sideEffectLevel` (`read` | `write`)
   - `idempotency`
   - `authRequirements`
2. Generate/serve MCP capabilities from this registry.
3. Generate/serve CLI commands from this registry.
4. Enforce release-time parity checks for schema, behavior, and errors.

## 3. MCPorter Bootstrap Policy

Use bridge adapters to accelerate initial parity, with explicit boundaries.

1. Allowed:
   - read-only capabilities.
   - low-risk utility commands.
2. Not allowed as final state:
   - high-frequency performance-critical commands.
   - privileged mutating operations.
   - commands requiring custom streaming or binary payload handling.
3. Migration rule:
   - promote bridge-backed commands to native handlers when reliability, performance, or security thresholds require it.

## 4. CLI Parity Contract

For every MCP capability, CLI must provide:

1. deterministic command path.
2. `--json` output mode matching MCP output schema.
3. stable error envelope with machine-readable `code`, `message`, `details`.
4. explicit exit-code policy:
   - `0`: success.
   - non-zero mapped by capability error class.
5. side-effect disclosure and confirmation model for mutating operations.

## 5. Edge Cases and Bug Traps

1. Schema drift:
   - MCP and CLI return structurally different payloads after refactors.
2. Shell encoding/quoting:
   - JSON arguments break across shells and CI agents.
3. Streaming mismatch:
   - MCP supports incremental responses but CLI buffers and times out.
4. Auth context mismatch:
   - MCP session auth differs from CLI token/env auth.
5. Binary payloads:
   - capability works in MCP but fails in CLI due to text-only argument paths.
6. Cancellation semantics:
   - CLI SIGINT behavior differs from MCP cancellation behavior.
7. Version negotiation:
   - older CLI installed against newer MCP capability schema.

## 6. Risk and Harm

1. Operational harm:
   - incident runbooks fail if MCP and CLI produce different outcomes.
2. Security harm:
   - mutating capabilities exposed without explicit confirmation/audit.
3. Product harm:
   - teams distrust AI/operator tooling due to non-deterministic behavior.
4. Performance harm:
   - bridge adapters add overhead on hot paths.

## 7. Mitigations

1. Single source-of-truth capability registry and codegen adapters.
2. Parity conformance test suite in CI:
   - schema parity.
   - exit-code parity.
   - error-shape parity.
   - cancellation and timeout parity.
3. Capability parity report artifact required for release candidate gates.
4. Read-only-first rollout for bridge-backed commands.
5. Mandatory audit trail for mutating command execution.

## 8. Acceptance Criteria

1. Parity matrix shows 100% MCP capability coverage in CLI.
2. Release candidate checks fail on parity drift.
3. All mutating CLI capabilities require explicit confirmation or non-interactive policy flag.
4. Bridge-backed capability list is explicit and tracked for native migration.
5. Operational docs reference both invocation forms (MCP and CLI) for each capability.

## 9. Implementation Note (2026-02-26)

The current bootstrap implementation is contract-driven:

1. capability contract: `docs/super-app-rfc-adr/contracts/ai-capabilities.json`
2. parity validation: `pnpm run validate:mcp-cli-parity`
3. adapter artifact generation:
   - `pnpm run generate:mcp-adapter`
   - emits `.modern/mcp/adapter-manifest.json` and `.modern/mcporter.json`
4. MCP bridge server:
   - `pnpm run serve:mcp-cli-bridge`
   - tools are exposed from the capability contract and executed via mapped CLI invocations
