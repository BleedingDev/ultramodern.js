# ADR-0010: MV Wave 0 Contract-First Gates

- Status: Retired (2026-06-12) — machinery removed in fork cleanup, see `docs/research/fork-audit-2026-06-12-findings.md`. The `scripts/wave0-mv-contracts` gate script and the `validate:wave0-mv-contracts` npm script were removed (wave 1 completed 2026-04; the token-grep mechanism is superseded by the release-gates `migrationContracts` engine).
- Historical Note: Module Federation is the live composition runtime; Wave 0, Garfish, and parity-contract gates are historical (see `FORK-DIVERGENCE.md`).
- Date: 2026-04-28
- Decision Type: Program governance
- Related Plan: `.codex/plans/ultramodern-wave0-contract-first-execution.plan.md`
- Related Beads: `modernjs-bqq`

## 1. Context

The Ultramodern Micro Verticals program must not begin broad runtime, scaffold, design-system, Zephyr, or ownership-gate implementation until the shared contracts are explicit. The program has several independently moving surfaces:

1. Module Federation and Garfish runtime behavior.
2. Shell-to-remote and shell-to-service topology manifests.
3. Zephyr-compatible vanilla Modern.js deployment rules.
4. Extraction boundaries and graph-aware ownership gates.
5. Design-system platform contracts.
6. External template ingestion and supply-chain controls.
7. Support matrix, CI economics, rollback, and incident operations.

Without a contract-first gate, Wave 1 implementation can create incompatible semantics across runtimes, templates, deployment profiles, and ownership tools. Wave 0 is the stop-loss point that prevents that drift.

## 2. Decision

Adopt a binary Wave 0 entry gate. Wave 1 is blocked until all required Wave 0 artifacts exist, parse, and satisfy the documented readiness checks.

Required artifacts:

1. `docs/super-app-rfc-adr/contracts/mv-runtime-parity-contract.json`
2. `docs/super-app-rfc-adr/contracts/mv-topology-manifest.schema.json`
3. `docs/super-app-rfc-adr/contracts/mv-template-manifest.schema.json`
4. `docs/super-app-rfc-adr/contracts/mv-ownership.schema.json`
5. `docs/super-app-rfc-adr/ADR-0010-mv-wave0-contract-first-gates.md`
6. `docs/super-app-rfc-adr/ADR-0011-mf-vs-garfish-runtime-parity-contract.md`
7. `docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md`
8. `docs/super-app-rfc-adr/ADR-0013-mv-ds-platform-contract.md`
9. `docs/super-app-rfc-adr/ADR-0014-mv-template-supply-chain-policy.md`
10. `docs/super-app-rfc-adr/ADR-0015-mv-ownership-and-blast-radius-gates.md`

The gate is validated by:

```bash
pnpm run validate:wave0-mv-contracts  # removed 2026-06-12; script and gate deleted
```

The command is intentionally docs-and-contract focused. It proves that Wave 0 has a complete contract baseline; it does not replace Wave 1 implementation tests.

## 3. Gate Conditions

Wave 0 passes only when all conditions below are true:

1. MF-vs-Garfish parity taxonomy is explicit and testable.
2. Known runtime non-equivalences are documented before MF can be marked canonical.
3. Topology manifests define URL indirection, integrity, attestation, TTL, LKG, revocation, and environment overlay semantics.
4. Zephyr profile constraints preserve vanilla Modern.js conventions and avoid runtime boot hacks.
5. Extraction boundaries forbid hidden shell coupling and require explicit auth, session, locale, and trace contracts.
6. DS platform rules are vendor-neutral and cover internal, horizontal remote, and third-party adapter models.
7. Template ingestion requires pinned sources, provenance, checksums, and denied lifecycle scripts by default.
8. Ownership metadata supports human, team, agent, and service-account owners.
9. Graph-aware blast-radius policy identifies route, remote, service, and shared-package impact.
10. Runtime kill-switch and rollback expectations exist for remote, DS, manifest, and trust-policy failures.

## 4. Stop-Loss Criteria

Wave 1 must not start when any of these are true:

1. A required artifact is missing or unparsable.
2. A contract permits unpinned remote or template execution in production.
3. MF and Garfish use different reason codes for equivalent trust, compatibility, or fallback outcomes without a listed non-equivalence.
4. Zephyr compatibility depends on forbidden boot-time mutation instead of vanilla Modern.js config.
5. Extraction readiness allows cross-vertical source imports.
6. Ownership metadata cannot identify a responsible owner for a changed route, remote, service, or shared package.
7. Rollback or kill-switch behavior is not defined for a remote, DS, manifest, or trust-policy failure.

## 5. Support Matrix Baseline

Wave 0 defines support tiers; later waves may change enforcement based on measured evidence.

| Tier | Runtime Profile | Gate Depth | Policy |
| --- | --- | --- | --- |
| Golden | TanStack + Effect + Module Federation | Full contract, failure, rollback, and certification checks | Target default after parity evidence |
| Compat | React Router + Hono + Garfish | Compatibility and migration checks | Supported until parity and rollout evidence justify narrowing |
| Experimental | Mixed router, service, or runtime combinations | Smoke and explicit opt-in checks | Not a production default |

CI budgets are part of the gate contract. Golden lanes carry full evidence; Compat lanes carry migration and regression evidence; Experimental lanes must stay bounded to smoke coverage unless promoted.

## 6. Operational Requirements

Every Wave 1 implementation stream must inherit these controls from Wave 0:

1. Per-remote disable.
2. Per-DS-remote disable.
3. Per-vertical maintenance fallback.
4. LKG manifest fallback.
5. Security revocation precedence over LKG fallback.
6. Observable trust, compatibility, fallback, rollback, and kill-switch outcomes.

## 7. Acceptance Criteria

1. All required Wave 0 artifacts are present.
2. JSON contracts parse and expose expected contract sections.
3. ADRs include status metadata and acceptance criteria.
4. `pnpm run validate:wave0-mv-contracts` exits successfully. (Removed 2026-06-12 — the script and npm entry no longer exist.)
5. Wave 1 remains blocked until the validation command is green.

