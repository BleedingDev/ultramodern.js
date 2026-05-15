---
name: Ultramodern Beads TanStack RSC Payload Router
overview: Implement modernjs-aye by making TanStack RSC payload-router behavior native, plugin-owned where possible, and parity-tested against Modern.js React Router RSC semantics.
todos:
  - id: ubf-rsc-01
    content: Design the TanStack RSC payload-router adapter by mapping Modern.js React Router RSC server/client machinery and TanStack Start Router RSC semantics onto the current TanStack plugin architecture.
    status: pending
  - id: ubf-rsc-02
    content: Implement the TanStack RSC server payload adapter, including route matching, loader execution boundaries, redirect/notFound behavior, server payload serialization, and request cleanup.
    status: pending
  - id: ubf-rsc-03
    content: Implement TanStack RSC client hydration and navigation behavior, including client-loader omission during RSC navigation and compatibility with existing TanStack SSR hydration scripts.
    status: pending
  - id: ubf-rsc-04
    content: Add RSC parity fixtures, tests, and docs that prove TanStack behavior against React Router-equivalent server/client scenarios, then update modernjs-aye.
    status: pending
isProject: true
---

# Ultramodern Beads TanStack RSC Payload Router

## Execution Notes

This lane is unblocked only after upstream drift closure is clean. It owns `modernjs-aye`: full TanStack RSC payload-router parity beyond the current RSC serialization/export work.

Use Modern.js React Router RSC as the parity baseline, especially the existing server/client machinery in the runtime plugin. Use TanStack Start / TanStack Router RSC as the native-feeling model so this does not become a thin copy of React Router internals.

## Scope

Own TanStack router plugin/runtime RSC surfaces, route-tree integration, hydration/navigation behavior, targeted RSC fixtures, targeted tests, and docs.

Prefer plugin-owned or hook-owned seams. If the adapter cannot be implemented cleanly without core Modern.js changes, stop and document the exact missing hook or runtime seam before broadening core code.

Do not touch live control-plane orchestration, generated workspace startup, or unrelated preset behavior.

## Validation

Minimum proof for completion:

- targeted TanStack RSC unit or integration tests added by this lane
- existing TanStack SSR tests still passing where affected
- docs explain server/client import paths, payload router behavior, loader boundaries, redirects, and hydration expectations
- no deprecated compatibility aliases introduced for new UltraModern APIs
