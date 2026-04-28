# LANE-POLICY-0001: Golden, Compat, and Experimental MV Lanes

- Status: Active
- Date: 2026-04-29
- Decision Type: Lane governance and enforcement policy
- Related:
  - `ADR-0010-mv-wave0-contract-first-gates.md`
  - `CI-GATES-0001-check-and-artifact-map.md`
  - `scripts/mv-lane-policy/lane-policy.json`
  - `scripts/mv-lane-policy/validate-lane-policy.js`

## 1. Purpose

Define the enforceable lane policy for Micro Vertical runtime rollout after
Wave 3 production certification. The policy prevents unsupported runtime,
router, and service combinations from being treated as production-ready, and it
keeps CI cost proportional to each lane's risk.

The machine-readable source of truth is
`scripts/mv-lane-policy/lane-policy.json`. This document explains the contract
operators and reviewers should apply when interpreting validator failures.

## 2. Lane Matrix

| Lane | Runtime | Router | Service | Production default | CI budget |
| --- | --- | --- | --- | --- | --- |
| Golden | Module Federation | TanStack Router | Effect | Yes | Full |
| Compat | Garfish | React Router | Hono | No | Migration regression |
| Experimental | Enumerated mixed combinations | Enumerated mixed combinations | Enumerated mixed combinations | No | Bounded smoke |

Allowed Experimental combinations are deliberately enumerated:

1. Module Federation + React Router + Effect.
2. Module Federation + TanStack Router + Hono.
3. Garfish + TanStack Router + Effect.
4. Garfish + React Router + Effect.

Any combination not present in `lane-policy.json` is unsupported. Unsupported
combinations must fail validation before they can become a lane definition.

## 3. Required Gates

Golden requires full production-grade evidence:

1. Wave 0 contracts.
2. Runtime parity.
3. Topology manifest.
4. Signed manifest.
5. Trust, integrity, and attestation.
6. Remote failure drills.
7. Rollback and kill-switch SLO.
8. Design-system contract.
9. Module certification.
10. Production rollout.
11. Owner and blast-radius evidence.
12. Fallback telemetry.
13. Dual review.

Compat requires migration support evidence:

1. Wave 0 contracts.
2. Runtime parity.
3. Topology manifest.
4. Trust, integrity, and attestation.
5. Migration regression.
6. Rollback and kill-switch SLO.
7. Owner and blast-radius evidence.
8. Fallback telemetry.
9. Dual review.

Experimental requires bounded opt-in evidence:

1. Wave 0 contracts.
2. Topology manifest.
3. Smoke test.
4. Explicit owner opt-in.
5. Owner and blast-radius evidence.
6. Fallback telemetry.

Experimental lanes must not be production defaults.

## 4. Promotion Rules

Promotion is allowed only when the validator policy contains a matching rule and
the named signals are present in the promotion evidence package.

Experimental may promote to Compat when:

1. migration regression is green.
2. fallback telemetry is present.
3. owner opt-in is current.
4. dual review is complete.

Compat may promote to Golden when:

1. parity scenarios are covered.
2. known non-equivalences are dispositioned.
3. signed manifest enforcement is enabled.
4. production rollout is complete.
5. rollback drill is green.
6. fallback telemetry is present.
7. dual review is complete.

Experimental may skip directly to Golden only when it satisfies every Compat to
Golden signal plus current owner opt-in.

## 5. Demotion Rules

Golden demotes to Compat when any of these triggers are active:

1. signed manifest enforcement is disabled.
2. runtime parity regresses.
3. production SLO breach occurs.
4. rollback drill fails.
5. fallback telemetry is missing.

Compat demotes to Experimental when:

1. migration regression fails.
2. fallback telemetry is missing.
3. an unsupported combination is detected.

Experimental is disabled when:

1. owner opt-in expires.
2. trust policy is bypassed.
3. an unsupported combination is detected.

## 6. Enforcement

Run the validator directly:

```bash
node scripts/mv-lane-policy/validate-lane-policy.js
```

To validate an external lane-definition fixture against the policy:

```bash
node scripts/mv-lane-policy/validate-lane-policy.js \
  --lanes scripts/mv-lane-policy/__fixtures__/valid-lanes.json
```

The validator rejects:

1. unknown tiers, gates, evidence, promotion signals, or demotion triggers.
2. unsupported runtime/router/service combinations.
3. lane definitions missing required gates or evidence.
4. lane definitions with the wrong CI budget for their tier.
5. Experimental lanes without explicit opt-in.
6. more than one production default lane.

## 7. Acceptance Criteria

1. `scripts/mv-lane-policy/lane-policy.json` is the structured source of
   truth.
2. `node --test scripts/mv-lane-policy/__tests__/*.test.js` covers valid and
   invalid lane definitions.
3. Golden, Compat, and Experimental gates are explicitly listed.
4. Promotion and demotion rules are machine-readable.
5. Root package scripts are not required for enforcement.
