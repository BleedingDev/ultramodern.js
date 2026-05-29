# OPERATIONS-0001: Micro Vertical Certification And Operations

- Status: Proposed
- Date: 2026-04-29
- Related Plan: `.codex/plans/ultramodern-mv-operations-certification.plan.md`
- Depends on:
  - `ADR-0002-app-level-mf-ssr-strategy.md`
  - `ADR-0007-module-certification-gates.md`
  - `CI-GATES-0001-check-and-artifact-map.md`
  - `ADR-0012-mv-topology-manifest-and-zephyr-profile.md`
  - `ADR-0015-mv-ownership-and-blast-radius-gates.md`

## 1. Purpose

This document defines how shell, remote, and service Micro Verticals are certified, released, rolled back, and operated after extraction.

Micro Verticals are production-ready only when independent deployment has a matching operations contract. A remote that can be deployed separately must also be observable, revocable, fallback-safe, and rollback-rehearsed separately.

## 2. Release Train Model

### 2.1 Shell release

The shell release owns:

1. topology manifest selection.
2. trust and compatibility enforcement.
3. global route assembly.
4. platform fallback taxonomy.
5. shell-level telemetry and incident routing.

The shell should be released independently from remotes as long as remote references are resolved by topology IDs rather than source-level URLs.

### 2.2 Remote release

Remote releases own:

1. immutable MF manifest and remote entry artifacts.
2. compatibility digest.
3. SRI and optional attestation.
4. remote-local route and UI behavior.
5. fallback and degradation evidence.

Remote promotion order:

1. local.
2. preview.
3. staging.
4. canary.
5. production.

Each promotion updates topology metadata or an environment overlay. It must not require shell source edits.

### 2.3 Service release

Service releases own:

1. operation contract compatibility.
2. runtime target: Bun or Node.
3. service lane: Effect or explicit Hono.
4. trace, locale, auth, and session propagation.
5. error envelope and degradation policy.

Service deployment may move faster than shell deployment only when generated clients or declared contracts preserve compatibility for current consumers.

## 3. Certification Evidence

A vertical adoption package must include:

| Evidence | Required contents |
| --- | --- |
| Architecture evidence | topology IDs, route ownership, remote/service boundaries, shared-package consumers |
| Validation evidence | contract gates, topology manifest validation, trust policy validation, boundary guards |
| Test evidence | dev/build/serve checks, remote unavailable behavior, version skew, service propagation |
| Rollout evidence | canary plan, rollout percentage, SLOs, rollback trigger, owner |
| Fallback evidence | timeout, network, integrity, compatibility, trust rejection, service degradation |
| Rollback evidence | LKG selection, kill switch, remote disable, service disable, recovery budget |
| Review evidence | vertical owner, platform owner, service owner, impacted vertical approvals |

Existing profile reference:

1. `scripts/release-gates/module-certification-profile.json`
2. `docs/super-app-rfc-adr/evidence/module-certification/current`

## 4. Incident SOPs

### 4.1 Remote unavailable

Operator actions:

1. verify topology target and selected environment overlay.
2. check remote manifest and remote entry availability.
3. confirm fallback telemetry emitted the remote-unavailable taxonomy.
4. switch to LKG when the current artifact is bad and an LKG exists.
5. disable the remote when LKG is unsafe.
6. keep unaffected shell routes available.

### 4.2 Compatibility mismatch

Operator actions:

1. compare shell runtime digest and remote compatibility digest.
2. reject the remote when the digest policy fails.
3. select a compatible topology overlay or LKG artifact.
4. pause rollout until the remote publishes compatible artifacts.
5. require platform runtime owner review before resume.

### 4.3 Trust-policy rejection

Operator actions:

1. identify whether origin, digest, SRI, attestation, or revocation failed.
2. never bypass the failed trust check in production.
3. revoke the artifact when compromise or policy violation is confirmed.
4. select a trusted LKG or disable the remote.
5. require trust evidence before re-enabling the target.

### 4.4 Service degradation

Operator actions:

1. identify affected service reference ID and consuming verticals.
2. verify trace, locale, auth, and session propagation.
3. disable only the affected service path when possible.
4. fall back to cached, degraded, or maintenance UI when declared.
5. require service owner and impacted vertical owner approval before rollout resume.

## 5. Acceptance Matrix

| Scenario | Required result |
| --- | --- |
| Bun runtime target | contract gates pass or scenario is marked unsupported with owner and expiration |
| Node runtime target | contract gates pass |
| Effect service lane | request context, trace, locale, and generated client propagation pass |
| Hono service lane | compatibility tests pass and lane remains explicit |
| External remote | topology manifest contains immutable URL, digest, SRI, trust metadata, and owner |
| Remote unavailable | shell renders degraded UI and emits fallback telemetry |
| Digest mismatch | remote is rejected and fallback path wins |
| Trust revocation | revoked artifact cannot be selected from current, overlay, or LKG |
| Version skew | host and remote pass compatibility or degrade deterministically |
| Rollback drill | LKG, kill switch, or disable action completes within declared recovery budget |

## 6. Required Gates

Before production promotion:

1. `pnpm run validate:bun-smoke`
2. `pnpm --dir tests run test:superapp-contracts`
3. `pnpm --dir tests exec rstest run integration/routes-tanstack-mf/test/index.test.ts`
4. module certification gate for the vertical evidence package.
5. boundary guard validation for cross-vertical imports.
6. owner and impacted-consumer review evidence.

For the generated Tractor workspace, add these scaffold-specific gates:

```bash
mise exec -- pnpm ultramodern:check
mise exec -- pnpm build
mise exec -- pnpm cloudflare:build
node scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js \
  --root-dir apps/remotes/remote-explore \
  --bff /explore-api/effect/explore/readiness \
  --expect-en "Explore Remote" \
  --match-build-marker \
  --out .codex/reports/cloudflare-ssr/remote-explore-local.json
node scripts/ultramodern-zephyr-live-evidence/run-zephyr-live-evidence.js \
  --dry-run \
  --out .codex/reports/zephyr-live/tractor-dry-run.json
```

Promotion to a public environment additionally requires:

```bash
ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP=https://shell-super-app.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_EXPLORE=https://remote-explore.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_DECIDE=https://remote-decide.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_CHECKOUT=https://remote-checkout.example.workers.dev \
pnpm cloudflare:proof -- --require-public-urls
```

Live Zephyr evidence requires valid Zephyr credentials and public v1/v2 runtime,
manifest, and Effect readiness URLs for Explore, Decide, and Checkout. Dry-run
Zephyr evidence is not a substitute for live version-switching proof.

## 7. Acceptance Checklist

A Micro Vertical is operable when:

1. shell, remote, and service release trains are independent but topology-coordinated.
2. canary and rollback controls are named before production rollout.
3. fallback rehearsal covers remote, compatibility, trust, and service failures.
4. evidence proves both Bun and Node expectations or records explicit unsupported scope.
5. incident SOPs identify owners and deterministic mitigation steps.
6. production promotion can be paused, revoked, or rolled back without shell source changes.
