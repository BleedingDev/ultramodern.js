---
name: Ultramodern MV Operations Certification
overview: Define the runtime operations, certification, rollout, and incident-response model for independently deployable shell, remote, and service verticals so Micro Verticals are operable rather than only structurally possible.
todos:
  - id: umoc-01
    content: Define release-train and deployment-topology guidance for shell, remotes, and services, including canary, rollback, and version-skew expectations.
    status: completed
  - id: umoc-02
    content: Extend certification and evidence profiles to cover vertical adoption readiness, external remotes, trust/compatibility enforcement, and fallback rehearsal requirements.
    status: completed
  - id: umoc-03
    content: Publish observability and incident SOPs for remote failure, compatibility mismatch, trust-policy rejection, and service degradation across shell or remote boundaries.
    status: completed
  - id: umoc-04
    content: Add an acceptance matrix for Bun or Node runtime targets, Effect or Hono service lanes, external remotes, remote-unavailable behavior, digest mismatch, and rollback drills.
    status: completed
isProject: false
---

# Ultramodern MV Operations Certification

## Execution Notes

Micro Verticals stop being credible the moment deploy or incident handling becomes hand-wavy. This plan turns the completed trust, telemetry, and certification primitives into an explicit operating model for independently deployable verticals.

The target is not extra framework defaults. The target is a repeatable operator contract for rollout, fallback, evidence, and recovery.

## Constraints

1. Reuse the existing release-gate, module-certification, and telemetry surfaces where possible.
2. Keep external remote and trust-policy handling explicit; do not hide unsafe fallbacks behind convenience defaults.
3. Treat Bun and Node as runtime targets to certify, not separate product modes.
4. Keep operations guidance anchored to real repo contracts and integration suites.

## Operator Guidance

The plan should make it obvious:

- how a shell release can move independently from remotes and services,
- what must be rehearsed before a vertical is trusted in production,
- what evidence proves a vertical is safe to onboard,
- and how incidents flow when trust, compatibility, or service contracts break.

## References

- [docs/super-app-rfc-adr/ADR-0002-app-level-mf-ssr-strategy.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/ADR-0002-app-level-mf-ssr-strategy.md)
- [docs/super-app-rfc-adr/ADR-0007-module-certification-gates.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/ADR-0007-module-certification-gates.md)
- [docs/super-app-rfc-adr/CI-GATES-0001-check-and-artifact-map.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/CI-GATES-0001-check-and-artifact-map.md)
- [scripts/release-gates/module-certification-profile.json](/Users/satan/side/experiments/modernjs/scripts/release-gates/module-certification-profile.json)
- [packages/runtime/plugin-garfish/src/runtime/trust.ts](/Users/satan/side/experiments/modernjs/packages/runtime/plugin-garfish/src/runtime/trust.ts)
- [packages/runtime/plugin-garfish/src/runtime/fallbackTelemetry.ts](/Users/satan/side/experiments/modernjs/packages/runtime/plugin-garfish/src/runtime/fallbackTelemetry.ts)
- [tests/integration/routes-tanstack-mf/test/index.test.ts](/Users/satan/side/experiments/modernjs/tests/integration/routes-tanstack-mf/test/index.test.ts)
- [tests/integration/i18n/mf/test/index.test.ts](/Users/satan/side/experiments/modernjs/tests/integration/i18n/mf/test/index.test.ts)
