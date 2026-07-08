# ADR-0011: MF vs Garfish Runtime Parity Contract

- Status: Retired (2026-06-12) — machinery removed in fork cleanup, see `docs/research/fork-audit-2026-06-12-findings.md`. The Garfish compat lane (`packages/runtime/plugin-garfish`) was deleted; Module Federation is the sole micro-frontend runtime surface and no client emitter of `modernjs:mv-runtime-parity` / runtime-fallback telemetry exists anymore (the server telemetry endpoint in `@modern-js/server-runtime-extensions` and the app-tools `modern runtime` fallback-signal CLI remain).
- Historical Note: Module Federation is the live composition runtime; Garfish runtime parity and trust-contract gates are historical (see `FORK-DIVERGENCE.md`).
- Date: 2026-04-28
- Decision Type: Runtime governance and parity contract
- Depends on:
  - `ADR-0002-app-level-mf-ssr-strategy.md`
  - `ADR-0004-telemetry-standardization-and-exporters.md`
  - `ADR-0007-module-certification-gates.md`

## 1. Context

The super-app runtime currently treats Garfish as the canonical baseline for micro-frontend behavior. Module Federation can become a candidate runtime surface, but it cannot be treated as canonical just because it can load a remote or expose an equivalent-looking entry.

Runtime parity needs an explicit contract because host-visible behavior includes more than successful rendering:

1. remote discovery and manifest shape.
2. trust decisions for origin, integrity, attestation, and isolation.
3. compatibility decisions for runtime digest, entry shape, lifecycle hooks, and SSR support.
4. deterministic fallback behavior.
5. telemetry payloads that can be correlated with release gates.
6. documented non-equivalences where MF and Garfish differ by design.

## 2. Decision

Define a machine-readable parity contract:

1. contract file:
   - `docs/super-app-rfc-adr/contracts/mv-runtime-parity-contract.json`
2. canonical baseline:
   - `garfish`
3. candidate runtime surface:
   - `module-federation`
4. required contract areas:
   - trust decision taxonomy.
   - compatibility decision taxonomy.
   - fallback phases, reasons, and machine-readable codes.
   - telemetry payload shape.
   - parity evidence requirements.
   - explicit known non-equivalences.

The contract is descriptive in Wave 0. Validator wiring and package scripts are intentionally left to the validation owner.

## 3. Canonical Terms

The contract standardizes these terms:

1. `runtimeSurface`:
   - the concrete runtime path used to discover, trust, load, mount, update, and unmount a micro-vertical.
2. `parityClaim`:
   - a claim that Module Federation produces equivalent host-visible behavior to Garfish for a named scenario.
3. `parityEvidence`:
   - machine-readable and reviewer-readable artifacts proving the parity claim.
4. `knownNonEquivalence`:
   - a runtime behavior that is intentionally different and must be recorded instead of hidden behind a generic pass.
5. `trustDecision`:
   - the host allow, warn, block, or unknown decision before loading a remote artifact.
6. `compatibilityDecision`:
   - the host decision about whether a remote is compatible with the active runtime contract.
7. `fallback`:
   - the deterministic host action used when a remote cannot safely satisfy trust, compatibility, or lifecycle requirements.

## 4. Trust and Compatibility Rules

Trust decisions are limited to:

1. `trusted`
2. `warn`
3. `blocked`
4. `unknown`

Compatibility decisions are limited to:

1. `compatible`
2. `compatible_with_degradation`
3. `incompatible`
4. `unknown`

`blocked`, `incompatible`, and strict-mode `unknown` decisions must not proceed to a normal mount. They must use the fallback taxonomy and emit telemetry.

`warn` and `compatible_with_degradation` are allowed only when the evidence explains why the degraded path is acceptable and how operators will observe it.

## 5. Fallback Contract

Fallback signals must use the contract's canonical phases, reasons, and codes. The taxonomy extends the runtime fallback notes from `ADR-0002` with parity-specific discovery, lifecycle, SSR, and hydration cases.

Required behavior:

1. host fallback must be deterministic for the same policy, manifest, and runtime state.
2. fallback reasons must be machine-readable.
3. fallback telemetry must include the runtime surface and parity claim ID.
4. recovery fallback must avoid partially hydrating or mounting a broken remote tree.

## 6. Telemetry Contract

Parity telemetry follows `ADR-0004` envelope expectations and adds runtime parity fields:

1. `runtimeSurface`
2. `appName`
3. `phase`
4. `reason`
5. `code`
6. `trustDecision`
7. `compatibilityDecision`
8. `parityClaimId`
9. `traceId`

Telemetry metadata may include runtime digests, integrity algorithm names, manifest versions, host versions, remote versions, and evidence IDs.

Telemetry metadata must not include raw authorization headers, session cookies, attestation secrets, or user personal data.

## 7. Parity Evidence Expectations

MF can satisfy a parity claim only when evidence covers every required scenario category:

1. manifest discovery.
2. origin trust.
3. integrity and attestation.
4. runtime compatibility.
5. lifecycle load, mount, and unmount.
6. SSR and hydration fallback.
7. telemetry envelope.
8. cache and version pinning.
9. failure and timeout behavior.

Each evidence record must include:

1. scenario ID.
2. Garfish observed behavior.
3. Module Federation observed behavior.
4. parity decision.
5. known non-equivalence IDs, when relevant.
6. test command and result.
7. telemetry sample.
8. reviewer.
9. commit SHA.

## 8. Known Non-Equivalences

The contract explicitly records non-equivalences that must be dispositioned before MF can be marked canonical:

1. remote loading model.
2. shared dependency negotiation.
3. sandbox and isolation semantics.
4. lifecycle entry shape.
5. SSR entry shape.
6. asset and cache invalidation.
7. prefetch and routing timing.
8. style and global side effects.
9. telemetry timing.

For navigation warmup, parity evidence should treat render prefetch and viewport preload as optimizations only. A remote route may warm earlier or later across runtimes, but click navigation remains authoritative and warmup must not bypass trust, fallback, or telemetry contracts.

These differences are not automatic blockers. They are blockers only when evidence fails to show an acceptable host-visible outcome or an approved degradation path.

## 9. Canonicality Rule

Module Federation must not be marked canonical without parity evidence.

The required threshold is:

1. every required scenario category is covered.
2. no scenario remains `not_evaluated`.
3. every known non-equivalence has an explicit disposition.
4. fallback telemetry samples exist for blocking fallback scenarios.
5. the release-candidate evidence is tied to a commit SHA and reviewed.

If evidence is missing or failed, Module Federation remains a candidate runtime surface and Garfish remains the canonical baseline.

## 10. Consequences

Positive:

1. runtime promotion becomes auditable instead of assumption-driven.
2. fallback and telemetry terms stay stable across Garfish and MF paths.
3. known MF/Garfish differences are surfaced early in release gates.
4. future validators can consume one contract instead of inferring policy from prose.

Tradeoff:

1. evidence creation adds release overhead.
2. some MF behavior may be acceptable only as documented degradation, not strict equivalence.
3. validators must preserve this contract's explicit non-equivalence model instead of reducing parity to render-success checks.

## 11. Validation

Wave 0 validation for this slice is limited to JSON parseability:

1. `node -e "JSON.parse(require('node:fs').readFileSync('docs/super-app-rfc-adr/contracts/mv-runtime-parity-contract.json','utf8'))"`

Future validation should wire this contract into release gates without changing the package scripts in this slice.

## 12. Acceptance Criteria

1. `contracts/mv-runtime-parity-contract.json` parses as JSON.
2. the contract defines trust decisions, compatibility decisions, fallback phases, fallback reasons, fallback codes, and telemetry payload fields.
3. the contract records known non-equivalences between Module Federation and Garfish.
4. this ADR states that Module Federation cannot become canonical until parity evidence covers required scenarios and non-equivalence dispositions.
