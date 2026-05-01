---
name: UltraModern SuperApp Torture Browser Runtime
overview: Validate real browser behavior, route transitions, hydration, responsive layouts, slow network recovery, Module Federation runtime behavior, and build-mode compatibility while the app is under realistic pressure.
todos:
  - id: ust-browser-01
    content: "Add Playwright coverage for ERP dashboard navigation, tenant switching, chat workflow, module lazy loading, forms, tables, and error states."
    status: completed
  - id: ust-browser-02
    content: "Run browser smoke and focused flows against production build with console, pageerror, requestfailed, trace, screenshot, and video artifacts."
    status: completed
  - id: ust-browser-03
    content: "Add slow-network, offline-to-online, mobile viewport, desktop viewport, and repeated route-transition scenarios."
    status: completed
  - id: ust-browser-04
    content: "Validate runtime/build matrix coverage for dev, production build, production serve, SSR/CSR paths, cold start, repeated builds, asset prefixes, and MF fallback behavior."
    status: pending
  - id: ust-browser-05
    content: "Run a browser smoke subset while moderate HTTP load is active and fail on hydration warnings, console errors, broken resources, or user-visible crash states."
    status: pending
isProject: true
---

# UltraModern SuperApp Torture Browser Runtime

## Execution Notes

This lane closes the gap between API confidence and actual SuperApp usability. It should prove that the browser can navigate, hydrate, recover, and render under the same conditions the HTTP tests exercise.

Playwright artifacts matter. Keep traces and screenshots for failing states, and emit a compact summary for readiness aggregation.

The runtime matrix should focus on modes that can break framework integration: dev versus production, SSR versus CSR, asset prefix behavior, Module Federation remote availability, repeated builds, and cold starts.

## Constraints

Avoid brittle visual assertions unless they protect a real regression boundary. Prefer semantic locators, console/page error capture, and key screenshots for human triage.

Do not run the full browser matrix by default on every PR. Keep a small smoke path for release and an expanded path for nightly torture.

## Operator Guidance

Suggested ownership is Playwright tests, browser artifact handling, and runtime/build certification entries.

Conflict risk is highest with workload-data and chaos fixtures. Coordinate stable route names and scenario IDs before writing long browser flows.

Exit criteria: a production-served SuperApp can be exercised in real browsers across critical workflows and runtime modes, including during moderate load, with actionable artifacts on failure.
