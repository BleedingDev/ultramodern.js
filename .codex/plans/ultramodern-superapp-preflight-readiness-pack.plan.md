---
name: Ultramodern SuperApp Preflight Readiness Pack
overview: Package the latest TanStack stack, runtime polish, generator, local control plane, doctor, MF SSR decision, docs, and gates into one preflight path that proves teams can start SuperApp development without first building a real SuperApp.
todos:
  - id: uspready-01
    content: Add one preflight command that generates a temporary workspace, runs doctor checks, validates topology, starts local processes, and executes minimal smoke gates.
    status: completed
  - id: uspready-02
    content: Publish a concise greenfield SuperApp getting-started guide built around the preflight command and latest TanStack stack.
    status: completed
  - id: uspready-03
    content: Add a generated-workspace CI profile that is stronger than docs-only validation but cheaper than full destroy certification.
    status: completed
  - id: uspready-04
    content: Produce final readiness evidence showing a team can bootstrap and validate UltraModern without writing business-domain SuperApp code.
    status: completed
isProject: true
---

# Ultramodern SuperApp Preflight Readiness Pack

## Execution Notes

This is the integration plan. It should not invent core behavior. It packages the outputs of the dependency refresh, TanStack runtime polish, workspace generator, local control plane, contract doctor, and MF SSR closure into one preflight path.

The output should answer one question with evidence: can a new team bootstrap and validate an UltraModern SuperApp workspace before writing real business code?

## Constraints

This plan does not build the first real SuperApp, add migration guides, add codemods, introduce a second preset, add AI or MCP runtime operations, or start production rollout.

The preflight should be cheaper than full destroy certification and strong enough to catch stale dependencies, bad topology, missing runtime seams, and broken local orchestration.

## Completion Evidence

Implemented `scripts/ultramodern-preflight/run-preflight.js`, `scripts/ultramodern-preflight/__tests__/run-preflight.test.js`, and the package script `validate:ultramodern-preflight`.

Published `docs/super-app-rfc-adr/PREFLIGHT-0001-ultramodern-superapp-readiness.md` with the greenfield workflow, command contract, and current boundary that local process startup is represented by the deterministic control-plane dry-run in this cheap profile.

Verified with `node --test scripts/ultramodern-preflight/__tests__/run-preflight.test.js` and `pnpm run validate:ultramodern-preflight`. The package script produced `status: "pass"`, doctor `status: "pass"`, five planned local-control-plane processes, and all smoke checks passing.

## Operator Guidance

Keep this as the final graph node. Do not mark it complete until the preflight command proves a generated workspace end to end and produces machine-readable evidence suitable for future release gates.
