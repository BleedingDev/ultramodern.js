---
name: Ultramodern MV Effect BFF Contracts
overview: Make Effect-first server and client contracts first-class across shell apps, remotes, and independent services so Micro Verticals can share one strict service model without hiding core requirements in preset-only policy.
todos:
  - id: umebc-01
    content: Keep core defaults merge-friendly while preserving explicit stronger-default Effect seams instead of implicit framework defaults.
    status: completed
  - id: umebc-02
    content: Define one stable request, envelope, runtime-compatibility, and error contract shared by shell, remotes, and independent microservices.
    status: in_progress
  - id: umebc-03
    content: Expose stable request, identity, locale, and trace propagation APIs for generated clients and Module Federation boundaries.
    status: pending
  - id: umebc-04
    content: Add integration coverage for shell-to-remote-to-service flows in Effect-first mode with explicit Hono compatibility lanes.
    status: pending
isProject: false
---

# Ultramodern MV Effect BFF Contracts

## Execution Notes

The recent refactor already moved stronger defaults behind explicit seams and restored a more merge-friendly core posture. That was necessary groundwork, but it does not yet guarantee that shell apps, MF remotes, and independent microservices all share the same transport and context contract.

This plan turns the current partial Effect-first path into a stable MV contract instead of a mostly generator-level preference.

## Constraints

1. Preserve explicit Hono compatibility for existing Modern.js-style apps.
2. Do not weaken request or identity hardening to accommodate legacy behavior silently.
3. Keep transport/runtime contracts stable across Bun and Node.
4. Avoid pushing service topology assumptions into framework core where a contract seam is enough.

## Operator Guidance

Focus on the contract surfaces that matter at composition boundaries:
- generated client bootstrap
- request and response envelope
- runtime compatibility assertions
- trace and identity propagation
- failure taxonomy that shell and remotes can interpret consistently

If a behavior only exists because the preset stitches it together, move the seam into core and keep the preset as the policy layer.

## References

- [packages/cli/plugin-bff/src/server.ts](/Users/satan/side/experiments/modernjs/packages/cli/plugin-bff/src/server.ts)
- [packages/solutions/app-tools/src/utils/initAppContext.ts](/Users/satan/side/experiments/modernjs/packages/solutions/app-tools/src/utils/initAppContext.ts)
- [packages/server/bff-core/src/security/crossProjectPolicy.ts](/Users/satan/side/experiments/modernjs/packages/server/bff-core/src/security/crossProjectPolicy.ts)
- [packages/server/create-request/src/node.ts](/Users/satan/side/experiments/modernjs/packages/server/create-request/src/node.ts)
- [packages/server/create-request/src/browser.ts](/Users/satan/side/experiments/modernjs/packages/server/create-request/src/browser.ts)
- [docs/super-app-rfc-adr/ADR-0005-cross-project-bff-hardening.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/ADR-0005-cross-project-bff-hardening.md)
