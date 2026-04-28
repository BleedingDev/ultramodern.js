---
name: Ultramodern Complete MV Delivery Waves (Wave 0–4)
overview: Contract-first execution plan for turning main-ultramodern into a production-grade Micro-Verticals-first framework while preserving Modern.js capabilities, Zephyr compatibility, and compatibility lanes.
todos:
  - id: ucmv-00
    content: Complete Wave 0 contract gates (must-pass) before implementation streams start.
    status: completed
  - id: ucmv-01
    content: Execute Wave 1 implementation streams in parallel (runtime parity, scaffolding, DS, Zephyr profile, ownership gates).
    status: completed
  - id: ucmv-02
    content: Complete Wave 2 integration pilot (reference superapp, extraction drill, chaos/failure drills).
    status: completed
  - id: ucmv-03
    content: Complete Wave 3 production rollout and certification.
    status: completed
  - id: ucmv-04
    content: Complete Wave 4 hardening, lane policy finalization, and compatibility-lane sunset decisions.
    status: pending
isProject: true
---

# Ultramodern Complete MV Delivery Waves (Wave 0–4)

## Objective
Ship a **Micro-Verticals-first** Modern.js framework profile that is:
1. MF-first strategically,
2. Garfish-safe operationally until parity is proven,
3. Zephyr-compatible with vanilla Modern.js conventions,
4. DS-flexible (internal DS, horizontal DS remote, third-party DS),
5. extractable by URL indirection with strict blast-radius controls.

---

## Non-Negotiable Program Rules

1. **No Wave 1 work starts before Wave 0 is green.**
2. **MF-first is target, not religion**: Garfish remains production default until parity gate passes.
3. **Vanilla Modern.js first**: no framework-core hacks that break Zephyr integration path.
4. **Support matrix is tiered** (Golden/Compat/Experimental), not all-combos-equal.
5. **Every remote/template must be pinned and provenance-checked.**
6. **Every major change must have rollback, kill-switch, and LKG strategy.**

---

## Wave 0 — Contract-First Gate (Must Pass)

### Scope
Wave 0 is pure contracts, schemas, governance, and validation surfaces. No broad runtime behavior changes.

### W0 Deliverables

#### W0.1 MF↔Garfish parity contract
- Shared taxonomy for:
  - trust decisions,
  - compatibility decisions,
  - fallback reasons/phases/codes,
  - telemetry payload shape.
- Explicit `known-non-equivalences` list.

**DoD**
- Conformance document + machine-readable contract committed.
- MF cannot be marked canonical without parity evidence.

#### W0.2 Topology manifest contract
- Schema for shell→remote/service URL indirection.
- Includes:
  - immutable URL policy,
  - digest/integrity/attestation fields,
  - env overlays,
  - cache TTL,
  - LKG + revocation behavior.

**DoD**
- Schema + examples + validation command.

#### W0.3 Zephyr vanilla profile contract
- Define required Modern.js config constraints:
  - `withZephyr()` placement,
  - output/html/source constraints,
  - no forbidden runtime boot hacks.

**DoD**
- Zephyr compatibility checklist + gate profile committed.

#### W0.4 Extraction boundary contract
- Rules for true extraction-readiness:
  - no cross-vertical code imports,
  - API-only or remote-contract-only boundary crossing,
  - explicit auth/session/trace contract,
  - independent config/secrets readiness.

**DoD**
- Governance doc + gateable rule set.

#### W0.5 DS platform contract (vendor-neutral)
- DS-agnostic platform contract:
  - token surface,
  - theme hooks,
  - a11y baseline,
  - SSR/hydration requirements.
- Must support:
  - internal monorepo DS,
  - horizontal DS remote via MF,
  - third-party DS (Chakra/MUI/shadcn).

**DoD**
- Contract + adapter compliance checklist.

#### W0.6 Template manifest + supply-chain contract
- External template sources:
  - builtin,
  - npm,
  - git URL (pinned SHA/tag only),
  - local path.
- Provenance/checksum validation and no arbitrary lifecycle scripts by default.

**DoD**
- Template contract + validation path + deny-by-default policy.

#### W0.7 Support matrix + CI economics contract
- Tiered support definition:
  - Golden: TanStack + Effect + MF
  - Compat: React Router + Hono + Garfish
  - Experimental: mixed combinations
- CI gate depth per tier and max runtime budgets.

**DoD**
- Published matrix + gate-time budget + flake policy.

#### W0.8 Ownership metadata + graph-aware blast radius
- Multi-owner model (human/team/agent/service-account).
- Path rules + dependency-graph impact rules.

**DoD**
- Ownership schema + validation policy draft.

#### W0.9 Runtime kill-switch and incident contract
- Mandatory controls:
  - per-remote disable,
  - per-DS remote disable,
  - per-vertical maintenance fallback,
  - LKG fallback with security revocation precedence.

**DoD**
- Operational contract + required drills list.

#### W0.10 Entry gate for Wave 1
- Binary pass/fail checklist for all W0 items.

**DoD**
- One command/report proving all W0 conditions met.

---

## Wave 1 — Parallel Implementation Streams

> Starts only after W0 passes.

### Stream R — Runtime parity implementation
- Implement MF-side adapters for trust/compat/fallback telemetry parity with Garfish contract.
- Add MF failure-mode integration tests:
  - timeout/network,
  - digest mismatch,
  - integrity/origin violation,
  - shell survives with deterministic fallback.

**DoD**
- MF parity test suite green on Golden profile.
- Garfish remains operational fallback lane.

### Stream S — Scaffolding and template ingestion
- Extend create/generator:
  - external template sources,
  - template contract validation,
  - profile-based generation (single-app, co-hosted, extract-ready).
- Generate deterministic topology manifest in scaffold output.

**DoD**
- Generated projects pass smoke (install/dev/build/serve) on supported profiles.

### Stream D — DS contract + adapters + brand packs
- Add DS mode selection per vertical.
- Add brand-token pack model (global semantic base + approved vertical overrides).
- Add consumer breakage controls:
  - type/API contracts,
  - runtime canaries,
  - visual matrix.

**DoD**
- DS update can be pinned/rolled back per vertical.

### Stream Z — Zephyr deployment profile
- Implement reference Zephyr profile aligned with vanilla constraints.
- Validate dynamic remote URL usage through manifest.

**DoD**
- Reference app deploy + rollback on Zephyr passes.

### Stream O — Ownership + gates + blast radius controls
- Implement ownership schema checks.
- Add graph-aware CI impact detection.
- Enforce cross-vertical approval and shared-foundation stricter checks.

**DoD**
- Unauthorized cross-vertical changes blocked by CI.

---

## Wave 2 — Integration Pilot (Reality Check)

### Required Pilot Topology
- 1 shell
- 2 vertical remotes
- 1 horizontal DS remote
- 1 Effect service

### Required Drills
1. Remote fails (timeout/network/integrity) → shell survives.
2. DS remote bad release → dependent verticals isolated with rollback.
3. Extract one vertical to independent deploy (different URL/cloud allowed) with no shell refactor.
4. Manifest rollback and kill-switch drill under time SLO.

**DoD**
- Pilot report with pass/fail evidence and SLO timings.

---

## Wave 3 — Production Rollout & Certification

### Rollout Controls
- Canary by vertical.
- Signed manifest enforcement in prod.
- Gradual external-remote allowlist expansion.

### Certification
- Extend module certification profile with:
  - extraction readiness,
  - trust/fallback drill evidence,
  - DS breakage detection evidence,
  - rollback evidence.

**DoD**
- At least one production vertical certified and onboarded under new gates.

---

## Wave 4 — Hardening, Policy Finalization, Sunset Decisions

### Goals
- Resolve lane policy from measured evidence:
  - Keep, constrain, or sunset compatibility combinations.
- Improve CI efficiency and flaky-test controls.
- Finalize platform docs and migration playbooks.

**DoD**
- Final support matrix policy approved and enforced.
- Migration playbook published for existing teams.

---

## Stop-Loss / Redirection Criteria

If any of these happen, halt expansion and return to remediation mode:
1. Zephyr profile requires non-vanilla hacks.
2. MF parity cannot match required trust/fallback telemetry contract.
3. External remotes cannot be pinned/provenanced reliably.
4. Pilot extraction needs shell refactor.
5. Rollback drills miss SLO repeatedly.

---

## High-Level Command Gates (to wire into CI)

- `pnpm run validate:module-sdk-contracts`
- `pnpm run validate:boundary-guards`
- `pnpm run validate:module-certification-gates`
- `pnpm run validate:rc-gates`
- `pnpm run validate:mcp-cli-parity`
- `pnpm run validate:gate-snapshot`
- `pnpm run validate:wave0-mv-contracts` (new target)

---

## Execution Outcome Target

At the end of Wave 4, Ultramodern should be:
- operationally safe,
- contract-governed,
- Zephyr-compatible,
- DS-flexible,
- and proven extractable without architecture rewrites.
