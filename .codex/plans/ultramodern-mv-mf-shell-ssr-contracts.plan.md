---
name: Ultramodern MV MF Shell SSR Contracts
overview: Formalize the shell-to-vertical Module Federation SSR contract for independent deploys, including route ownership, request context handoff, fallback behavior, trust, and compatibility rules.
todos:
  - id: ummsc-01
    content: Keep app-level Module Federation SSR explicit and merge-friendly instead of heuristic-driven.
    status: completed
  - id: ummsc-02
    content: Define route ownership, loader context, redirect, and notFound handoff rules between shell and vertical remotes for TanStack-first SSR.
    status: completed
  - id: ummsc-03
    content: Expose fallback and degradation hooks plus observable status telemetry at the shell and vertical boundary.
    status: completed
  - id: ummsc-04
    content: Extend integration coverage for timeout, network, compatibility mismatch, locale and trace propagation, and SSR fallback behavior.
    status: completed
isProject: false
---

# Ultramodern MV MF Shell SSR Contracts

## Execution Notes

The repo already contains explicit app-level MF SSR support, trust checks, compatibility digest behavior, and TanStack plus MF integration coverage. The remaining problem is that the shell-to-vertical SSR boundary is not yet expressed as one deliberate contract that the single public preset can safely rely on.

This plan converts that implicit composition behavior into an auditable framework contract.

## Constraints

1. Keep MF SSR opt-in and explicit.
2. Preserve local degradation and fallback rather than letting remote failures collapse the shell.
3. Keep compatibility and trust checks fail-fast for independent deploy safety.
4. Avoid coupling the contract to one business topology or one vertical taxonomy.

## Operator Guidance

Model this as a host/remote contract, not just a runtime implementation detail. The contract should explicitly cover:
- request context inheritance
- router handoff semantics
- redirect and notFound ownership
- locale and trace propagation
- fallback UI and reason taxonomy
- compatibility and trust validation

## References

- [packages/runtime/plugin-runtime/src/cli/ssr/index.ts](/Users/satan/side/experiments/modernjs/packages/runtime/plugin-runtime/src/cli/ssr/index.ts)
- [packages/runtime/plugin-garfish/src/runtime/compatibility.ts](/Users/satan/side/experiments/modernjs/packages/runtime/plugin-garfish/src/runtime/compatibility.ts)
- [packages/runtime/plugin-garfish/src/runtime/trust.ts](/Users/satan/side/experiments/modernjs/packages/runtime/plugin-garfish/src/runtime/trust.ts)
- [tests/integration/routes-tanstack-mf/test/index.test.ts](/Users/satan/side/experiments/modernjs/tests/integration/routes-tanstack-mf/test/index.test.ts)
- [tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts](/Users/satan/side/experiments/modernjs/tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts)
- [docs/super-app-rfc-adr/ADR-0002-app-level-mf-ssr-strategy.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/ADR-0002-app-level-mf-ssr-strategy.md)
