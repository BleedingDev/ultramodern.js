# CI-HARDENING-0001: MV Tier Budgets and Flake Policy

- Status: Active
- Date: 2026-04-28
- Related ADR: `ADR-0010-mv-wave0-contract-first-gates.md`
- Related CI Map: `CI-GATES-0001-check-and-artifact-map.md`
- Related Beads: `modernjs-2vk`, `modernjs-465`, `modernjs-45u`

## 1. Purpose

Wave 4 micro-vertical CI must keep high-confidence checks while preventing
unbounded runtime and silent flake normalization. This policy assigns every MV
check to one tier, caps runtime by tier, and keeps retry/flake exceptions out of
the active profile unless a tracked, short-lived waiver is explicitly approved.

## 2. Tier Budgets

| Tier | Runtime Budget | Timeout Ceiling | Flake Waivers | Required Evidence |
| --- | ---: | ---: | ---: | --- |
| Golden | 45 minutes | 45 minutes | 0 | Full contract, failure, rollback, and certification evidence |
| Compat | 30 minutes | 30 minutes | 1 active waiver | Migration, compatibility, and regression evidence |
| Experimental | 12 minutes | 12 minutes | 1 active waiver | Explicit opt-in smoke evidence only |

Golden is the production-default path. It is not allowed to carry flake waivers
or retry masking. The active Compat check runs with one attempt and no active
waiver; any future retry masking must be added back as a tracked, expiring
exception. Experimental must stay smoke-bounded unless promoted to Compat or
Golden through a separate policy change.

## 3. Flake Policy

1. A flake waiver must include an owner, a bead or GitHub issue reference, an
   opened date, an expiry date, and a reason.
2. Waivers expire after at most 14 days.
3. Waiver owners must match the owning check owner.
4. Placeholder owners or reasons are blockers.
5. Golden checks cannot use flake waivers.
6. A retry count above one must include a tracked bead or GitHub issue and a
   non-placeholder reason, and must not appear in the active profile without an
   approved waiver.
7. Retrying without a tracked issue is treated as hiding a failing check and is
   rejected.

## 4. Validator

The deterministic validator is local to this lane:

```bash
node scripts/mv-ci-hardening/validate-ci-hardening.js
```

It reads `scripts/mv-ci-hardening/mv-ci-hardening-profile.json` and rejects:

1. Missing required Golden, Compat, or Experimental tier definitions.
2. Check runtime or timeout budgets above the owning tier.
3. Stale or overlong flake waivers.
4. Missing or placeholder check owners.
5. Retry policies above one attempt without a bead or GitHub issue.
6. Golden flake waivers.

The validator performs no network calls and does not depend on root package
scripts. The CLI uses the current UTC date for waiver expiry enforcement unless
`--today YYYY-MM-DD` is supplied for deterministic fixture validation. Root CI
wiring can later call this file directly or wrap it in a package script.

## 5. Enforcement Profile

The active profile starts with three representative checks:

1. `mv-golden-contract-certification` for full MV contract and rollout evidence.
2. `mv-compat-runtime-regression` for supported migration regression evidence.
3. `mv-experimental-smoke` for opt-in topology smoke coverage.

Runtime budget changes must update the profile and this policy together so the
budget contract and executable enforcement remain aligned.

The Wave 4 temporary Compat waiver tracked by `modernjs-465` has been removed
from the active profile. The validator still keeps waiver and retry rejection
coverage in fixtures so a future exception cannot silently bypass ownership,
expiry, or issue-reference requirements.

## 6. Acceptance Criteria

1. Golden, Compat, and Experimental budgets are defined in policy and JSON.
2. The validator rejects over-budget checks.
3. The validator rejects stale flake waivers.
4. The validator rejects missing or placeholder owners.
5. The validator rejects retry-without-issue patterns.
6. The validator test suite covers positive and negative policy cases.
