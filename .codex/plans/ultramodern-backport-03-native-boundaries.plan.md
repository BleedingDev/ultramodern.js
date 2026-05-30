---
name: ultramodern-backport-03-native-boundaries
overview: Turn team or vertical boundaries into a native UltraModern debug feature that generated apps can use without hand-written app UI or confusing page-level overlays.
todos:
  - id: design-native-boundary-api
    content: Design the native debug boundary API, including how shell, verticals, and route regions declare ownership without application-specific overlay code.
    status: completed
  - id: remove-generated-page-overlays
    content: Remove or replace generated page-level boundary overlays that create confusing nested boxes or visible borders when the toggle is off.
    status: completed
  - id: implement-persistent-debug-toggle
    content: Implement a persistent, accessible debug toggle whose state survives navigation, language changes, hydration, and full reloads.
    status: completed
  - id: scope-boundary-rendering
    content: Render boundaries only around meaningful vertical ownership regions, with labels and colors derived from framework metadata rather than demo-specific names.
    status: completed
  - id: guard-production-behavior
    content: Ensure the debug feature is opt-in for generated apps and cannot leak confusing UI into normal production flows unless explicitly enabled.
    status: completed
  - id: test-boundaries-with-js-and-ssr
    content: Validate the boundary feature with JavaScript enabled, JavaScript disabled, localized routes, and hydration so it does not change page content or layout.
    status: pending
isProject: false
---

# ultramodern-backport-03-native-boundaries

## Execution Notes

The useful part of the demo boundary overlay is debugging ownership. The broken part is making every generated app manually carry demo-shaped overlay markup and page-level boxes. This lane converts the concept into reusable UltraModern behavior.

The framework should provide metadata conventions and a tiny debug runtime or generated helper. App authors should not need to write boundary UI, and agents working in a scaffold should not have to invent it.

## Constraints

Do not preserve the confusing page-boundary behavior from the Tractor Store demo. Do not add visible default borders to generated apps. Do not couple labels to "explore", "decide", or "checkout"; those are demo vertical names, not framework concepts.

## Operator Guidance

Depends on `ultramodern-backport-00-scope-and-demo-split`. Coordinate with the validation lane to visually test boundaries both off and on. Keep the implementation minimal enough to stay close to vanilla Modern.js.
