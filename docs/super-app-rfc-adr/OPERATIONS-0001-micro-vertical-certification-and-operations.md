# OPERATIONS-0001: Micro Vertical Certification And Operations

- Status: Proposed
- Date: 2026-04-29
- Amended by: `ADR-0019-federated-loading-unified-delivery.md`
- Related Plan: `.codex/plans/ultramodern-mv-operations-certification.plan.md`
- Depends on:
  - `ADR-0002-app-level-mf-ssr-strategy.md`
  - `ADR-0007-module-certification-gates.md`
  - `CI-GATES-0001-check-and-artifact-map.md`
  - `ADR-0012-mv-topology-manifest-and-zephyr-profile.md`
  - `ADR-0015-mv-ownership-and-blast-radius-gates.md`
  - `ADR-0019-federated-loading-unified-delivery.md`

## 1. Purpose

This document defines how shell, MicroVertical delivery units, horizontal remotes, and cross-vertical services are certified, released, rolled back, and operated after extraction.

Micro Verticals are production-ready only when their full delivery unit has a matching operations contract. Separately delivered horizontal remotes and cross-vertical services must also be observable, revocable, fallback-safe, and rollback-rehearsed as their own delivery units.

## 2. Release Train Model

### 2.1 Shell release

The shell release owns:

1. topology manifest selection.
2. topology artifact policy and compatibility enforcement.
3. global route assembly.
4. platform fallback taxonomy.
5. shell-level telemetry and incident routing.

The shell should be released independently from remotes as long as remote references are resolved by topology IDs rather than source-level URLs.

### 2.2 MicroVertical delivery-unit release

MicroVertical delivery-unit releases own:

1. immutable MF manifest and remote entry artifacts.
2. compatibility metadata declared by the topology manifest.
3. artifact digest, SRI, provenance, and optional attestation evidence where the topology policy requires them.
4. remote-local route and UI behavior.
5. matching API/backend/server capability identity.
6. fallback and degradation evidence.

Delivery-unit promotion order:

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

This section applies to cross-vertical service delivery units. A service that is the server capability of one MicroVertical is not a separate release train; it promotes and rolls back inside the MicroVertical delivery unit under section 2.2.

## 3. Certification Evidence

A vertical adoption package must include:

| Evidence | Required contents |
| --- | --- |
| Architecture evidence | topology IDs, route ownership, remote/service boundaries, shared-package consumers |
| Validation evidence | contract gates, topology manifest validation, artifact policy validation, boundary guards |
| Test evidence | dev/build/serve checks, remote unavailable behavior, cross-delivery-unit compatibility, service propagation |
| Rollout evidence | canary plan, rollout percentage, SLOs, rollback trigger, owner |
| Fallback evidence | timeout, network, artifact policy rejection, compatibility, service degradation |
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

### 4.3 Artifact-policy rejection

Operator actions:

1. identify whether origin, digest, SRI, provenance, attestation, compatibility, or revocation failed in topology evidence.
2. never bypass the failed artifact policy in production.
3. revoke the artifact when compromise or policy violation is confirmed.
4. select a valid LKG or disable the remote.
5. require corrected topology evidence before re-enabling the target.

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
| External remote | topology manifest contains immutable URL, digest/SRI/provenance metadata required by policy, and owner |
| Remote unavailable | shell renders degraded UI and emits fallback telemetry |
| Digest mismatch | remote is rejected and fallback path wins |
| Artifact revocation | revoked artifact cannot be selected from current, overlay, or LKG |
| Cross-delivery-unit compatibility | shell and separate delivery units pass compatibility or degrade deterministically |
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
pnpm check
pnpm build
pnpm cloudflare:build
# Cloudflare evidence comes from generated workspace proof scripts sourced from
# packages/toolkit/ultramodern-create/templates/workspace-scripts/*.mjs.handlebars.
# Status (2026-07-07): Cloudflare deploy proof is opt-in. Scheduled
# ultramodern-production-readiness runs do not deploy Cloudflare; the workflow
# enables deploy only on workflow_dispatch with deploy_cloudflare=true, and
# run-published-create-proof.mjs deploys only when passed --deploy-cloudflare.
pnpm cloudflare:proof
```

Promotion to a public environment additionally requires:

```bash
ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP=https://shell-super-app.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_EXPLORE=https://remote-explore.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_DECIDE=https://remote-decide.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_CHECKOUT=https://remote-checkout.example.workers.dev \
pnpm cloudflare:proof --require-public-urls
```

Live Zephyr evidence requires valid Zephyr credentials and public v1/v2 runtime,
manifest, and Effect readiness URLs for Explore, Decide, and Checkout. Dry-run
Zephyr evidence is not a substitute for live version-switching proof.

## 7. Acceptance Checklist

A Micro Vertical is operable when:

1. shell, MicroVertical delivery units, horizontal remotes, and cross-vertical service delivery units are independently promotable, but frontend/API/backend surfaces inside one MicroVertical are not.
2. canary and rollback controls are named before production rollout.
3. fallback rehearsal covers remote, compatibility, artifact-policy, and service failures.
4. evidence proves both Bun and Node expectations or records explicit unsupported scope.
5. incident SOPs identify owners and deterministic mitigation steps.
6. production promotion can be paused, revoked, or rolled back without shell source changes.
