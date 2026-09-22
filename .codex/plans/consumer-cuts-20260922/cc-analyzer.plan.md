---
name: cc-analyzer
overview: "Absorb the code-tools fixes generically without OntOS-specific paths or weaker diagnostics."
todos:
  - id: cc-analyzer-native-analysis
    content: "Fix legacy import matching, bounded graph analysis and workspace export resolution in source."
    status: pending
  - id: cc-analyzer-analysis-controls
    content: "Verify valid large/shared-package applications and nearby invalid boundary cases in packed code-tools."
    status: pending
isProject: false
---

# cc-analyzer

## Execution Notes

Fix packages/toolkit/code-tools/src/oxlint-plugin/rules/strict-effect-api-boundaries.ts so api/effect and shared/effect match path segments, not legitimate names that merely begin with them. Preserve the banned legacy-path check.

In strict-effect-runtime.ts keep bounded source traversal, cycle protection, deterministic diagnostics and the source-size limit. The current consumer patch raises the module cap from 64 to 256. Preserve support for that workload without turning overflow into successful analysis or silently truncating imports. Reuse an existing central limit if present; otherwise one named limit is enough, not a new settings subsystem.

Replace microvertical-api-baseline.ts's relative-only import resolution with the existing TypeScript/package resolution machinery where available. The consumer patch hardcodes @app and packages/ layout; do not import that assumption into the framework. Respect actual workspace package names, public export maps, supported conditional/subpath exports and TS module resolution. Resolve shared public contracts without authorizing imports of another vertical's private implementation. Do not evaluate imported source. Source traversal must stay inside the applicable boundary and handle symlinks/path escapes safely.

## Constraints

Own packages/toolkit/code-tools/src/microvertical-api-baseline.ts, src/strict-effect-runtime.ts, src/oxlint-plugin/rules/strict-effect-api-boundaries.ts and dedicated tests/helpers already owned by those modules. No generator, app-tools, manifests, distribution, or downstream edits. These three files and the code-tools package are fork-added relative to eded841256, verified during planning. Implement here directly. Any additional upstream-owned dependency edge still follows Rule 5.

## Operator Guidance

Independent at the initial frontier; run alongside cc-contract using existing source contracts. Route any proposed shared-config change to root. Add/extend one valid and one invalid control for each changed rule: similar prefix versus banned path; supported >64-module graph versus actual over-budget graph; public shared export under a non-@app scope versus private cross-vertical import. Include cycle and unresolved export coverage if existing tests do not cover it. Keep Effect TSGo and all custom diagnostics enforced. Stop once the code-tools consumer patch is unnecessary and packed outputs expose the corrected behavior.
